import { createHash } from 'node:crypto';

/**
 * Interrupteurs d'experience (spec 2026-09-26 « Bulle d'intention en test A/B »).
 *
 * **Declares en code, regles depuis le panneau.** Le nom et la part par
 * defaut vivent ici : un drapeau qu'on ajouterait en base serait une porte que
 * n'importe quelle faille d'ecriture ouvrirait. Le reglage (part, mesure)
 * vit en base (`FlagSetting`, ADR 0018) ; l'environnement
 * (`FLAG_INTENT_BUBBLE_ROLLOUT`) ne donne que la valeur de depart.
 *
 * Pur : aucune I/O. Le hachage vient de `node:crypto`, qui n'est ni un cadre
 * ni un depot — il rend la meme valeur partout, pour toujours.
 */

export const FLAGS = Object.freeze({
  /**
   * Bulle d'intention (docs/01 §10) : partie rapide et invitation seulement.
   * Pendant une mesure, la part est FIGEE (seul 0 est sur) : changer de part,
   * c'est ouvrir une nouvelle mesure, qui re-hache les groupes (docs/10).
   */
  intentBubble: Object.freeze({ defaultRollout: 50 }),
});

export type FlagName = keyof typeof FLAGS;

export const FLAG_NAMES: readonly FlagName[] = Object.freeze(Object.keys(FLAGS) as FlagName[]);

/** `treatment` : expose a la nouveaute. `control` : le jeu tel qu'il etait. */
export type FlagGroup = 'treatment' | 'control';

export const FLAG_GROUPS: readonly FlagGroup[] = Object.freeze(['treatment', 'control']);

/** Une part exposee : un entier de 0 a 100. */
export function isRollout(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 100;
}

/**
 * Le « seau » d'un joueur pour un drapeau et une mesure, de 0 a 99.
 *
 * `sha256(drapeau:joueur)` pour la premiere mesure, `sha256(drapeau#epoque:joueur)`
 * pour les suivantes. Le drapeau fait partie de la cle, sinon toutes les
 * experiences exposeraient les memes joueurs et se contamineraient ; l'epoque
 * aussi, sinon une nouvelle mesure reprendrait les groupes de l'ancienne.
 *
 * **L'epoque 1 garde la cle d'avant les epoques, a l'octet pres** : les
 * inscriptions faites avant le panneau restent dans leur groupe.
 *
 * Les 48 premiers bits suffisent a un modulo 100 sans biais mesurable, et
 * restent exacts dans un `number`.
 */
export function bucketOf(flag: FlagName, playerId: string, epoch = 1): number {
  const key = epoch === 1 ? `${flag}:${playerId}` : `${flag}#${String(epoch)}:${playerId}`;
  const digest = createHash('sha256').update(key).digest();
  return digest.readUIntBE(0, 6) % 100;
}

/**
 * Le groupe d'un joueur, sans rien stocker pour le decider.
 *
 * Seau strictement sous la part : elargir la part n'ajoute que des joueurs,
 * elle ne fait jamais changer de groupe un joueur deja expose.
 */
export function groupOf(flag: FlagName, playerId: string, rollout: number, epoch = 1): FlagGroup {
  return bucketOf(flag, playerId, epoch) < rollout ? 'treatment' : 'control';
}

/**
 * Le reglage d'un drapeau (table `FlagSetting`) : la part en vigueur, et la
 * MESURE en cours — son numero, sa part, son debut.
 */
export interface FlagSettingState {
  readonly flag: FlagName;
  /** Part exposee en vigueur, 0 a 100 (0 : coupe). */
  readonly rollout: number;
  /** Part de la mesure en cours, 1 a 100 : celle que « rallumer » retrouve. */
  readonly measureRollout: number;
  /** Numero de la mesure, a partir de 1. */
  readonly epoch: number;
  readonly measureStartedAtMs: number;
}

/**
 * Ce que le panneau peut faire d'un drapeau. Jamais « changer la part » d'une
 * mesure en cours : cela melange les groupes (relecture finale du chantier
 * n°9). Couper, rallumer a la part de la mesure, ou ouvrir une nouvelle mesure.
 */
export type FlagAction =
  | { readonly action: 'pause' }
  | { readonly action: 'resume' }
  | { readonly action: 'new-measure'; readonly rollout: number };

export class InvalidFlagActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidFlagActionError';
  }
}

/** Une part de mesure : 1 a 100 — une mesure a 0 n'expose personne et ne mesure rien. */
function isMeasureRollout(value: number): boolean {
  return isRollout(value) && value >= 1;
}

/** Le reglage de depart d'un drapeau, depuis l'environnement (`FLAG_*_ROLLOUT`). */
export function initialFlagState(flag: FlagName, rollout: number, atMs: number): FlagSettingState {
  if (!isRollout(rollout)) throw new InvalidFlagActionError(`part invalide : ${String(rollout)}`);
  return {
    flag,
    rollout,
    // Un drapeau coupe par l'environnement garde une mesure qu'on peut rallumer.
    measureRollout: rollout >= 1 ? rollout : FLAGS[flag].defaultRollout,
    epoch: 1,
    measureStartedAtMs: atMs,
  };
}

/** Le reglage apres une action du panneau. Pur. */
export function applyFlagAction(
  state: FlagSettingState,
  action: FlagAction,
  atMs: number,
): FlagSettingState {
  switch (action.action) {
    case 'pause':
      return { ...state, rollout: 0 };
    case 'resume':
      return { ...state, rollout: state.measureRollout };
    case 'new-measure':
      if (!isMeasureRollout(action.rollout)) {
        throw new InvalidFlagActionError(`part de mesure invalide : ${String(action.rollout)}`);
      }
      return {
        flag: state.flag,
        rollout: action.rollout,
        measureRollout: action.rollout,
        epoch: state.epoch + 1,
        measureStartedAtMs: atMs,
      };
  }
}

/** Ce nom est-il un drapeau declare en code ? Une saisie ne cree jamais de drapeau. */
export function isFlagName(value: string): value is FlagName {
  return Object.prototype.hasOwnProperty.call(FLAGS, value);
}
