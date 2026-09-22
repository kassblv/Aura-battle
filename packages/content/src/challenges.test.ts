import { describe, expect, it } from 'vitest';
import {
  CHALLENGES,
  CHALLENGES_PER_DAY,
  challengeById,
  challengesForDay,
  accumulationOf,
  dayIndexOf,
  type ChallengeMetric,
} from './challenges.js';

describe('CHALLENGES', () => {
  /*
    `docs/01-game-design.md` §11 nomme cinq mesures : contres, parfaits,
    victoires, points de recharge, combos. Les cinq doivent exister, sinon le
    catalogue ne couvre pas ce que le design a promis — et personne ne le
    verrait, puisqu'un defi manquant se traduit juste par un defi de moins.
  */
  it('couvre les cinq mesures du game design', () => {
    const metrics = new Set(CHALLENGES.map((challenge) => challenge.metric));
    for (const metric of [
      'counters',
      'perfects',
      'wins',
      'rechargePoints',
      'bestCombo',
    ] as const satisfies readonly ChallengeMetric[]) {
      expect(metrics, metric).toContain(metric);
    }
  });

  it('a des identifiants uniques', () => {
    const ids = CHALLENGES.map((challenge) => challenge.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  /*
    Assez de defis pour que trois par jour ne se repetent pas d'un jour sur
    l'autre. Un tirage dans une reserve de trois donnerait les memes trois
    chaque matin, ce qui est pire qu'un defi fixe : ca promet de la variete
    sans en donner.
  */
  it('a une reserve plus large que ce qu un jour consomme', () => {
    expect(CHALLENGES.length).toBeGreaterThanOrEqual(3 * CHALLENGES_PER_DAY);
  });

  it('demande quelque chose et paie quelque chose', () => {
    for (const challenge of CHALLENGES) {
      expect(challenge.target, challenge.id).toBeGreaterThan(0);
      expect(challenge.reward, challenge.id).toBeGreaterThan(0);
      expect(Number.isInteger(challenge.target), challenge.id).toBe(true);
      expect(Number.isInteger(challenge.reward), challenge.id).toBe(true);
    }
  });

  /*
    Un combo est un MAXIMUM, pas une somme : « atteindre un combo de 12 » ne
    s'obtient pas en cumulant quatre combos de trois. Cumuler un maximum rend
    un defi difficile trivial, et c'est le genre d'erreur qu'on ne remarque
    qu'en voyant un joueur le valider sans rien reussir.
  */
  it('cumule ce qui se cumule, et garde le meilleur du reste', () => {
    for (const challenge of CHALLENGES) {
      const expected = challenge.metric === 'bestCombo' ? 'best' : 'sum';
      expect(accumulationOf(challenge.metric), challenge.id).toBe(expected);
    }
  });

  /*
    Chaque mesure a une regle, et une seule. Une mesure oubliee dans la table
    rendrait `undefined` — donc ni somme ni maximum, et une progression qui ne
    bouge jamais pour ce defi-la.
  */
  it('donne une regle d accumulation a chaque mesure', () => {
    for (const challenge of CHALLENGES) {
      expect(['sum', 'best'], challenge.metric).toContain(accumulationOf(challenge.metric));
    }
  });

  it('est gele', () => {
    expect(Object.isFrozen(CHALLENGES)).toBe(true);
  });
});

describe('challengesForDay', () => {
  it('en donne exactement le compte du jour', () => {
    for (const day of [0, 1, 17, 365, 4_812]) {
      expect(challengesForDay(day)).toHaveLength(CHALLENGES_PER_DAY);
    }
  });

  /*
    Deterministe, et c'est ce qui permet de ne RIEN stocker de la selection :
    le serveur et le client retrouvent la meme journee a partir du meme
    nombre. Un tirage aleatoire obligerait a persister le choix du jour, et a
    le rejouer identiquement apres un redemarrage.
  */
  it('rend toujours la meme journee pour le meme jour', () => {
    expect(challengesForDay(42)).toEqual(challengesForDay(42));
  });

  it('ne repete pas un defi dans la meme journee', () => {
    for (const day of [0, 3, 88, 1_000]) {
      const ids = challengesForDay(day).map((challenge) => challenge.id);
      expect(new Set(ids).size, `jour ${String(day)}`).toBe(ids.length);
    }
  });

  /*
    Trois defis qui mesurent la meme chose feraient une journee a un seul
    objectif — et un joueur qui n'aime pas cette mesure-la n'aurait rien a
    faire ce jour-la.
  */
  it('varie les mesures dans une meme journee', () => {
    for (const day of [0, 1, 2, 5, 9, 30, 77]) {
      const metrics = challengesForDay(day).map((challenge) => challenge.metric);
      expect(new Set(metrics).size, `jour ${String(day)}`).toBe(metrics.length);
    }
  });

  it('change d un jour a l autre', () => {
    const ids = (day: number): string =>
      challengesForDay(day)
        .map((c) => c.id)
        .join();
    const distincts = new Set([0, 1, 2, 3, 4, 5, 6].map(ids));
    expect(distincts.size).toBeGreaterThan(1);
  });

  it('supporte un jour negatif sans rien casser', () => {
    // Une horloge mal reglee, ou un fuseau qui recule : on rend une journee
    // valide plutot qu'un tableau vide que personne ne saurait afficher.
    expect(challengesForDay(-5)).toHaveLength(CHALLENGES_PER_DAY);
  });
});

describe('dayIndexOf', () => {
  /*
    Minuit UTC, pour tout le monde. Un decoupage par fuseau obligerait a
    stocker celui de chaque joueur et a decider ce qui arrive quand il voyage
    — deux problemes crees pour une journee qui commence de toute facon quand
    le joueur ouvre le jeu.
  */
  it('compte les jours a partir de minuit UTC', () => {
    expect(dayIndexOf(Date.parse('2026-09-22T00:00:00Z'))).toBe(
      dayIndexOf(Date.parse('2026-09-22T23:59:59Z')),
    );
    expect(dayIndexOf(Date.parse('2026-09-23T00:00:00Z'))).toBe(
      dayIndexOf(Date.parse('2026-09-22T00:00:00Z')) + 1,
    );
  });

  it('avance d un par jour', () => {
    const start = Date.parse('2026-01-01T12:00:00Z');
    const day = 86_400_000;
    for (let i = 1; i <= 5; i += 1) {
      expect(dayIndexOf(start + i * day)).toBe(dayIndexOf(start) + i);
    }
  });
});

describe('challengeById', () => {
  it('retrouve un defi du catalogue', () => {
    const first = CHALLENGES[0];
    expect(challengeById(first?.id ?? '')).toEqual(first);
  });

  /*
    Un identifiant inconnu vient d'un catalogue plus ancien ou plus recent :
    on rend `undefined` et l'appelant l'ignore, plutot que de lever et de
    faire echouer l'affichage de TOUS les defis a cause d'un seul.
  */
  it('rend undefined pour ce qu il ne connait pas', () => {
    expect(challengeById('challenge.inexistant')).toBeUndefined();
  });
});
