import { describe, expect, it } from 'vitest';
import { emptyRecord, recordMatch, type PlayerRecord } from './record.js';

const start: PlayerRecord = emptyRecord();

describe('recordMatch', () => {
  it('part de rien', () => {
    expect(start).toEqual({ matches: 0, wins: 0, currentStreak: 0, bestStreak: 0, lp: 0 });
  });

  it('compte une victoire', () => {
    const after = recordMatch(start, { won: true, lp: 20 });
    expect(after).toEqual({ matches: 1, wins: 1, currentStreak: 1, bestStreak: 1, lp: 20 });
  });

  it('compte une defaite sans serie', () => {
    const after = recordMatch(start, { won: false, lp: 0 });
    expect(after.matches).toBe(1);
    expect(after.wins).toBe(0);
    expect(after.currentStreak).toBe(0);
  });

  /**
   * Un match nul compte comme joue, mais ne casse pas une serie.
   *
   * Il n'y a pas de vainqueur : traiter une egalite comme une defaite
   * punirait le joueur pour quelque chose qu'il n'a pas perdu.
   */
  it('laisse une serie intacte sur un match nul', () => {
    const deux = recordMatch(recordMatch(start, { won: true, lp: 20 }), { won: true, lp: 20 });
    const nul = recordMatch(deux, { won: null, lp: 0 });
    expect(nul.matches).toBe(3);
    expect(nul.wins).toBe(2);
    expect(nul.currentStreak).toBe(2);
  });

  it('remet la serie a zero sur une defaite', () => {
    const deux = recordMatch(recordMatch(start, { won: true, lp: 20 }), { won: true, lp: 20 });
    expect(recordMatch(deux, { won: false, lp: -18 }).currentStreak).toBe(0);
  });

  /** La meilleure serie est un souvenir : une defaite ne l'efface pas. */
  it('retient la meilleure serie meme apres une defaite', () => {
    let record = start;
    for (let i = 0; i < 4; i++) record = recordMatch(record, { won: true, lp: 20 });
    record = recordMatch(record, { won: false, lp: -18 });
    expect(record.bestStreak).toBe(4);
    expect(record.currentStreak).toBe(0);
  });

  /**
   * Les LP viennent du serveur, qui fait autorite : on les RECOPIE, on ne les
   * additionne pas. Additionner un delta dériverait a la premiere annonce
   * manquee, et le profil finirait par afficher un classement que la base ne
   * confirme pas.
   */
  it('recopie les LP annonces au lieu de les cumuler', () => {
    const apres = recordMatch(recordMatch(start, { won: true, lp: 20 }), { won: true, lp: 37 });
    expect(apres.lp).toBe(37);
  });

  it('ne descend jamais sous zero point de ligue', () => {
    expect(recordMatch(start, { won: false, lp: -5 }).lp).toBe(0);
  });

  it('ne modifie pas ce qu on lui donne', () => {
    const avant = { ...start };
    recordMatch(start, { won: true, lp: 20 });
    expect(start).toEqual(avant);
  });
});
