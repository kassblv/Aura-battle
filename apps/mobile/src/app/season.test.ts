import { ownedItemCoins } from '@aura/content';
import { SEASON_PASS } from '@aura/content';
import type { SeasonState } from '@aura/protocol';
import { describe, expect, it } from 'vitest';
import {
  claimableCount,
  daysLeft,
  describeReward,
  newlyClaimed,
  rewardSize,
  seasonView,
  tierReached,
  announcementAfterRead,
  visibleAnnouncement,
} from './season.js';

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

const view = (over: Partial<SeasonState> = {}, owned?: ReadonlySet<string>) => {
  const result = seasonView(state(over), NOW, owned);
  if (result === null) throw new Error('saison attendue');
  return result;
};

describe('seasonView — les cases', () => {
  it('montre les trente paliers du contenu', () => {
    expect(view().tiers).toHaveLength(SEASON_PASS.tiers.length);
    expect(view().lastTier).toBe(30);
  });

  it('ouvre la piste gratuite jusqu au palier atteint, pas au-dela', () => {
    const tiers = view().tiers;
    expect(tiers.slice(0, 3).map((tier) => tier.free.state)).toEqual([
      'claimable',
      'claimable',
      'claimable',
    ]);
    expect(tiers[3]?.free.state).toBe('ahead');
    expect(tiers[3]?.next).toBe(true);
    expect(tiers[2]?.reached).toBe(true);
    expect(tiers[3]?.reached).toBe(false);
  });

  /*
    Sans la piste premium, une case atteinte n'est pas « lointaine » : elle est
    SCELLEE. C'est elle qui rend l'achat tentant, donc elle se distingue.
  */
  it('scelle la piste premium tant qu elle n est pas achetee', () => {
    const tiers = view().tiers;
    expect(tiers[0]?.premium.state).toBe('sealed');
    expect(tiers[5]?.premium.state).toBe('ahead');
    expect(view().sealed).toBe(3);
  });

  it('ouvre la piste premium une fois achetee', () => {
    expect(view({ premium: true }).tiers[0]?.premium.state).toBe('claimable');
    expect(view({ premium: true }).sealed).toBe(0);
  });

  it('marque ce que le serveur dit deja encaisse', () => {
    const tiers = view({ claimed: [{ tier: 2, track: 'free' }] }).tiers;
    expect(tiers[1]?.free.state).toBe('claimed');
    expect(tiers[1]?.premium.state).toBe('sealed');
  });

  it('compte les cases a encaisser, sur les deux pistes', () => {
    expect(view().claimable).toBe(3);
    expect(view({ premium: true }).claimable).toBe(6);
    expect(view({ premium: true, claimed: [{ tier: 1, track: 'premium' }] }).claimable).toBe(5);
  });

  /*
    Le palier vient du SERVEUR. Une XP qui dirait autre chose ne rouvre rien :
    le client n'est pas juge de ce qui est atteint.
  */
  it('suit le palier du serveur, pas un calcul local sur l xp', () => {
    expect(view({ xp: 900, tier: 1 }).claimable).toBe(1);
  });
});

describe('seasonView — la barre', () => {
  it('mesure la progression dans le palier en cours', () => {
    const result = view({ xp: 340, tier: 3 });
    expect(result.xpInto).toBe(40);
    expect(result.xpNeeded).toBe(100);
    expect(result.progress).toBeCloseTo(0.4);
    expect(result.maxed).toBe(false);
  });

  it('ne deborde jamais de la barre', () => {
    expect(view({ xp: 999, tier: 3 }).progress).toBe(1);
    expect(view({ xp: 100, tier: 3 }).progress).toBe(0);
  });

  it('remplit la barre au dernier palier', () => {
    const result = view({ xp: 3200, tier: 30 });
    expect(result.maxed).toBe(true);
    expect(result.progress).toBe(1);
    expect(result.tiers.some((tier) => tier.next)).toBe(false);
  });
});

describe('seasonView — la piste premium', () => {
  it('dit combien de jetons il manque', () => {
    expect(view({ wallet: { soft: 0, hard: 120 } }).premiumShortfall).toBe(380);
    expect(view({ wallet: { soft: 0, hard: 900 } }).premiumShortfall).toBe(0);
    expect(view({ premium: true, wallet: { soft: 0, hard: 0 } }).premiumShortfall).toBe(0);
    expect(view().premiumPrice).toBe(SEASON_PASS.premiumPrice);
  });
});

