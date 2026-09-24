import { describe, expect, it } from 'vitest';
import {
  canAfford,
  newProfile,
  playerTag,
  leagueProgress,
  styleShares,
  summarize,
  type PlayerProfile,
} from './profile.js';

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
  wallet: { soft: 450, hard: 60 },
  xp: 4_146,
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
    expect(shares.map((s) => s.style)).toEqual(['calme', 'hype', 'provoc', 'acrobatie', 'prouesse']);
    expect(shares.reduce((sum, s) => sum + s.share, 0)).toBeCloseTo(1, 10);
  });

  /**
   * L ordre est celui du cycle de contres, et il ne bouge jamais — surtout pas
   * selon les chiffres. Des barres qui changent de place d un profil a l autre
   * ne se comparent plus, et c est justement ce qu on vient y lire.
   */
  it('garde toujours le meme ordre, quel que soit le nombre de manches', () => {
    const shares = styleShares(profile());
    expect(shares.map((s) => s.style)).toEqual(['calme', 'hype', 'provoc', 'acrobatie', 'prouesse']);
    expect(shares.map((s) => s.rounds)).toEqual([120, 170, 98, 0, 0]);

    const other = styleShares(profile({ roundsByStyle: { calme: 1, hype: 400, provoc: 20 } }));
    expect(other.map((s) => s.style)).toEqual(['calme', 'hype', 'provoc', 'acrobatie', 'prouesse']);
  });

  it('lit un profil enregistre avant les cinq familles', () => {
    // Un profil local ecrit avec trois styles n a pas les deux nouvelles cles.
    const shares = styleShares(profile({ roundsByStyle: { calme: 4, hype: 2, provoc: 2 } }));
    expect(shares.map((s) => s.style)).toEqual(['calme', 'hype', 'provoc', 'acrobatie', 'prouesse']);
    expect(shares.every((s) => Number.isFinite(s.share))).toBe(true);
    expect(shares.find((s) => s.style === 'acrobatie')).toEqual({ style: 'acrobatie', rounds: 0, share: 0 });
    expect(shares.find((s) => s.style === 'calme')?.share).toBe(0.5);
  });

  it('rend des parts nulles plutot que des NaN pour un profil vide', () => {
    const shares = styleShares(profile({ roundsByStyle: { calme: 0, hype: 0, provoc: 0 } }));
    for (const share of shares) expect(share.share).toBe(0);
  });
});

describe('canAfford', () => {
  it('laisse acheter ce qu on a les moyens de payer', () => {
    expect(canAfford(profile({ wallet: { soft: 450, hard: 0 } }), 450)).toBe(true);
    expect(canAfford(profile({ wallet: { soft: 449, hard: 0 } }), 450)).toBe(false);
  });

  /**
   * Ce qui est offert reste accessible meme a zero. La boutique ne vend que de
   * l apparence (regle d or n°3) : un joueur sans un sou doit pouvoir s habiller.
   */
  it('n exige rien pour un objet gratuit', () => {
    expect(canAfford(profile({ wallet: { soft: 0, hard: 0 } }), 0)).toBe(true);
  });

  it('refuse un prix negatif plutot que de crediter', () => {
    // Un prix negatif serait une erreur de donnees, pas une promotion.
    expect(canAfford(profile(), -100)).toBe(false);
  });
});

describe('newProfile', () => {
  /**
   * Un joueur qui vient de s'inscrire n'a rien gagne.
   *
   * Montrer 128 matchs et 1 240 points a quelqu'un qui n'a pas encore joue
   * n'est pas une coquetterie d'affichage : c'est un chiffre faux presente
   * comme le sien, et la premiere chose que le jeu lui apprend est qu'il ne
   * faut pas croire ce qu'il affiche.
   */
  it('part de zero, partout', () => {
    const fresh = newProfile('Kassim', 'p_abc');
    expect(fresh.matches).toBe(0);
    expect(fresh.wins).toBe(0);
    expect(fresh.lp).toBe(0);
    expect(fresh.currentStreak).toBe(0);
    expect(fresh.bestStreak).toBe(0);
    expect(fresh.wallet).toEqual({ soft: 0, hard: 0 });
    expect(fresh.roundsByStyle).toEqual({ calme: 0, hype: 0, provoc: 0, acrobatie: 0, prouesse: 0 });
  });

  it('ne divise pas par zero pour ce profil-la', () => {
    const stats = summarize(newProfile('Kassim', 'p_abc'));
    expect(stats.winRate).toBe(0);
    expect(leagueProgress(newProfile('Kassim', 'p_abc'))).toBeGreaterThanOrEqual(0);
  });

  it('porte le nom qu on lui donne', () => {
    expect(newProfile('Nova', 'p_1').name).toBe('Nova');
  });
});

describe('playerTag', () => {
  it('derive un tag stable de l identifiant', () => {
    // Stable : le meme joueur doit se reconnaitre d'une session a l'autre.
    expect(playerTag('Kassim', 'p_abc')).toBe(playerTag('Kassim', 'p_abc'));
  });

  it('distingue deux joueurs de meme nom', () => {
    // C'est precisement ce a quoi sert un tag : les noms ne sont pas uniques.
    expect(playerTag('Kassim', 'p_1')).not.toBe(playerTag('Kassim', 'p_2'));
  });

  it('suit la forme NOM#1234', () => {
    expect(playerTag('Kassim', 'p_abc')).toMatch(/^[A-Z]{1,3}#\d{4}$/);
  });

  it('supporte un nom court ou accentue', () => {
    expect(playerTag('Zo\u00eb', 'p_1')).toMatch(/^[A-Z]{1,3}#\d{4}$/);
    expect(playerTag('Al', 'p_1')).toMatch(/^[A-Z]{1,2}#\d{4}$/);
  });
});
