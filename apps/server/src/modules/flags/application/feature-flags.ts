import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { AdminAuditEntry } from '../../../shared/admin-audit.js';
import { describeCause } from '../../../shared/describe-cause.js';
import type { AppLog } from '../../../shared/log-port.js';
import {
  applyFlagAction,
  FLAG_NAMES,
  groupOf,
  initialFlagState,
  type FlagAction,
  type FlagGroup,
  type FlagName,
  type FlagSettingState,
} from '../domain/flags.js';
import type { FlagAssignmentStore, FlagClock, FlagSettingsStore } from '../domain/ports.js';

/**
 * Borne de la memoire des inscriptions : au-dela, on oublie tout et l'on
 * reinscrit — un `ON CONFLICT DO NOTHING` de plus par joueur, rien de faux.
 */
const MAX_REMEMBERED = 100_000;

/**
 * Intervalle de relecture des reglages. Un autre noeud qui coupe un drapeau
 * est suivi ici en trente secondes au plus ; une ecriture faite par CE noeud
 * vaut aussitot.
 */
export const FLAG_SETTINGS_REFRESH_MS = 30_000;

/** Un drapeau tel que le panneau et la lecture des experiences le voient. */
export interface DeclaredFlag {
  readonly flag: FlagName;
  readonly rollout: number;
  readonly measureRollout: number;
  readonly epoch: number;
  readonly measureStartedAtMs: number;
}

/** L'etat qu'on montre au journal : lisible, sans le nom (c'est la cible). */
const auditView = (state: FlagSettingState) => ({
  rollout: state.rollout,
  measureRollout: state.measureRollout,
  epoch: state.epoch,
  measureStartedAt: new Date(state.measureStartedAtMs).toISOString(),
});

/**
 * Les interrupteurs d'experience, a la part en vigueur (spec 2026-09-26).
 *
 * **Tout est synchrone cote appelant.** L'ouverture d'un match ne peut rien
 * attendre entre le controle des sieges et leur reservation
 * (`match-opener.ts`) : le groupe se CALCULE, il ne se lit pas en base, et
 * l'inscription part sans qu'on l'attende. Une base muette coute une trace
 * d'affectation, jamais un duel.
 *
 * **Les reglages vivent en base** (`FlagSetting`, panneau qui gere) et sont
 * relus toutes les trente secondes ; l'environnement ne donne que la valeur de
 * depart. Tant que la premiere lecture n'a pas abouti, personne n'est expose ni
 * inscrit : on ne sait pas quelle mesure est en cours, et inscrire un joueur a
 * la mauvaise melangerait les groupes. Couper est toujours sur (docs/10).
 */
export class FeatureFlags implements OnModuleInit, OnModuleDestroy {
  private readonly initialRollouts: Readonly<Record<FlagName, number>>;
  private readonly clock: FlagClock;
  private readonly store: FlagAssignmentStore | null;
  private readonly settingsStore: FlagSettingsStore | null;
  private readonly log: AppLog | null;
  private readonly assignOverride: ((flag: FlagName, playerId: string) => FlagGroup) | null;
  /** `null` tant que les reglages n'ont jamais ete lus. */
  private settings: ReadonlyMap<FlagName, FlagSettingState> | null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(deps: {
    /** Parts de depart (environnement) : elles initialisent les reglages absents. */
    rollouts: Readonly<Record<FlagName, number>>;
    clock: FlagClock;
    store?: FlagAssignmentStore | null;
    /**
     * Reglages en base. Absents (tests), les parts de depart valent reglage,
     * epoque 1, et le panneau ne peut rien ecrire.
     */
    settings?: FlagSettingsStore | null;
    log?: AppLog | null;
    /**
     * Affectation imposee, pour les tests de bout en bout : un scenario doit
     * pouvoir asseoir un joueur temoin a cote d'un joueur expose sans
     * chercher des identifiants dont le hachage tombe du bon cote.
     */
    assign?: (flag: FlagName, playerId: string) => FlagGroup;
  }) {
    this.initialRollouts = deps.rollouts;
    this.clock = deps.clock;
    this.store = deps.store ?? null;
    this.settingsStore = deps.settings ?? null;
    this.log = deps.log ?? null;
    this.assignOverride = deps.assign ?? null;
    this.settings = this.settingsStore === null ? this.index(this.initialStates()) : null;
  }

  /** Affectations deja inscrites par ce noeud (cles `drapeau#epoque:joueur`). */
  private readonly enrolled = new Set<string>();

