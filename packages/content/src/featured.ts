import { AURA_COLORS, AURA_EFFECTS, HAIRSTYLES, OUTFITS } from './cosmetics.js';

/**
 * La vitrine du jour (jalon M8).
 *
 * **Elle s'ajoute, elle ne remplace pas.** Avec une trentaine d'articles au
 * catalogue, cacher le reste derriere une rotation serait hostile : quelqu'un
 * qui veut une danse precise attendrait des semaines pour la voir passer. Trois
 * articles sont donc mis en avant a prix reduit, et tout le reste demeure
 * achetable au prix plein.
 *
 * DETERMINISTE a partir du numero du jour, comme les defis quotidiens : rien
 * de la vitrine n'est stocke, et surtout le SERVEUR et le CLIENT calculent la
 * meme remise a partir du meme nombre. Deux calculs separes finiraient par
 * annoncer deux prix — et le prix affiche serait alors celui que le serveur
 * refuse.
 */

/** Trois articles : assez pour varier, assez peu pour se lire d'un coup d'oeil. */
export const FEATURED_PER_DAY = 3;

/**
 * Trente pour cent.
 *
 * Assez pour qu'on le remarque, pas assez pour qu'attendre sa vitrine devienne
 * la seule facon sensee d'acheter. Une remise trop forte ne fait pas revenir
 * le joueur : elle lui apprend a ne jamais payer le prix plein.
 */
export const FEATURED_DISCOUNT = 0.3;

/**
 * Le prix remise, en pieces entieres.
 *
 * Sans garde-fou, et c'est delibere. J'en avais ecrit deux — « jamais zero »
 * et « jamais au-dessus du prix plein » — avant de constater qu'aucun des deux
 * ne peut s'appliquer a trente pour cent : les retirer ne faisait echouer
 * aucun test. Un plafond qu'on ne peut pas atteindre invite le lecteur a
 * croire qu'il protege de quelque chose.
 *
 * L'invariant reel porte sur la CONSTANTE, pas sur le calcul : une remise
 * assez forte pour ramener un prix a zero serait un cadeau par accident.
 * `featured.test.ts` le verifie sur `FEATURED_DISCOUNT` — donc au moment ou
 * quelqu'un changerait le chiffre, et non en le rattrapant a l'execution.
 */
export function discountedPrice(price: number): number {
  if (price <= 0) return 0;
  return Math.round(price * (1 - FEATURED_DISCOUNT));
}

/** Ce qui peut figurer en vitrine : tout ce qui a un prix. */
const PAID = Object.freeze(
  [...AURA_EFFECTS, ...AURA_COLORS, ...HAIRSTYLES, ...OUTFITS]
    .filter((item) => item.price > 0)
    .map((item) => item.id),
);

/**
 * La nature d'un article, lue dans son identifiant.
 *
 * `fx.flames` est un effet, `aura.cyan` une couleur, `hair.spikes` une
 * coiffure. Le prefixe est la convention du catalogue (docs/07) et il suffit
 * ici : on ne cherche pas a typer, seulement a ne pas mettre trois articles de
 * la meme nature dans la meme vitrine.
 */
const kindOf = (id: string): string => id.split('.')[0] ?? id;

/**
 * Le catalogue payant, range en CYCLE.
 *
 * Un tirage par hachage rendait la meme vitrine deux jours d'affilee environ
 * une fois sur cinq — et une vitrine qui se repete ne donne aucune raison de
 * revenir. Un cycle le rend impossible par construction, et il apporte mieux :
 * l'attente devient BORNEE. Tout article payant passe en vitrine au moins une
 * fois par tour complet, donc quelqu'un qui en veut un precis sait qu'il
 * viendra, et quand.
 *
 * L'ordre alterne les natures en les prenant a tour de role : sans cela le
 * cycle montrerait les cinq couleurs d'aura d'affilee, soit presque deux
 * journees entieres sans rien d'autre.
 */
const CYCLE: readonly string[] = Object.freeze(buildCycle());

function buildCycle(): string[] {
  const buckets = new Map<string, string[]>();
  for (const id of PAID) {
    const kind = kindOf(id);
    buckets.set(kind, [...(buckets.get(kind) ?? []), id]);
  }

  // Les natures les plus fournies en premier : sans cela, celle qui en a cinq
  // se retrouve seule a la fin du cycle, et la derniere journee du tour
  // n'affiche plus qu'elle.
  const queues = [...buckets.values()].sort((left, right) => right.length - left.length);

  const cycle: string[] = [];
  let placed = true;
  while (placed) {
    placed = false;
    for (const queue of queues) {
      const next = queue.shift();
      if (next !== undefined) {
        cycle.push(next);
        placed = true;
      }
    }
  }
  return cycle;
}

/**
 * Les articles mis en avant ce jour-la.
 *
 * Une fenetre glissante sur le cycle : le jour N montre les trois suivants.
 * Deux consequences qu'un tirage ne donnait pas — la vitrine d'hier ne peut
 * pas revenir aujourd'hui, et chaque article passe une fois par tour.
 */
export function featuredForDay(day: number): readonly string[] {
  const safe = Number.isFinite(day) ? Math.trunc(day) : 0;
  const size = CYCLE.length;
  if (size === 0) return [];

  // Modulo qui reste positif : un jour negatif — horloge mal reglee — doit
  // rendre une vitrine valide, pas un tableau vide.
  const start = (((safe * FEATURED_PER_DAY) % size) + size) % size;

  return Array.from(
    { length: Math.min(FEATURED_PER_DAY, size) },
    (_, index) => CYCLE[(start + index) % size] ?? '',
  );
}

/** Le tour complet : nombre de jours pour que tout le catalogue soit passe. */
export const FEATURED_CYCLE_DAYS = Math.ceil(PAID.length / FEATURED_PER_DAY);

/**
 * Cet article est-il en vitrine CE jour-la ?
 *
 * Le jour est un parametre et non une lecture d'horloge : c'est ce qui permet
 * au serveur de decider avec SON horloge, et ce qui empeche la vitrine d'hier
 * de valoir encore. Sans cette borne, garder l'ecran ouvert par-dessus minuit
 * suffirait a payer le prix remise le lendemain.
 */
export function isFeatured(id: string, day: number): boolean {
  return featuredForDay(day).includes(id);
}
