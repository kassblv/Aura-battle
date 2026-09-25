import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { defaultLook } from './wardrobe.js';
import { WardrobeScreen, type WardrobeProps } from './WardrobeScreen.js';

const render = (over: Partial<WardrobeProps> = {}): string =>
  renderToStaticMarkup(
    createElement(WardrobeScreen, {
      wardrobe: { look: defaultLook(), owned: new Set<string>() },
      onEquip: () => undefined,
      onEquipDance: () => undefined,
      trying: null,
      onTry: () => undefined,
      onShop: () => undefined,
      onSeason: () => undefined,
      onClose: () => undefined,
      layout: { width: 520, columns: 2 },
      ...over,
    }),
  );

/*
  Un exclusif de saison se gagne sur le passe : le vestiaire le dit, et
  l'essai renvoie au passe — jamais a une boutique qui ne le vend pas, ni avec
  un prix de « 0 ◈ ».
*/
describe('WardrobeScreen — exclusifs de saison', () => {
  it('marque l exclusif pas encore gagne, sans prix', () => {
    const html = render();
    expect(html).toContain('Tenue d’Aurore');
    expect(html).toContain('🎖️ Saison 1');
    // Aucun « 0 ◈ » : l'exclusif n'a pas de prix (« 280 ◈ » d'un autre article, si).
    expect(html).not.toMatch(/>0 ◈</);
  });

  it('renvoie l essai d un exclusif au passe, pas a la boutique', () => {
    const html = render({ trying: 'outfit.aurore' });
    expect(html).toContain('Au passe de saison');
    expect(html).not.toContain('En boutique');
  });

  it('garde la boutique pour un article qui s y vend', () => {
    expect(render({ trying: 'outfit.dore' })).toContain('En boutique');
  });
});