describe('seasonView — le cadrage', () => {
  it('centre la premiere case a encaisser', () => {
    expect(view({ claimed: [{ tier: 1, track: 'free' }] }).focus).toBe(2);
  });

  it('centre le prochain palier quand rien n attend', () => {
    const claimed = [1, 2, 3].map((tier) => ({ tier, track: 'free' as const }));
    expect(view({ claimed }).focus).toBe(4);
    expect(view({ xp: 0, tier: 0 }).focus).toBe(1);
    expect(view({ xp: 3000, tier: 30, claimed: [] }).focus).toBe(1);
  });
});

describe('seasonView — hors saison', () => {
  it('ne rend rien quand aucune saison n est en cours', () => {
    expect(seasonView(state({ season: null }), NOW)).toBeNull();
    expect(claimableCount(state({ season: null }))).toBe(0);
    expect(claimableCount(null)).toBe(0);
  });

  it('donne la pastille du rail', () => {
    expect(claimableCount(state())).toBe(3);
  });
});

describe('daysLeft', () => {
  it('arrondit au-dessus : un jour tant que la saison n est pas finie', () => {
    expect(daysLeft('2026-09-26T00:00:00.000Z', NOW)).toBe(1);
    expect(daysLeft('2026-10-27T00:00:00.000Z', NOW)).toBe(32);
  });

  it('ne descend jamais sous zero', () => {
    expect(daysLeft('2026-09-01T00:00:00.000Z', NOW)).toBe(0);
    expect(daysLeft('pas une date', NOW)).toBe(0);
  });

  it('est rendu par la vue', () => {
    expect(view().daysLeft).toBe(32);
  });
});

describe('describeReward', () => {
  it('ecrit des pieces et des jetons avec leur symbole', () => {
    expect(describeReward({ kind: 'coins', amount: 40 })).toMatchObject({
      icon: '◈',
      label: '40',
      gain: '+40 ◈',
    });
    expect(describeReward({ kind: 'tokens', amount: 20 })).toMatchObject({
      icon: '💎',
      gain: '+20 💎',
    });
  });

  it('nomme un cosmetique d apres le catalogue', () => {
    const reward = describeReward({ kind: 'item', itemId: 'color.violet' });
    expect(reward.itemId).toBe('color.violet');
    expect(reward.label).not.toBe('color.violet');
    expect(reward.label.length).toBeGreaterThan(0);
    expect(reward.converts).toBe(false);
  });

  it('nomme chaque cosmetique du passe, sans jamais montrer un identifiant', () => {
    for (const tier of SEASON_PASS.tiers) {
      for (const reward of [tier.free, tier.premium]) {
        if (reward.kind !== 'item') continue;
        const label = describeReward(reward).label;
        expect(label, reward.itemId).not.toBe('Cosmétique');
        expect(label).not.toContain('.');
      }
    }
  });

  // Le serveur change un doublon en pieces : la case le dit avant qu'on la touche.
  it('annonce la conversion en pieces d un cosmetique deja possede', () => {
    const reward = describeReward(
      { kind: 'item', itemId: 'color.violet' },
      new Set(['color.violet']),
    );
    expect(reward.converts).toBe(true);
    // Le montant EXACT que le serveur accorde (prix de vitrine), pas le prix plein.
    expect(reward.gain).toBe(`+${String(ownedItemCoins(80))} ◈`);
  });

  /*
    Une case deja reclamee reste ce qu'elle a donne : l'objet. Apres la
    reclamation, l'inventaire relu le contient — sans cette regle, la case
    basculait en « deja a toi : +N ◈ » en pleine celebration.
  */
  it('garde l objet sur une case reclamee, meme une fois l objet possede', () => {
    const view = seasonView(
      state({ tier: 10, claimed: [{ tier: 10, track: 'free' }] }),
      NOW,
      new Set(['color.violet']),
    );
    const cell = view?.tiers[9]?.free;
    expect(cell?.state).toBe('claimed');
    expect(cell?.converts).toBe(false);
    expect(cell?.gain).toBe('Violet');
  });
});

