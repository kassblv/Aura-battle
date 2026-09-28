import { describe, expect, it } from 'vitest';
import { AURA_COLORS, AURA_EFFECTS, HAIRSTYLES, OUTFITS } from './cosmetics.js';
import {
  FEATURED_CYCLE_DAYS,
  FEATURED_DISCOUNT,
  FEATURED_PER_DAY,
  discountedPrice,
  featuredForDay,
  isFeatured,
} from './featured.js';

/** Tout ce qui a un prix, donc tout ce qui peut figurer en vitrine. */
const paid = [...AURA_EFFECTS, ...AURA_COLORS, ...HAIRSTYLES, ...OUTFITS].filter(
  (item) => item.price > 0,
);

describe('featuredForDay', () => {
  it('en met le compte annonce', () => {
    for (const day of [0, 1, 19, 400, 20_718]) {
      expect(featuredForDay(day)).toHaveLength(FEATURED_PER_DAY);
    }
  });

  /*
    Deterministe : c'est ce qui permet de ne RIEN stocker de la vitrine. Le
    serveur applique la remise et le client l'affiche a partir du meme nombre,
    donc ils ne peuvent pas annoncer deux prix differents.
  */
  it('rend la meme vitrine pour le meme jour', () => {
    expect(featuredForDay(77)).toEqual(featuredForDay(77));
  });

  it('change d un jour a l autre', () => {
    const jours = new Set([0, 1, 2, 3, 4, 5, 6].map((d) => featuredForDay(d).join()));
    expect(jours.size).toBeGreaterThan(1);
  });

  it('ne repete pas un article dans la meme vitrine', () => {
    for (const day of [0, 5, 31, 900]) {
      const ids = featuredForDay(day);
      expect(new Set(ids).size, `jour ${String(day)}`).toBe(ids.length);
    }
  });

  /*
    Uniquement des articles PAYANTS. Mettre en vitrine, a moins trente pour
    cent, quelque chose qui est deja offert a tout le monde serait une fausse
    bonne affaire — et la premiere qu'un joueur remarque lui apprend a se
    mefier de toutes les suivantes.
  */
  it('ne met en vitrine que ce qui a un prix', () => {
    const payants = new Set(paid.map((item) => item.id));
    for (const day of [0, 3, 12, 88, 365]) {
      for (const id of featuredForDay(day)) {
        expect(payants, `jour ${String(day)} : ${id}`).toContain(id);
      }
    }
  });

  /*
    Jamais trois articles de la meme nature : ce serait une journee a sujet
    unique, et un joueur qui n'a que faire des couleurs d'aura n'aurait aucune
    raison de revenir ce jour-la.

    Deux de la meme nature arrive, une journee sur cinq, quand le cycle finit
    son tour — les natures n'ont pas toutes le meme nombre d'articles, et
    egaliser demanderait soit d'en retirer, soit d'en inventer.
  */
  it('ne fait jamais une vitrine d une seule nature', () => {
    const kindOf = (id: string): string => id.split('.')[0] ?? id;
    for (let day = 0; day < 3 * FEATURED_CYCLE_DAYS; day += 1) {
      const kinds = new Set(featuredForDay(day).map(kindOf));
      expect(kinds.size, `jour ${String(day)}`).toBeGreaterThanOrEqual(2);
    }
  });

  /*
    Le coeur du cycle, et ce qu'un tirage par hachage ne donnait pas : la
    vitrine d'hier ne revient pas aujourd'hui. Une vitrine qui se repete ne
    donne aucune raison de revenir — et avec quinze articles tires trois par
    trois, la repetition arrivait environ une journee sur cinq.
  */
  it('ne reprend aucun article de la veille', () => {
    for (let day = 0; day < 3 * FEATURED_CYCLE_DAYS; day += 1) {
      const hier = new Set(featuredForDay(day - 1));
      for (const id of featuredForDay(day)) {
        expect(hier.has(id), `jour ${String(day)} : ${id} etait deja hier`).toBe(false);
      }
    }
  });

  /*
    L'attente est BORNEE. Quelqu'un qui veut un article precis sait qu'il
    passera, et quand : au plus un tour complet. Sans cette garantie, un tirage
    peut faire attendre des semaines et le joueur finit par acheter au prix
    plein en se disant qu'il a ete floue.
  */
  it('montre tout le catalogue payant en un tour', () => {
    const vus = new Set<string>();
    for (let day = 0; day < FEATURED_CYCLE_DAYS; day += 1) {
      for (const id of featuredForDay(day)) vus.add(id);
    }
    for (const item of paid) {
      expect(vus, item.id).toContain(item.id);
    }
  });

  it('supporte un jour absurde', () => {
    expect(featuredForDay(-9)).toHaveLength(FEATURED_PER_DAY);
    expect(featuredForDay(Number.NaN)).toHaveLength(FEATURED_PER_DAY);
  });
});

