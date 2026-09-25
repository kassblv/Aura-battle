import { ownedItemCoins } from '@aura/content';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SeasonState } from '@aura/protocol';
import { describe, expect, it } from 'vitest';
import { SeasonScreen, type SeasonProps } from './SeasonScreen.js';

const NOW = Date.parse('2026-09-25T12:00:00.000Z');

const state = (over: Partial<SeasonState> = {}): SeasonState => ({
  season: { number: 1, endsAt: '2026-10-27T00:00:00.000Z' },
  xp: 340,
  tier: 3,
  premium: false,
  claimed: [],
  wallet: { soft: 0, hard: 0 },
  ...over,
});

const render = (over: Partial<SeasonProps> = {}): string =>
  renderToStaticMarkup(
    createElement(SeasonScreen, {
      season: state(),
      owned: new Set<string>(),
      now: NOW,
      busy: false,
      error: null,
      celebration: null,
      trying: null,
      layout: { width: 520, columns: 2 },
      onClaim: () => undefined,
      onClaimAll: () => undefined,
      onBuyPremium: () => undefined,
      onTry: () => undefined,
      onClose: () => undefined,
      ...over,
    }),
  );

const cells = (html: string): readonly string[] =>
  [...html.matchAll(/<button[^>]*class="season__cell"[^>]*>/g)].map((match) => match[0]);

describe('SeasonScreen — l en-tete', () => {
  it('montre la saison, les jours restants et le palier', () => {
    const html = render();
    expect(html).toContain('Saison 1');
    expect(html).toContain('32 jours');
    expect(html).toContain('Palier 3');
    expect(html).toContain('40 / 100 XP');
    expect(html).toContain('width:40.0%');
  });

  it('dit « Dernier jour » plutot que « 1 jours »', () => {
    expect(render({ now: Date.parse('2026-10-26T12:00:00.000Z') })).toContain('Dernier jour');
  });

  it('prend la largeur decidee par panel.ts', () => {
    expect(render()).toMatch(/class="season"[^>]*style="width:520px"/);
  });
});

describe('SeasonScreen — la piste', () => {
  it('pose trente paliers, deux cases chacun', () => {
    expect(cells(render())).toHaveLength(60);
  });

  it('fait briller exactement les cases a prendre', () => {
    const claimable = cells(render()).filter((cell) => cell.includes('data-state="claimable"'));
    expect(claimable).toHaveLength(3);
    for (const cell of claimable) expect(cell).toContain('data-track="free"');
  });

  it('verrouille la piste premium tant qu elle n est pas achetee', () => {
    const html = render();
    // Le cadenas est sur chaque case : dans l'etiquette verticale, il debordait.
    expect(html).toContain('season__lock');
    expect(html).not.toContain('🔒 Premium');
    expect(render({ season: state({ premium: true }) })).not.toContain('season__lock');
  });

  it('eteint une case lointaine qui n a rien a essayer', () => {
    // Le palier 4 gratuit : des pieces, pas encore atteint.
    const far = cells(render()).find(
      (cell) => cell.includes('Palier 4, gratuit') && cell.includes('data-state="ahead"'),
    );
    expect(far).toContain('disabled');
  });

  // Un cosmetique lointain s'essaie quand meme : c'est ce qui donne envie d'y arriver.
  it('laisse essayer un cosmetique meme lointain', () => {
    const item = cells(render()).find((cell) => cell.includes('Palier 10, gratuit'));
    expect(item).toContain('data-kind="item"');
    expect(item).not.toContain('disabled');
  });

  it('nomme chaque case pour qui ne voit pas l ecran', () => {
    expect(render()).toContain('aria-label="Palier 1, gratuit : 40 pièces — à récupérer"');
  });

  it('annonce un cosmetique deja possede comme des pieces', () => {
    const html = render({ owned: new Set(['color.violet']) });
    expect(html).toContain(`déjà à toi : +${String(ownedItemCoins(80))} ◈`);
  });
});

