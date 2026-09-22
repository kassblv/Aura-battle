/**
 * Catalogue initial des cosmetiques (docs/07-content-pipeline.md).
 *
 * Regle d'or n°3 : aucun avantage payant. Rien ici ne porte de multiplicateur,
 * de puissance ni de cout en energie — ce sont des apparences. Le prototype
 * faisait payer un multiplicateur d'aura ; dans les regles actuelles, ce
 * multiplicateur appartient au **niveau d'amplificateur** (A0 a A4, accessible
 * a tous), et les effets visuels n'en sont que des habillages.
 */

export type AmplifierLevel = 0 | 1 | 2 | 3 | 4;

/** Les cinq niveaux, dans l'ordre. Le pendant de `TIERS` pour l'amplificateur. */
export const AMPLIFIER_LEVELS: readonly AmplifierLevel[] = [0, 1, 2, 3, 4];

export type Rarity = 'default' | 'common' | 'rare' | 'epic' | 'legendary';

export interface AuraEffect {
  readonly id: string;
  readonly name: { readonly fr: string };
  /** Niveau d'amplificateur que cet effet habille. */
  readonly level: AmplifierLevel;
  readonly rarity: Rarity;
  /** Prix en monnaie douce. 0 = offert a tous. */
  readonly price: number;
}

/**
 * Effets d'aura, ranges par niveau d'amplificateur.
 *
 * Le premier de chaque niveau est celui de la table de docs/01 §3 et il est
 * offert. Les autres viennent du prototype, ou ils portaient leur propre
 * multiplicateur : on les a ranges selon leur cout d'origine, ce qui les place
 * exactement sur le niveau qu'ils habillaient deja.
 */
export const AURA_EFFECTS: readonly AuraEffect[] = Object.freeze([
  { id: 'fx.glow', name: { fr: 'Lueur' }, level: 0, rarity: 'default', price: 0 },
  { id: 'fx.sparks', name: { fr: 'Étincelles' }, level: 1, rarity: 'default', price: 0 },
  { id: 'fx.flames', name: { fr: 'Flammes' }, level: 1, rarity: 'rare', price: 400 },
  { id: 'fx.lightning', name: { fr: 'Éclairs' }, level: 2, rarity: 'default', price: 0 },
  { id: 'fx.shock', name: { fr: 'Onde de choc' }, level: 2, rarity: 'epic', price: 850 },
  { id: 'fx.vortex', name: { fr: 'Vortex' }, level: 3, rarity: 'default', price: 0 },
  { id: 'fx.dark', name: { fr: 'Aura noire' }, level: 3, rarity: 'epic', price: 850 },
  { id: 'fx.galaxy', name: { fr: 'Galaxie' }, level: 4, rarity: 'default', price: 0 },
]);

export interface AuraColor {
  readonly id: string;
  readonly name: { readonly fr: string };
  readonly hex: string;
  readonly price: number;
}

export const AURA_COLORS: readonly AuraColor[] = Object.freeze([
  { id: 'color.gold', name: { fr: 'Or' }, hex: '#ffcf3f', price: 0 },
  { id: 'color.violet', name: { fr: 'Violet' }, hex: '#b36bff', price: 80 },
  { id: 'color.cyan', name: { fr: 'Cyan' }, hex: '#4fe3ff', price: 80 },
  { id: 'color.pink', name: { fr: 'Rose néon' }, hex: '#ff4fa3', price: 120 },
  { id: 'color.red', name: { fr: 'Rouge sang' }, hex: '#ff3b3b', price: 160 },
  { id: 'color.white', name: { fr: 'Blanc pur' }, hex: '#ffffff', price: 300 },
]);

export interface Hairstyle {
  readonly id: string;
  readonly name: { readonly fr: string };
  /** Modele 3D a instancier cote client. */
  readonly model: string;
  readonly price: number;
}

export const HAIRSTYLES: readonly Hairstyle[] = Object.freeze([
  { id: 'hair.court', name: { fr: 'Coupe courte' }, model: 'court', price: 0 },
  { id: 'hair.capuche', name: { fr: 'Capuche' }, model: 'capuche', price: 0 },
  { id: 'hair.pics', name: { fr: 'Pics' }, model: 'pics', price: 150 },
  { id: 'hair.bandeau', name: { fr: 'Bandeau' }, model: 'bandeau', price: 250 },
  { id: 'hair.long', name: { fr: 'Cheveux longs' }, model: 'long', price: 350 },
]);

