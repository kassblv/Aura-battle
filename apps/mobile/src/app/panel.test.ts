import { describe, expect, it } from 'vitest';
import { PANEL_MAX_WIDTH, PANEL_MIN_FREE, panelLayout } from './panel.js';

describe('panelLayout', () => {
  /*
    La boutique et le vestiaire ne sont PAS des panneaux comme les autres.

    Ailleurs, la moitie gauche de l ecran est perdue et le panneau peut la
    prendre. Ici elle porte le personnage habille de ce qu on essaie : c est
    l etalage. La largeur du panneau est donc un arbitrage entre deux choses
    qu on veut toutes les deux voir, et cet arbitrage se decide une fois.
  */
  it('donne deux colonnes sur un telephone en paysage', () => {
    const layout = panelLayout(844);
    expect(layout.width).toBe(PANEL_MAX_WIDTH);
    expect(layout.columns).toBe(2);
  });

  /*
    Le plafond compte autant que la part. Sur un ecran large, 62 % feraient un
    panneau de 900 pixels pour des articles qui en demandent 240 : la liste
    s etirerait au lieu de se densifier, et le personnage reculerait pour rien.
  */
  it('ne depasse jamais son plafond, meme sur un grand ecran', () => {
    expect(panelLayout(1600).width).toBe(PANEL_MAX_WIDTH);
    expect(panelLayout(3000).width).toBe(PANEL_MAX_WIDTH);
  });

  /*
    La place laissee au personnage est un plancher, pas un reste.

    Sans elle, un ecran etroit donnerait 62 % au panneau et le reste au sujet —
    et « le reste » finit par etre une bande ou l on ne distingue plus une
    tenue d une autre. On prend au panneau, pas a l etalage.
  */
  it('laisse toujours de quoi voir le personnage', () => {
    for (const width of [600, 667, 700, 812, 844]) {
      expect(width - panelLayout(width).width).toBeGreaterThanOrEqual(PANEL_MIN_FREE);
    }
  });

  /*
    Une seule colonne quand deux ne tiendraient pas : deux colonnes de 150
    pixels couperaient chaque nom au troisieme caractere. Mieux vaut defiler
    plus longtemps que lire moins.
  */
  it('repasse a une colonne quand le panneau se resserre', () => {
    expect(panelLayout(667).columns).toBe(1);
    expect(panelLayout(600).columns).toBe(1);
  });

  /*
    Le portrait est bloque par l ecran « tourne ton telephone », mais la
    fonction doit quand meme rendre quelque chose de sense : une largeur
    plancher, jamais zero ni un nombre negatif.
  */
  it('rend une largeur utilisable meme sur un ecran absurde', () => {
    for (const width of [390, 200, 0, -100, Number.NaN]) {
      const layout = panelLayout(width);
      expect(layout.width).toBeGreaterThan(0);
      expect(Number.isFinite(layout.width)).toBe(true);
      expect(layout.columns).toBe(1);
    }
  });

  /* La largeur est un nombre de pixels : un demi-pixel ne sert personne. */
  it('rend des pixels entiers', () => {
    for (const width of [703, 777, 801, 843]) {
      expect(Number.isInteger(panelLayout(width).width)).toBe(true);
    }
  });
});