describe('SeasonScreen — les gestes', () => {
  it('compte ce que « Tout recuperer » ramasse', () => {
    expect(render()).toMatch(/<button[^>]*class="season__all"[^>]*>Tout récupérer \(3\)/);
  });

  it('eteint « Tout recuperer » quand rien n attend', () => {
    const claimed = [1, 2, 3].map((tier) => ({ tier, track: 'free' as const }));
    expect(render({ season: state({ claimed }) })).toMatch(
      /<button[^>]*class="season__all"[^>]*disabled/,
    );
  });

  it('propose le premium a son prix, et dit ce qui manque', () => {
    const poor = render({ season: state({ wallet: { soft: 0, hard: 120 } }) });
    expect(poor).toContain('Débloquer le premium · 💎 500');
    expect(poor).toContain('Il te manque 💎 380');
    expect(poor).toMatch(/<button[^>]*class="season__premium"[^>]*disabled/);
  });

  it('allume le premium quand il est abordable, et dit ce qui attend', () => {
    const rich = render({ season: state({ wallet: { soft: 0, hard: 600 } }) });
    expect(rich).not.toMatch(/<button[^>]*class="season__premium"[^>]*disabled/);
    expect(rich).toContain('3 récompenses t’attendent');
  });

  it('remplace l offre par un insigne une fois le premium pris', () => {
    const html = render({ season: state({ premium: true }) });
    expect(html).not.toContain('season__premium');
    expect(html).toContain('season__owned');
  });

  it('eteint les cases a prendre pendant une requete', () => {
    const claimable = cells(render({ busy: true })).filter((cell) =>
      cell.includes('data-state="claimable"'),
    );
    for (const cell of claimable) expect(cell).toContain('disabled');
  });
});

describe('SeasonScreen — la fete', () => {
  it('fait sauter ce que le serveur vient d accorder, avec son gain', () => {
    const html = render({
      season: state({ claimed: [{ tier: 1, track: 'free' }] }),
      celebration: {
        key: 1,
        cells: [{ tier: 1, track: 'free' }],
        premium: false,
        size: 'small',
      },
    });
    const fresh = cells(html).filter((cell) => cell.includes('data-fresh="true"'));
    expect(fresh).toHaveLength(1);
    expect(fresh[0]).toContain('data-state="claimed"');
    expect(html).toContain('<span class="season__gain" aria-hidden="true">+40 ◈</span>');
  });

  it('echelonne une cascade « Tout recuperer »', () => {
    const html = render({
      season: state({
        claimed: [
          { tier: 1, track: 'free' },
          { tier: 2, track: 'free' },
        ],
      }),
      celebration: {
        key: 2,
        cells: [
          { tier: 1, track: 'free' },
          { tier: 2, track: 'free' },
        ],
        premium: false,
        size: 'jackpot',
      },
    });
    expect(html).toContain('--i:1');
  });

  it('eclaire la piste premium qui vient de s ouvrir', () => {
    const html = render({
      season: state({ premium: true }),
      celebration: { key: 3, cells: [], premium: true, size: 'jackpot' },
    });
    const unsealed = cells(html).filter((cell) => cell.includes('data-unsealed="true"'));
    expect(unsealed).toHaveLength(30);
  });
});

describe('SeasonScreen — sans saison', () => {
  it('dit hors ligne quand le passe n a jamais pu etre lu', () => {
    const html = render({ season: null });
    expect(html).toContain('hors ligne');
    expect(cells(html)).toHaveLength(0);
  });

  it('dit qu aucune saison n est en cours', () => {
    const html = render({ season: state({ season: null }) });
    expect(html).toContain('Aucune saison en cours');
    expect(cells(html)).toHaveLength(0);
  });

  it('montre le refus du serveur', () => {
    expect(render({ error: 'Le serveur a refusé.' })).toContain('role="alert"');
  });
});

describe('SeasonScreen — fin de saison', () => {
  // Non reclamees, les recompenses sont perdues au changement de saison.
  it('previent dans les derniers jours qu il reste des recompenses', () => {
    const endsAt = new Date(NOW + 2 * 24 * 60 * 60 * 1_000 - 60_000).toISOString();
    const html = render({ season: state({ tier: 3, season: { number: 1, endsAt } }) });
    expect(html).toMatch(/class="season__days"[^>]*data-urgent="true"/);
    expect(html).toContain('perdues à la fin de la saison');
  });

  it('se tait quand la fin est loin', () => {
    const html = render({ season: state({ tier: 3 }) });
    expect(html).not.toContain('perdues à la fin de la saison');
  });
});