describe('newlyClaimed', () => {
  it('rend ce que le serveur vient d accorder', () => {
    const before = state({ claimed: [{ tier: 1, track: 'free' }] });
    const after = state({
      claimed: [
        { tier: 1, track: 'free' },
        { tier: 2, track: 'free' },
        { tier: 1, track: 'premium' },
      ],
    });
    expect(newlyClaimed(before, after)).toEqual([
      { tier: 2, track: 'free' },
      { tier: 1, track: 'premium' },
    ]);
  });

  it('ne rend rien quand rien n a change', () => {
    const same = state({ claimed: [{ tier: 1, track: 'free' }] });
    expect(newlyClaimed(same, same)).toEqual([]);
  });
});

describe('tierReached', () => {
  it('annonce le palier atteint depuis la derniere lecture', () => {
    expect(tierReached(state({ tier: 3 }), state({ tier: 4 }))).toBe(4);
  });

  it('se tait sans montee, sans lecture precedente, ou d une saison a l autre', () => {
    expect(tierReached(state({ tier: 3 }), state({ tier: 3 }))).toBeNull();
    expect(tierReached(null, state({ tier: 4 }))).toBeNull();
    expect(
      tierReached(
        state({ tier: 3 }),
        state({ tier: 5, season: { number: 2, endsAt: '2026-12-22T00:00:00.000Z' } }),
      ),
    ).toBeNull();
  });
});

describe('rewardSize', () => {
  it('pese des pieces, du rare et le gros lot', () => {
    expect(rewardSize([{ tier: 2, track: 'free' }], false)).toBe('small');
    expect(rewardSize([{ tier: 5, track: 'free' }], false)).toBe('rare');
    expect(rewardSize([{ tier: 10, track: 'free' }], false)).toBe('rare');
    expect(
      rewardSize(
        [
          { tier: 1, track: 'free' },
          { tier: 2, track: 'free' },
        ],
        false,
      ),
    ).toBe('jackpot');
    expect(rewardSize([], true)).toBe('jackpot');
  });
});

/*
  « Palier N atteint » appartient au MATCH qui l'a fait atteindre : seule la
  lecture qui suit une fin de match l'annonce, et l'annonce ne se montre que
  pour ce match-la — jamais au suivant, jamais apres l'ouverture de l'ecran.
*/
describe('annonce de palier', () => {
  const at3 = state({ xp: 300, tier: 3 });
  const at4 = state({ xp: 400, tier: 4 });

  it('annonce le palier atteint, pour le match qui l a fait atteindre', () => {
    expect(announcementAfterRead(at3, at4, { matchRead: true, match: 7 })).toEqual({
      tier: 4,
      forMatch: 7,
    });
  });

  it('n annonce rien a la lecture qui suit l ouverture de l ecran', () => {
    expect(announcementAfterRead(at3, at4, { matchRead: false, match: 7 })).toBeNull();
  });

  it('ne montre une annonce qu au match qui l a produite', () => {
    const announcement = { tier: 4, forMatch: 7 };
    expect(visibleAnnouncement(announcement, 7)).toBe(4);
    expect(visibleAnnouncement(announcement, 8)).toBeNull();
    expect(visibleAnnouncement(null, 7)).toBeNull();
  });
});

/*
  Les recompenses non reclamees sont perdues au changement de saison. Dans
  les derniers jours, l'ecran et le rail le disent — une seule fois, pas de
  harcelement : rien d'urgent quand il n'y a rien a prendre.
*/
describe('fin de saison', () => {
  const endsIn = (days: number) =>
    new Date(NOW + days * 24 * 60 * 60 * 1_000 - 60_000).toISOString();

  it('presse quand il reste des recompenses et au plus trois jours', () => {
    const view = seasonView(state({ tier: 3, season: { number: 1, endsAt: endsIn(2) } }), NOW);
    expect(view?.urgent).toBe(true);
  });

  it('ne presse pas quand il reste du temps, ni quand tout est pris', () => {
    expect(
      seasonView(state({ tier: 3, season: { number: 1, endsAt: endsIn(10) } }), NOW)?.urgent,
    ).toBe(false);
    expect(
      seasonView(
        state({
          tier: 1,
          claimed: [{ tier: 1, track: 'free' }],
          season: { number: 1, endsAt: endsIn(2) },
        }),
        NOW,
      )?.urgent,
    ).toBe(false);
  });
});
