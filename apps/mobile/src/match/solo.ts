import {
  AI_PROFILES,
  createMatch,
  createRng,
  decideChoice,
  decideRechargeTaps,
  decideTimingTap,
  deriveSeed,
  reduce,
  type AiProfileId,
  type BalanceConfig,
  type Choice,
  type MatchEffect,
  type MatchState,
  type RechargeTap,
  type Style,
} from '@aura/rules';

/**
 * Le match solo, joue entierement sur l appareil.
 *
 * Il fait tourner **le meme moteur** que le serveur : `@aura/rules` ne sait pas
 * ou il s execute. Ecrire une seconde logique de manche pour le mode hors ligne
 * garantirait qu un jour les deux divergent — et la divergence porterait sur ce
 * qu un joueur croit avoir appris du jeu.
 *
 * Aucune horloge n est lue ici : le temps entre par `advanceTo`. C est ce qui
 * rend un match entier rejouable dans un test, et ce qui permettra de le
 * remplacer par le temps du serveur en ligne sans rien changer d autre.
 */

export interface SoloOptions {
  readonly seed: string;
  readonly opponent: AiProfileId;
  readonly startedAtMs?: number;
  readonly config?: BalanceConfig;
}

export interface SoloMatch {
  readonly state: MatchState;
  /** Effets produits par la derniere avancee, et par elle seule. */
  readonly effects: readonly MatchEffect[];
  /** Fait passer le temps ; les phases echues expirent dans l ordre. */
  advanceTo(nowMs: number): void;
  /** Taps du joueur pendant la recharge. */
  tap(taps: readonly RechargeTap[], atMs: number): void;
  /** Verrouille le choix du joueur. Rend `false` si le moteur le refuse. */
  lock(choice: Choice, timingTapAtMs: number | null, atMs: number): boolean;
}

/** Garde-fou : une manche saine ne demande qu une poignee de transitions. */
const MAX_STEPS_PER_ADVANCE = 32;

export function createSoloMatch(options: SoloOptions): SoloMatch {
  const config = options.config;
  const profile = AI_PROFILES[options.opponent];
  const startedAtMs = options.startedAtMs ?? 0;

  /**
   * Deux flux aleatoires separes.
   *
   * Le moteur tire ses orbes et sa jauge d un cote, l IA ses decisions de
   * l autre. Partager un seul flux ferait dependre la sequence d orbes du
   * nombre de decisions prises par l adversaire : un match cesserait d etre
   * rejouable des qu on toucherait au profil d IA.
   */
  const aiRng = createRng(deriveSeed(options.seed, 'solo', 'ai'));

  let step = createMatch(options.seed, { startedAtMs, ...(config ? { config } : {}) });
  let effects: MatchEffect[] = [...step.effects];

  const apply = (event: Parameters<typeof reduce>[1]): void => {
    step = config === undefined ? reduce(step.state, event) : reduce(step.state, event, config);
    effects.push(...step.effects);
  };

  /**
   * Styles que l adversaire a **reellement vus**.
   *
   * `seats.a.moves` n est rempli qu a la resolution d une manche : il ne
   * contient donc que du revele, jamais le choix en cours. C est la seule
   * lecture sure — `pending` porterait le choix que le joueur vient de
   * verrouiller.
   */
  const revealedStyles = (): readonly Style[] => step.state.seats.a.moves.map((move) => move.style);

  /**
   * L adversaire joue sa phase.
   *
   * Il ne lit jamais `pending` : le choix en cours du joueur n existe pas avant
   * la revelation, exactement comme sur le reseau (regle d or n°4). Une IA
   * locale qui y jetterait un oeil tricherait sans qu aucun test de score ne
   * s en apercoive — elle gagnerait simplement un peu trop souvent.
   */
  const playOpponent = (): void => {
    const state = step.state;
    const context = state.roundContext;
    if (context === null) return;

    if (state.phase === 'recharge' && state.pending.b.taps.length === 0) {
      const taps = decideRechargeTaps(profile, context.orbs, aiRng, config);
      if (taps.length > 0) apply({ type: 'RECHARGE_TAPS', seat: 'b', taps, atMs: 0 });
      return;
    }

    if (state.phase === 'choice' && state.pending.b.locked === null) {
      const choice = decideChoice(
        {
          profile,
          rng: aiRng,
          energy: state.seats.b.energy,
          ultimateGauge: state.seats.b.ultimateGauge,
          previousMoves: state.seats.b.moves,
          opponentStyles: revealedStyles(),
          round: state.round,
          shiny: context.shiny.b,
        },
        config,
      );
      const timingTapAtMs = decideTimingTap(profile, context.gauge, aiRng, config);
      apply({
        type: 'CHOICE_LOCKED',
        seat: 'b',
        choice,
        timingTapAtMs,
        atMs: state.phaseEndsAtMs - 1,
      });
    }
  };

  playOpponent();

  return {
    get state(): MatchState {
      return step.state;
    },

    get effects(): readonly MatchEffect[] {
      return effects;
    },

    advanceTo(nowMs) {
      effects = [];
      for (let i = 0; i < MAX_STEPS_PER_ADVANCE; i++) {
        const state = step.state;
        if (state.phase === 'ended' || nowMs < state.phaseEndsAtMs) break;
        apply({ type: 'PHASE_TIMEOUT', atMs: state.phaseEndsAtMs });
        playOpponent();
      }
    },

    tap(taps, atMs) {
      if (step.state.phase !== 'recharge' || taps.length === 0) return;
      apply({ type: 'RECHARGE_TAPS', seat: 'a', taps, atMs });
    },

    lock(choice, timingTapAtMs, atMs) {
      if (step.state.phase !== 'choice' || step.state.pending.a.locked !== null) return false;
      apply({ type: 'CHOICE_LOCKED', seat: 'a', choice, timingTapAtMs, atMs });
      // Le moteur reste seul juge : un cout trop eleve ou un style interdit
      // produit un refus, et le client ne doit surtout pas le deviner lui-meme.
      const rejected = step.effects.some(
        (effect) => effect.type === 'CHOICE_REJECTED' && effect.seat === 'a',
      );
      return !rejected;
    },
  };
}
