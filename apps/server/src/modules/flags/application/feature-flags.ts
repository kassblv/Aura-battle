import { describeCause } from '../../../shared/describe-cause.js';
import type { AppLog } from '../../../shared/log-port.js';
import { FLAG_NAMES, groupOf, type FlagGroup, type FlagName } from '../domain/flags.js';
import type { FlagAssignmentStore, FlagClock } from '../domain/ports.js';

/**
 * Borne de la memoire des inscriptions : au-dela, on oublie tout et l'on
 * reinscrit — un `ON CONFLICT DO NOTHING` de plus par joueur, rien de faux.
 */
const MAX_REMEMBERED = 100_000;

/**
 * Les interrupteurs d'experience, a la part en vigueur (spec 2026-09-26).
 *
 * **Tout est synchrone cote appelant.** L'ouverture d'un match ne peut rien
 * attendre entre le controle des sieges et leur reservation
 * (`match-opener.ts`) : le groupe se CALCULE, il ne se lit pas en base, et
 * l'inscription part sans qu'on l'attende. Une base muette coute une trace
 * d'affectation, jamais un duel.
 */
export class FeatureFlags {
  private readonly rollouts: Readonly<Record<FlagName, number>>;
  private readonly clock: FlagClock;
  private readonly store: FlagAssignmentStore | null;
  private readonly log: AppLog | null;
  private readonly assign: (flag: FlagName, playerId: string) => FlagGroup;

  constructor(deps: {
    rollouts: Readonly<Record<FlagName, number>>;
    clock: FlagClock;
    store?: FlagAssignmentStore | null;
    log?: AppLog | null;
    /**
     * Affectation imposee, pour les tests de bout en bout : un scenario doit
     * pouvoir asseoir un joueur temoin a cote d'un joueur expose sans
     * chercher des identifiants dont le hachage tombe du bon cote.
     */
    assign?: (flag: FlagName, playerId: string) => FlagGroup;
  }) {
    this.rollouts = deps.rollouts;
    this.clock = deps.clock;
    this.store = deps.store ?? null;
    this.log = deps.log ?? null;
    this.assign = deps.assign ?? ((flag, playerId) => groupOf(flag, playerId, this.rollouts[flag]));
  }

  /** Affectations deja inscrites par ce noeud (cles `drapeau:joueur`). */
  private readonly enrolled = new Set<string>();

  /** Le groupe d'un joueur, sans rien inscrire. */
  groupOf(flag: FlagName, playerId: string): FlagGroup {
    return this.assign(flag, playerId);
  }

  /**
   * Le groupe d'un joueur, **au moment ou il sert** — et sa trace en base.
   *
   * Les deux groupes s'inscrivent : un test A/B se lit par comparaison, et un
   * temoin qu'on n'aurait pas note serait un temoin qu'on ne retrouve pas.
   */
  enroll(flag: FlagName, playerId: string): FlagGroup {
    const group = this.assign(flag, playerId);
    const key = `${flag}:${playerId}`;
    // La ligne existe des la premiere inscription : on ne la reecrit pas a
    // chaque match. Un echec retire la cle, et le match suivant reessaie.
    if (this.store !== null && !this.enrolled.has(key)) {
      if (this.enrolled.size >= MAX_REMEMBERED) this.enrolled.clear();
      this.enrolled.add(key);
      void this.store
        .record({ playerId, flag, group, atMs: this.clock.now() })
        .catch((cause: unknown) => {
          this.enrolled.delete(key);
          // Jamais l'identifiant du joueur : un journal ne doit pas defaire
          // une suppression de compte.
          this.log?.warn(`affectation « ${flag} » non inscrite : ${describeCause(cause)}`);
        });
    }
    return group;
  }

  /** Les drapeaux declares en code, avec la part en vigueur sur ce noeud. */
  declared(): readonly { readonly flag: FlagName; readonly rollout: number }[] {
    return FLAG_NAMES.map((flag) => ({ flag, rollout: this.rollouts[flag] }));
  }
}
