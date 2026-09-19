import { describe, expect, it } from 'vitest';
import { leagueProgress, styleShares, summarize, type PlayerProfile } from './profile.js';

const profile = (over: Partial<PlayerProfile> = {}): PlayerProfile => ({
  name: 'Kassim',
  tag: 'KAS#4417',
  league: 'Or II',
  lp: 1240,
  lpForNextLeague: 1500,
  matches: 128,
  wins: 79,
  currentStreak: 3,
  bestStreak: 9,
  roundsByStyle: { calme: 120, hype: 170, provoc: 98 },
  ...over,
});

describe('summarize', () => {
  it('derive le taux de victoire plutot que de le stocker', () => {
    // Un taux stocke finit toujours par contredire les compteurs dont il sort.
    expect(summarize(profile()).winRate).toBeCloseTo(79 / 128, 10);
  });

  it('compte les defaites sans les stocker non plus', () => {
    expect(summarize(profile()).losses).toBe(49);
  });

  it('ne divise pas par zero pour un joueur qui n a jamais joue', () => {
    const fresh = summarize(profile({ matches: 0, wins: 0 }));
    expect(fresh.winRate).toBe(0);
    expect(fresh.losses).toBe(0);
  });

  it('garde la serie en cours et le record separes', () => {
    const stats = summarize(profile({ currentStreak: 3, bestStreak: 9 }));
    expect(stats.currentStreak).toBe(3);
    expect(stats.bestStreak).toBe(9);
  });
});

describe('leagueProgress', () => {
  it('donne la part parcourue vers la ligue suivante', () => {
    expect(leagueProgress(profile({ lp: 750, lpForNextLeague: 1500 }))).toBeCloseTo(0.5, 10);
  });

  it('borne a un : depasser le seuil n affiche pas une barre qui deborde', () => {
    expect(leagueProgress(profile({ lp: 1900, lpForNextLeague: 1500 }))).toBe(1);
  });

  it('rend zero quand aucun seuil n est defini', () => {
    // Derniere ligue : il n y a plus rien a viser, la barre ne ment pas.
    expect(leagueProgress(profile({ lpForNextLeague: 0 }))).toBe(0);
  });
});

describe('styleShares', () => {
  it('rend une part par style, qui somme a un', () => {
    const shares = styleShares(profile());
    expect(shares.map((s) => s.style)).toEqual(['calme', 'hype', 'provoc']);
    expect(shares.reduce((sum, s) => sum + s.share, 0)).toBeCloseTo(1, 10);
  });

  /**
   * L ordre est celui du cycle de contres, et il ne bouge jamais — surtout pas
   * selon les chiffres. Des barres qui changent de place d un profil a l autre
   * ne se comparent plus, et c est justement ce qu on vient y lire.
   */
  it('garde toujours le meme ordre, quel que soit le nombre de manches', () => {
    const shares = styleShares(profile());
    expect(shares.map((s) => s.style)).toEqual(['calme', 'hype', 'provoc']);
    expect(shares.map((s) => s.rounds)).toEqual([120, 170, 98]);

    const other = styleShares(profile({ roundsByStyle: { calme: 1, hype: 400, provoc: 20 } }));
    expect(other.map((s) => s.style)).toEqual(['calme', 'hype', 'provoc']);
  });

  it('rend des parts nulles plutot que des NaN pour un profil vide', () => {
    const shares = styleShares(profile({ roundsByStyle: { calme: 0, hype: 0, provoc: 0 } }));
    for (const share of shares) expect(share.share).toBe(0);
  });
});
