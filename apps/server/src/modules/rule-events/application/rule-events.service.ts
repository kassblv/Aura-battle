import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { RULE_VARIANTS, weekIndexOf } from '@aura/rules';
import { describeCause } from '../../../shared/describe-cause.js';
import type { AppLog } from '../../../shared/log-port.js';
import {
  adminWeekView,
  isForcibleVariant,
  weekEventAt,
  type AdminWeekView,
  type WeekEventView,
} from '../../match/domain/rules-variant.js';
import type { WeekEventOverrides } from '../../match/domain/ports.js';
import type { RuleEventClock, RuleEventStore } from '../domain/ports.js';

/** Relecture des forcages : un autre noeud qui force une semaine est suivi en trente secondes. */
export const RULE_EVENTS_REFRESH_MS = 30_000;

/** Semaines montrees au panneau : la semaine en cours et les quatre suivantes. */
const ADMIN_WEEKS = 5;

/**
 * Jusqu'ou l'on peut forcer : un an. Au-dela, c'est une faute de frappe plutot
 * qu'un calendrier.
 */
const MAX_WEEKS_AHEAD = 52;

/** Un forcage refuse : semaine hors bornes, variante inconnue. Le controleur en fait une 400. */
export class InvalidEventOverrideError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidEventOverrideError';
  }
}

/** Ce que le panneau montre (`adminEventsResponseSchema`). */
export interface AdminEventsView {
  readonly weeks: readonly AdminWeekView[];
  readonly variants: readonly { readonly id: string; readonly name: string }[];
}

/**
 * L'evenement de la semaine, force ou non (ADR 0018).
 *
 * **Le serveur decide toujours a l'ouverture du match** : `MatchOpener` lit
 * `overrideFor` de facon synchrone, dans un cache relu toutes les trente
 * secondes (et aussitot apres une ecriture de ce noeud). L'accueil du client
 * lit la meme decision par `GET /events/week`, au lieu de recalculer une
 * rotation qui ignorerait le forcage.
 *
 * Tant que la premiere lecture n'a pas abouti, aucun forcage n'est connu : la
 * rotation decide, ce que faisait le jeu avant le panneau.
 */
export class RuleEventsService implements WeekEventOverrides, OnModuleInit, OnModuleDestroy {
  private readonly store: RuleEventStore;
  private readonly clock: RuleEventClock;
  private readonly log: AppLog | null;
  private overrides: ReadonlyMap<number, string> = new Map();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(deps: { store: RuleEventStore; clock: RuleEventClock; log?: AppLog | null }) {
    this.store = deps.store;
    this.clock = deps.clock;
    this.log = deps.log ?? null;
  }

  async onModuleInit(): Promise<void> {
    await this.refresh();
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      void this.refresh();
    }, RULE_EVENTS_REFRESH_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  /** Ecritures faites par ce noeud : un rechargement lance avant l'une d'elles est perime. */
  private writes = 0;

  /** Relit les forcages a venir. Un echec garde les derniers connus. */
  async refresh(): Promise<void> {
    // Une ecriture de CE noeud pendant la lecture la rend perimee : on la jette.
    const generation = this.writes;
    try {
      const overrides = await this.store.loadFrom(this.currentWeek());
      if (generation === this.writes) this.overrides = overrides;
    } catch (cause: unknown) {
      this.log?.warn(`evenements forces non relus : ${describeCause(cause)}`);
    }
  }

  overrideFor(week: number): string | null {
    return this.overrides.get(week) ?? null;
  }

  /** La semaine en cours telle que le joueur la voit. */
  playerWeek(): WeekEventView {
    const atMs = this.clock.now();
    return weekEventAt(atMs, this.overrideFor(weekIndexOf(atMs)));
  }

  /** La semaine en cours et les quatre suivantes, et ce qu'on peut forcer. */
  adminView(): AdminEventsView {
    const current = this.currentWeek();
    return {
      weeks: Array.from({ length: ADMIN_WEEKS }, (_, offset) =>
        adminWeekView(current + offset, this.overrideFor(current + offset)),
      ),
      variants: [
        { id: 'normal', name: 'Normale' },
        ...RULE_VARIANTS.map((variant) => ({ id: variant.id, name: variant.name })),
      ],
    };
  }

  /**
   * Force une semaine (`variant`), ou la rend a la rotation (`null`).
   *
   * La variante passe par les regles du jeu : `normal` ou une de
   * `RULE_VARIANTS`, rien d'autre. Une semaine deja commencee peut etre
   * forcee — c'est le cas d'usage d'un incident — mais pas une semaine passee :
   * elle ne changerait plus rien, et le journal mentirait sur ce qui s'est joue.
   */
  async setOverride(week: number, variant: string | null, reason: string | null): Promise<void> {
    const current = this.currentWeek();
    if (!Number.isInteger(week) || week < current || week > current + MAX_WEEKS_AHEAD) {
      throw new InvalidEventOverrideError(`semaine hors bornes : ${String(week)}`);
    }
    if (variant !== null && !isForcibleVariant(variant)) {
      throw new InvalidEventOverrideError(`variante inconnue : ${variant}`);
    }
    const atMs = this.clock.now();
    await this.store.setOverride(week, variant, (before) => ({
      action: 'event.override',
      target: `week:${String(week)}`,
      before: { variant: before },
      after: { variant },
      reason,
      atMs,
    }));
    this.writes += 1;
    const next = new Map(this.overrides);
    if (variant === null) next.delete(week);
    else next.set(week, variant);
    this.overrides = next;
  }

  private currentWeek(): number {
    return weekIndexOf(this.clock.now());
  }
}