  async onModuleInit(): Promise<void> {
    await this.refresh();
    if (this.settingsStore === null || this.timer !== null) return;
    this.timer = setInterval(() => {
      void this.refresh();
    }, FLAG_SETTINGS_REFRESH_MS);
    // Un minuteur de relecture ne doit pas tenir le processus en vie.
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  /** Ecritures faites par ce noeud : un rechargement lance avant l'une d'elles est perime. */
  private writes = 0;

  /**
   * Relit les reglages. Un echec garde les derniers reglages connus : une base
   * qui hoquete ne rallume ni ne coupe rien.
   */
  async refresh(): Promise<void> {
    if (this.settingsStore === null) return;
    // Une ecriture de CE noeud pendant la lecture la rend perimee : on la jette,
    // sinon une coupure d'urgence resterait sans effet jusqu'au tour suivant.
    const generation = this.writes;
    try {
      const states = await this.settingsStore.loadAll(this.initialStates());
      if (generation !== this.writes) return;
      this.settings = this.index(states);
    } catch (cause: unknown) {
      this.log?.warn(`reglages des drapeaux non relus : ${describeCause(cause)}`);
    }
  }

  /** Le groupe d'un joueur, sans rien inscrire. */
  groupOf(flag: FlagName, playerId: string): FlagGroup {
    return this.assign(flag, playerId);
  }

  /**
   * Le groupe d'un joueur, **au moment ou il sert** — et sa trace en base.
   *
   * Les deux groupes s'inscrivent : un test A/B se lit par comparaison, et un
   * temoin qu'on n'aurait pas note serait un temoin qu'on ne retrouve pas.
   * L'inscription porte l'epoque : une nouvelle mesure repart de zero.
   */
  enroll(flag: FlagName, playerId: string): FlagGroup {
    const state = this.settings?.get(flag);
    if (state === undefined) return this.assignOverride?.(flag, playerId) ?? 'control';
    const group = this.assign(flag, playerId);
    const key = `${flag}#${String(state.epoch)}:${playerId}`;
    // La ligne existe des la premiere inscription : on ne la reecrit pas a
    // chaque match. Un echec retire la cle, et le match suivant reessaie.
    if (this.store !== null && !this.enrolled.has(key)) {
      if (this.enrolled.size >= MAX_REMEMBERED) this.enrolled.clear();
      this.enrolled.add(key);
      void this.store
        .record({ playerId, flag, group, epoch: state.epoch, atMs: this.clock.now() })
        .catch((cause: unknown) => {
          this.enrolled.delete(key);
          // Jamais l'identifiant du joueur : un journal ne doit pas defaire
          // une suppression de compte.
          this.log?.warn(`affectation « ${flag} » non inscrite : ${describeCause(cause)}`);
        });
    }
    return group;
  }

  /** Les drapeaux declares en code, avec le reglage en vigueur sur ce noeud. */
  declared(): readonly DeclaredFlag[] {
    return FLAG_NAMES.map((flag) => {
      const state = this.settings?.get(flag) ?? {
        // Pas encore lu : on montre ce qu'on applique, c'est-a-dire rien.
        ...initialFlagState(flag, this.initialRollouts[flag], this.clock.now()),
        rollout: 0,
      };
      return {
        flag,
        rollout: state.rollout,
        measureRollout: state.measureRollout,
        epoch: state.epoch,
        measureStartedAtMs: state.measureStartedAtMs,
      };
    });
  }

  /**
   * Une action du panneau : calculee sur l'etat EN BASE, sous verrou, ecrite
   * avec sa ligne de journal dans la meme transaction, puis appliquee aussitot
   * sur ce noeud. Les autres suivent a leur prochaine relecture.
   */
  async update(
    flag: FlagName,
    action: FlagAction,
    reason: string | null,
  ): Promise<FlagSettingState> {
    if (this.settingsStore === null) {
      throw new Error('reglages des drapeaux non persistes : ecriture impossible');
    }
    const atMs = this.clock.now();
    const after = await this.settingsStore.transition(
      flag,
      (current) => applyFlagAction(current, action, atMs),
      (before, next): AdminAuditEntry => ({
        action: `flag.${action.action}`,
        target: flag,
        before: auditView(before),
        after: auditView(next),
        reason,
        atMs,
      }),
    );
    this.writes += 1;
    const settings = new Map(this.settings ?? []);
    settings.set(flag, after);
    this.settings = settings;
    return after;
  }

  private assign(flag: FlagName, playerId: string): FlagGroup {
    if (this.assignOverride !== null) return this.assignOverride(flag, playerId);
    const state = this.settings?.get(flag);
    if (state === undefined) return 'control';
    return groupOf(flag, playerId, state.rollout, state.epoch);
  }

  private initialStates(): FlagSettingState[] {
    const atMs = this.clock.now();
    return FLAG_NAMES.map((flag) => initialFlagState(flag, this.initialRollouts[flag], atMs));
  }

  private index(states: readonly FlagSettingState[]): ReadonlyMap<FlagName, FlagSettingState> {
    const known = new Set<string>(FLAG_NAMES);
    // Une ligne d'un drapeau retire du code est ignoree : le code declare.
    return new Map(states.filter((state) => known.has(state.flag)).map((s) => [s.flag, s]));
  }
}
