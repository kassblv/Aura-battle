import { QUALITY_TIERS, type QualitySetting, type QualityTier } from '../platform/quality.js';

/**
 * Ce que l ecran Reglages affiche.
 *
 * Les paliers portent des identifiants anglais dans le code et des noms
 * francais a l ecran : c est ici que la traduction se fait, une seule fois.
 * La regle d or n°7 tient des deux cotes.
 */

export interface QualityOption {
  readonly id: QualitySetting;
  readonly label: string;
  /** Ce que le palier change, en une ligne lisible sans vocabulaire technique. */
  readonly hint: string;
  readonly selected: boolean;
}

const LABELS: Readonly<Record<QualitySetting, string>> = Object.freeze({
  auto: 'Automatique',
  rich: 'Beau',
  balanced: 'Équilibré',
  smooth: 'Fluide',
});

/*
  Des consequences, pas des chiffres.

  « 1,25 de rapport de pixels, 120 places » ne dit rien a personne. Ce que le
  joueur veut savoir, c est ce qu il perd et ce qu il gagne.
*/
const HINTS: Readonly<Record<QualitySetting, string>> = Object.freeze({
  auto: 'Baisse la qualité toute seule si l’image saccade.',
  rich: 'Tout le public, toutes les particules, les mains détaillées.',
  balanced: 'Un public plus clairsemé et une image un peu moins fine.',
  smooth: 'Le minimum à l’écran, pour tenir 60 images par seconde partout.',
});

export function qualityOptions(setting: QualitySetting): readonly QualityOption[] {
  return (['auto', ...QUALITY_TIERS] as const).map((id) => ({
    id,
    label: LABELS[id],
    hint: HINTS[id],
    selected: id === setting,
  }));
}

/**
 * La phrase sous les boutons.
 *
 * En automatique, elle **nomme le palier reellement applique**. Sans cela une
 * descente est invisible : le joueur voit une foule qui s eclaircit sans
 * qu aucun ecran ne l explique, et il ira chercher la panne ailleurs.
 */
export function qualityNote(setting: QualitySetting, tier: QualityTier): string {
  if (setting !== 'auto') {
    return `Palier fixé sur « ${LABELS[setting]} ». L’image ne changera plus toute seule.`;
  }
  return `Actuellement : ${LABELS[tier]}. La qualité ne remonte qu’à la main.`;
}