export interface Outfit {
  readonly id: string;
  readonly name: { readonly fr: string };
  readonly jacket: string;
  readonly pants: string;
  readonly shoes: string;
  readonly shirt?: string;
  readonly tie?: string;
  readonly belt?: string;
  readonly zip?: boolean;
  readonly collar?: boolean;
  readonly price: number;
}

export const OUTFITS: readonly Outfit[] = Object.freeze([
  {
    id: 'outfit.noir',
    name: { fr: 'Sweat noir' },
    jacket: '#2d2744',
    pants: '#1b1729',
    shoes: '#f4f1ff',
    zip: true,
    price: 0,
  },
  {
    id: 'outfit.blanc',
    name: { fr: 'Survêtement blanc' },
    jacket: '#ece8f6',
    pants: '#bfb8d3',
    shoes: '#2a2340',
    zip: true,
    price: 0,
  },
  {
    id: 'outfit.rouge',
    name: { fr: 'Veste rouge' },
    jacket: '#c8323f',
    pants: '#231a30',
    shoes: '#f4f1ff',
    zip: true,
    price: 120,
  },
  {
    id: 'outfit.costume',
    name: { fr: 'Costume' },
    jacket: '#1f2645',
    pants: '#1f2645',
    shoes: '#120e1c',
    shirt: '#f3f0ff',
    tie: '#b0243a',
    price: 280,
  },
  {
    id: 'outfit.kimono',
    name: { fr: 'Kimono' },
    jacket: '#f1ece0',
    pants: '#f1ece0',
    shoes: '#6e5a3c',
    belt: '#1b1426',
    collar: true,
    price: 450,
  },
  {
    id: 'outfit.dore',
    name: { fr: 'Tenue dorée' },
    jacket: '#d9a520',
    pants: '#3a2a12',
    shoes: '#1b1426',
    zip: true,
    price: 700,
  },
]);

/** Teintes de peau du prototype. Offertes, jamais vendues. */
export const SKIN_TONES: readonly string[] = Object.freeze([
  '#f3cfae',
  '#d9a47a',
  '#a8714b',
  '#6b4430',
]);

/** Les effets disponibles pour un niveau d'amplificateur, le defaut en premier. */
export function effectsForLevel(level: AmplifierLevel): readonly AuraEffect[] {
  return AURA_EFFECTS.filter((effect) => effect.level === level);
}

/**
 * L'effet que ce joueur voit tourner autour de son aura a ce niveau.
 *
 * `docs/01-game-design.md` §3 : un amplificateur s'affiche sous le nom de son
 * effet offert, et « Flammes, Onde de choc, Aura noire deviennent des skins
 * cosmetiques d'un NIVEAU ». Un skin achete habille donc UN niveau — celui
 * qu'il a toujours habille depuis le prototype, ou il portait ce cout-la.
 *
 * Deux consequences, et les deux comptent :
 *
 * - le skin apparait au moment ou le joueur l'a paye, c'est-a-dire quand il
 *   depense pour cet amplificateur, et pas en fond permanent ou il finirait
 *   par ne plus se voir ;
 * - l'amplificateur reste LISIBLE a l'ecran. Son nom est celui de son effet :
 *   un skin qui deborderait sur les cinq niveaux effacerait l'information que
 *   la revelation existe pour donner.
 *
 * Un identifiant inconnu — vieux catalogue, message bricole — ne fait pas
 * disparaitre l'aura : on retombe sur l'effet offert.
 */
export function effectForLevel(level: AmplifierLevel, ownedIds: readonly string[]): AuraEffect {
  const owned = new Set(ownedIds);
  const skin = effectsForLevel(level).find(
    (candidate) => candidate.rarity !== 'default' && owned.has(candidate.id),
  );
  return skin ?? defaultEffectForLevel(level);
}

/**
 * La cle d'un mouvement dans la table des danses equipees.
 *
 * Elle vivait en UNE copie, cote client, alors que le format est documente
 * deux fois — dans `LoadoutData.dances` et dans le schema Prisma — et lu des
 * deux cotes. Le serveur doit y retrouver la danse equipee pour l'annoncer a
 * la revelation : deux conventions qui divergent ne produiraient aucune
 * erreur, seulement une danse qui ne s'affiche jamais chez l'adversaire.
 */
export function danceKey(move: { readonly style: string; readonly tier: number }): string {
  return `${move.style}.t${String(move.tier)}`;
}

/** L'effet offert a tous pour un niveau d'amplificateur. */
export function defaultEffectForLevel(level: AmplifierLevel): AuraEffect {
  const effect = effectsForLevel(level).find((candidate) => candidate.rarity === 'default');
  if (effect === undefined) {
    throw new Error(`Aucun effet par defaut pour le niveau A${level}`);
  }
  return effect;
}