describe('isFeatured', () => {
  it('reconnait un article de la vitrine du jour', () => {
    const [first] = featuredForDay(12);
    expect(isFeatured(first ?? '', 12)).toBe(true);
  });

  it('refuse un article qui n en est pas', () => {
    const vitrine = new Set(featuredForDay(12));
    const autre = paid.find((item) => !vitrine.has(item.id));
    expect(isFeatured(autre?.id ?? '', 12)).toBe(false);
  });

  /*
    Et surtout : la vitrine d'HIER ne vaut plus. Sans cette borne, garder
    l'ecran ouvert par-dessus minuit suffirait a payer le prix remise le
    lendemain.
  */
  it('ne reconnait pas la vitrine de la veille', () => {
    for (const day of [12, 13, 40, 20_718]) {
      for (const id of featuredForDay(day - 1)) {
        expect(isFeatured(id, day), `jour ${String(day)} : ${id}`).toBe(false);
      }
    }
  });
});

describe('discountedPrice', () => {
  it('applique la remise annoncee', () => {
    expect(discountedPrice(100)).toBe(Math.round(100 * (1 - FEATURED_DISCOUNT)));
  });

  /*
    Un prix est un nombre entier de pieces : la bourse l'est en base, et
    afficher « 62,3 ◈ » n'aurait aucun sens.
  */
  it('rend un entier', () => {
    for (const price of [90, 120, 150, 280, 400, 850, 1_500]) {
      expect(Number.isInteger(discountedPrice(price)), String(price)).toBe(true);
    }
  });

  /*
    La remise est une PART, entre zero et un.

    C'est le seul invariant reellement violable ici, et je suis arrive a lui
    par elimination. J'avais d'abord ecrit deux garde-fous dans
    `discountedPrice` — « jamais zero », « jamais plus cher » — que les
    mutations ont montres inatteignables a trente pour cent. Puis un test
    « aucun article ne peut devenir gratuit », qui passait meme a
    quatre-vingt-quinze pour cent : le prix payant le plus bas du catalogue
    vaut 80, il faudrait depasser 99 % pour le ramener a zero.

    Reste ce qui peut vraiment etre ecrit de travers : un chiffre hors plage.
  */
  it('garde une remise comprise entre zero et le prix plein', () => {
    expect(FEATURED_DISCOUNT).toBeGreaterThan(0);
    expect(FEATURED_DISCOUNT).toBeLessThan(1);
  });

  /* Une remise reduit : le prix remise est STRICTEMENT plus bas. */
  it('rend toujours moins que le prix plein', () => {
    for (const item of paid) {
      expect(discountedPrice(item.price), item.id).toBeLessThan(item.price);
    }
  });

  it('ne fait rien d un prix nul', () => {
    // Un article offert n'a pas de remise a recevoir.
    expect(discountedPrice(0)).toBe(0);
  });
});
