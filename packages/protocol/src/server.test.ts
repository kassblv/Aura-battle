import { describe, expect, it } from 'vitest';
import {
  SERVER_MESSAGES,
  SERVER_MESSAGE_NAMES,
  parseServerMessage,
  serializeServerMessage,
  type ServerMessageName,
} from './server.js';

/**
 * Ce que le SERVEUR accepte d'emettre : le schema strict, celui de
 * `serializeServerMessage`. C'est la que vit la regle d'or n° 4 — le client,
 * lui, ignore les cles inconnues (compatibilite ascendante).
 */
const emitted = (name: ServerMessageName, payload: unknown) =>
  SERVER_MESSAGES[name].safeParse(payload);

const roundResult = {
  matchId: 'm_01',
  round: 1,
  sides: {
    a: {
      move: { style: 'provoc', tier: 2 },
      amp: 1,
      ult: false,
      cosmetic: { animationId: 'anim.provoc.t2.mewing', effectId: 'fx.sparks' },
      recharge: { points: 9, bestCombo: 5, boostPct: 9, ultGain: 22.5, energyGain: 1 },
      timing: { quality: 'good', error: 0.05 },
      repeat: false,
      counter: true,
      countered: false,
      counterBlocked: false,
      base: 43,
      final: 58,
      energyAfter: 11,
      ultAfter: 57.5,
    },
    b: {
      move: { style: 'calme', tier: 2 },
      amp: 0,
      ult: false,
      cosmetic: { animationId: 'anim.calme.t2.lookaway', effectId: 'fx.glow' },
      recharge: { points: 4, bestCombo: 2, boostPct: 4, ultGain: 10, energyGain: 0 },
      timing: { quality: 'miss', error: 0.31 },
      repeat: false,
      counter: false,
      countered: true,
      counterBlocked: false,
      base: 19,
      final: 16,
      energyAfter: 12,
      ultAfter: 35,
    },
  },
  winner: 'a',
  roundsWon: { a: 1, b: 0 },
  timeline: { revealFirst: 'b' },
};

describe('registre des messages serveur', () => {
  it('couvre tous les evenements du protocole', () => {
    expect([...SERVER_MESSAGE_NAMES].sort()).toEqual(
      [
        'choice:start',
        'error',
        'intent:shown',
        'invite:created',
        'match:end',
        'match:found',
        'match:state',
        'opponent:locked',
        'pong',
        'queue:status',
        'recharge:start',
        'round:intro',
        'round:result',
      ].sort(),
    );
  });

  it('associe un schema a chaque nom', () => {
    for (const name of SERVER_MESSAGE_NAMES) {
      expect(SERVER_MESSAGES[name]).toBeDefined();
    }
  });
});

describe('aucune fuite avant la revelation (regle d or n°4)', () => {
  it('ne laisse passer que le strict necessaire dans opponent:locked', () => {
    expect(emitted('opponent:locked', { matchId: 'm_01', round: 1 }).success).toBe(true);
  });

  it('refuse d emettre un opponent:locked qui contiendrait le choix adverse', () => {
    const fuite = { matchId: 'm_01', round: 1, move: { style: 'calme', tier: 3 } };
    expect(emitted('opponent:locked', fuite).success).toBe(false);
  });

  it('refuse un choice:start qui contiendrait l energie adverse', () => {
    const valide = {
      matchId: 'm_01',
      round: 1,
      endsAt: 1_700_000_023_400,
      meter: { period: 1_720, zone: 0.22, perfect: 0.08, center: 0.41 },
      energy: 14,
      ult: 32,
    };
    expect(emitted('choice:start', valide).success).toBe(true);
    expect(emitted('choice:start', { ...valide, opponentEnergy: 12 }).success).toBe(
      false,
    );
  });

  it('porte la case brillante du destinataire dans choice:start (2.1.0)', () => {
    const base = {
      matchId: 'm_01',
      round: 1,
      endsAt: 1_700_000_023_400,
      meter: { period: 1_720, zone: 0.22, perfect: 0.08, center: 0.41 },
      energy: 14,
      ult: 32,
    };
    expect(
      emitted('choice:start', { ...base, shiny: { style: 'prouesse', tier: 3 } })
        .success,
    ).toBe(true);
    // Facultative : un serveur 2.0 ne l'envoie pas, et le message reste valide.
    expect(emitted('choice:start', base).success).toBe(true);
    expect(
      emitted('choice:start', { ...base, shiny: { style: 'danse', tier: 3 } }).success,
    ).toBe(false);
    expect(
      emitted('choice:start', { ...base, shiny: { style: 'hype', tier: 7 } }).success,
    ).toBe(false);
  });

  it('dit dans round:result qui a joue sa case brillante (2.1.0)', () => {
    const withShiny = {
      ...roundResult,
      sides: {
        a: { ...roundResult.sides.a, shiny: true },
        b: { ...roundResult.sides.b, shiny: false },
      },
    };
    expect(emitted('round:result', withShiny).success).toBe(true);
    expect(
      emitted('round:result', {
        ...roundResult,
        sides: { ...roundResult.sides, a: { ...roundResult.sides.a, shiny: 'oui' } },
      }).success,
    ).toBe(false);
  });

  it('refuse un round:intro qui contiendrait la jauge adverse', () => {
    const valide = {
      matchId: 'm_01',
      round: 1,
      endsAt: 1_700_000_002_000,
      roundsWon: { a: 0, b: 0 },
      energy: 14,
      ult: 0,
    };
    expect(emitted('round:intro', valide).success).toBe(true);
    expect(emitted('round:intro', { ...valide, opponentUlt: 40 }).success).toBe(false);
  });

  /**
   * Le nom de l'adversaire survit a une reprise.
   *
   * Il n'etait annonce que dans `match:found`. Une application mobile tuee en
   * arriere-plan — le cas le plus frequent de tous — revient par
   * `match:rejoin`, et le joueur finissait sa partie contre « Adversaire ».
   *
   * Ce n'est pas une fuite : il l'avait deja recu a l'ouverture. Le champ est
   * optionnel parce qu'un annuaire injoignable ne doit pas empecher une
   * reprise.
   */
  /*
    2.4.1 : la variante de regles survit a une reprise. Sans elle, une
    application tuee puis rouverte affichait les couts normaux pendant que le
    serveur comptait avec la variante.
  */
  it('accepte la variante de regles dans un match:state, et refuse une variante mal formee', () => {
    const base = {
      matchId: 'm_01',
      seat: 'a',
      phase: 'choice',
      round: 2,
      endsAt: 1_700_000_050_000,
      roundsWon: { a: 1, b: 0 },
      energy: 11,
      ult: 57.5,
      opponentLocked: true,
      ghost: false,
      history: [],
    };
    expect(emitted('match:state', { ...base, rulesVariant: 'ultime' }).success).toBe(
      true,
    );
    expect(emitted('match:state', { ...base, rulesVariant: 'Pas bon' }).success).toBe(
      false,
    );
  });

  it('accepte un match:state qui rappelle le nom de l adversaire', () => {
    const base = {
      matchId: 'm_01',
      seat: 'a',
      phase: 'choice',
      round: 2,
      endsAt: 1_700_000_050_000,
      roundsWon: { a: 1, b: 0 },
      energy: 11,
      ult: 57.5,
      opponentLocked: true,
      ghost: false,
      history: [],
    };
    expect(emitted('match:state', base).success).toBe(true);
    expect(
      emitted('match:state', {
        ...base,
        opponent: { displayName: 'Nova', league: 'bronze', cosmetics: {} },
      }).success,
    ).toBe(true);
    // Et rien de plus que ce que `match:found` annoncait deja.
    expect(
      emitted('match:state', {
        ...base,
        opponent: { displayName: 'Nova', league: 'bronze', cosmetics: {}, mmr: 1200 },
      }).success,
    ).toBe(false);
  });

  // 2.1.x : la reprise rend au joueur SA case brillante, perdue sinon.
  it('accepte un match:state qui rappelle la case brillante du destinataire', () => {
    const base = {
      matchId: 'm_01',
      seat: 'a',
      phase: 'choice',
      round: 2,
      endsAt: 1_700_000_050_000,
      roundsWon: { a: 1, b: 0 },
      energy: 11,
      ult: 57.5,
      opponentLocked: false,
      ghost: false,
      history: [],
    };
    expect(
      emitted('match:state', { ...base, shiny: { style: 'hype', tier: 3 } }).success,
    ).toBe(true);
  });

  it('refuse un match:state qui contiendrait le choix verrouille de l adversaire', () => {
    const valide = {
      matchId: 'm_01',
      seat: 'a',
      phase: 'choice',
      round: 2,
      endsAt: 1_700_000_050_000,
      roundsWon: { a: 1, b: 0 },
      energy: 11,
      ult: 57.5,
      opponentLocked: true,
      ghost: false,
      history: [],
    };
    expect(emitted('match:state', valide).success).toBe(true);
    expect(
      emitted('match:state', {
        ...valide,
        opponentChoice: { style: 'hype', tier: 4 },
      }).success,
    ).toBe(false);
  });
});

describe('round:result', () => {
  it('accepte le resultat complet des deux cotes', () => {
    expect(parseServerMessage('round:result', roundResult).success).toBe(true);
  });

  it('refuse un resultat auquel il manque un siege', () => {
    const { a: _omis, ...unSeul } = roundResult.sides;
    expect(parseServerMessage('round:result', { ...roundResult, sides: unSeul }).success).toBe(
      false,
    );
  });

  it('accepte une manche nulle', () => {
    expect(parseServerMessage('round:result', { ...roundResult, winner: null }).success).toBe(true);
  });

  it('refuse une qualite de timing inconnue', () => {
    const casse = {
      ...roundResult,
      sides: {
        ...roundResult.sides,
        a: { ...roundResult.sides.a, timing: { quality: 'excellent', error: 0.05 } },
      },
    };
    expect(parseServerMessage('round:result', casse).success).toBe(false);
  });
});

describe('recharge:start', () => {
  it('accepte une sequence d orbes', () => {
    expect(
      parseServerMessage('recharge:start', {
        matchId: 'm_01',
        round: 1,
        startsAt: 1_700_000_002_000,
        endsAt: 1_700_000_008_000,
        orbs: [
          { index: 0, x: 0.3, y: 0.7, kind: 'normal', points: 1, lifetimeMs: 1_600 },
          { index: 1, x: 0.8, y: 0.2, kind: 'golden', points: 3, lifetimeMs: 950 },
        ],
      }).success,
    ).toBe(true);
  });

  it('refuse une position hors du carre unite', () => {
    expect(
      parseServerMessage('recharge:start', {
        matchId: 'm_01',
        round: 1,
        startsAt: 1,
        endsAt: 2,
        orbs: [{ index: 0, x: 1.4, y: 0.5, kind: 'normal', points: 1, lifetimeMs: 1_600 }],
      }).success,
    ).toBe(false);
  });
});

/*
  2.4.0 : la variante de regles de la semaine (partie rapide). Un identifiant
  court et borne ; absent, les regles normales.
*/
describe('match:found — variante de regles', () => {
  const found = {
    matchId: 'm_01',
    seat: 'a',
    opponent: { displayName: 'Nova', league: 'bronze', cosmetics: {} },
    protocolVersion: '2.4.0',
    rulesVersion: '1.0.0',
    contentVersion: '1',
    ghost: false,
  };

  it('accepte une variante annoncee, et son absence', () => {
    expect(parseServerMessage('match:found', { ...found, rulesVariant: 'brillance' }).success).toBe(
      true,
    );
    expect(parseServerMessage('match:found', found).success).toBe(true);
  });

  it('refuse une variante demesuree ou mal formee', () => {
    expect(
      parseServerMessage('match:found', { ...found, rulesVariant: 'x'.repeat(40) }).success,
    ).toBe(false);
    expect(
      parseServerMessage('match:found', { ...found, rulesVariant: 'Pas un id!' }).success,
    ).toBe(false);
  });
});

describe('match:found et match:end', () => {
  it('accepte une rencontre annoncee', () => {
    expect(
      parseServerMessage('match:found', {
        matchId: 'm_01',
        seat: 'a',
        opponent: { displayName: 'Invite 4821', league: 'bronze', cosmetics: {} },
        protocolVersion: '1.0.0',
        rulesVersion: '0.0.0',
        contentVersion: '0.0.0',
        ghost: false,
      }).success,
    ).toBe(true);
  });

  it('accepte les quatre raisons de fin de match', () => {
    for (const reason of ['rounds', 'tiebreak', 'forfeit', 'disconnect']) {
      expect(
        parseServerMessage('match:end', {
          matchId: 'm_01',
          winner: 'a',
          reason,
          rating: { before: 1_000, after: 1_020, leagueBefore: 'bronze', leagueAfter: 'bronze' },
          rewards: { softCurrency: 40, xp: 120, xpTotal: 3_400 },
        }).success,
      ).toBe(true);
    }
  });

  it('refuse une raison de fin inconnue', () => {
    expect(
      parseServerMessage('match:end', {
        matchId: 'm_01',
        winner: null,
        reason: 'crash',
        rating: { before: 1_000, after: 1_000, leagueBefore: 'bronze', leagueAfter: 'bronze' },
        rewards: { softCurrency: 0, xp: 0 },
      }).success,
    ).toBe(false);
  });
});

describe('error', () => {
  it('accepte un code du protocole', () => {
    expect(
      parseServerMessage('error', {
        code: 'NOT_ENOUGH_ENERGY',
        message: 'Choix trop cher',
        retryable: false,
      }).success,
    ).toBe(true);
  });

  it('refuse un code hors de la liste', () => {
    expect(
      parseServerMessage('error', { code: 'OOPS', message: 'x', retryable: false }).success,
    ).toBe(false);
  });
});

/*
  Compatibilite ascendante : un champ AJOUTE par un serveur plus recent ne doit
  pas faire perdre le match a un client plus ancien. Le client analyse donc en
  ignorant les cles inconnues — a toutes les profondeurs — sans rien lacher des
  types ni des bornes. Le serveur, lui, reste strict a l'emission.
*/
describe('parseServerMessage — champs d un serveur plus recent', () => {
  const found = {
    matchId: 'm_01',
    seat: 'a',
    opponent: { displayName: 'Nova', league: 'bronze', cosmetics: {} },
    protocolVersion: '2.4.1',
    rulesVersion: '1.0.0',
    contentVersion: '1',
    ghost: false,
  };

  it('ignore un champ inconnu a la racine et le retire', () => {
    const parsed = parseServerMessage('match:found', { ...found, futur: { a: 1 } });
    expect(parsed.success).toBe(true);
    expect(parsed.success && 'futur' in parsed.data.data).toBe(false);
  });

  it('ignore un champ inconnu dans un objet imbrique', () => {
    const futur = {
      ...roundResult,
      sides: { ...roundResult.sides, a: { ...roundResult.sides.a, bonus: 3 } },
    };
    expect(parseServerMessage('round:result', futur).success).toBe(true);
  });

  it('garde les bornes des tableaux', () => {
    const orb = { index: 0, x: 0.3, y: 0.7, kind: 'normal', points: 1, lifetimeMs: 1_600 };
    const trop = {
      matchId: 'm_01',
      round: 1,
      startsAt: 1,
      endsAt: 2,
      orbs: Array.from({ length: 500 }, (_, index) => ({ ...orb, index })),
    };
    expect(parseServerMessage('recharge:start', trop).success).toBe(false);
  });

  it('garde les valeurs par defaut', () => {
    const state = parseServerMessage('match:state', {
      matchId: 'm_01',
      seat: 'a',
      phase: 'choice',
      round: 1,
      endsAt: 1_700_000_000_000,
      roundsWon: { a: 0, b: 0 },
      energy: 10,
      ult: 0,
      opponentLocked: false,
      history: [],
    });
    expect(state.success && state.data.name === 'match:state' && state.data.data.ghost).toBe(
      false,
    );
  });
});

describe('serializeServerMessage', () => {
  it('refuse d emettre un champ que le protocole ne connait pas', () => {
    const result = serializeServerMessage('opponent:locked', {
      matchId: 'm_01',
      round: 1,
      // @ts-expect-error — champ hors protocole
      futur: true,
    });
    expect(result.success).toBe(false);
  });

  it('valide le message avant de l emettre', () => {
    const result = serializeServerMessage('opponent:locked', { matchId: 'm_01', round: 1 });
    expect(result.success).toBe(true);
  });

  it('empeche le serveur d emettre un message qui fuite', () => {
    // Le serveur se refuse a lui-meme : la validation est sortante autant qu entrante.
    const result = serializeServerMessage('opponent:locked', {
      matchId: 'm_01',
      round: 1,
      // @ts-expect-error — le type interdit deja ce champ ; on verifie que
      // l execution le refuse aussi, au cas ou la valeur vienne d un `any`.
      move: { style: 'calme', tier: 3 },
    });
    expect(result.success).toBe(false);
  });
});

/*
  2.6.0 : la bulle d'intention en test A/B. Le match l'annonce (absente : pas
  de bulle), la reprise rappelle les annonces de la manche, et le resultat dit
  si la bulle a ete tenue.
*/
describe('bulle d intention (2.6.0)', () => {
  const found = {
    matchId: 'm_01',
    seat: 'a',
    opponent: { displayName: 'Nova', league: 'bronze', cosmetics: {} },
    protocolVersion: '2.6.0',
    rulesVersion: '1.0.0',
    contentVersion: '1',
    ghost: false,
  };
  const state = {
    matchId: 'm_01',
    seat: 'a',
    phase: 'choice',
    round: 1,
    endsAt: 1_700_000_000_000,
    roundsWon: { a: 0, b: 0 },
    energy: 10,
    ult: 0,
    opponentLocked: false,
    history: [],
  };

  it('match:found annonce la bulle', () => {
    expect(emitted('match:found', { ...found, intentBubble: true }).success).toBe(true);
    expect(emitted('match:found', { ...found, intentBubble: false }).success).toBe(false);
  });

  it('match:state rappelle la bulle et les annonces de la manche', () => {
    expect(
      emitted('match:state', { ...state, intentBubble: true, intents: { b: 'hype' } }).success,
    ).toBe(true);
    expect(
      emitted('match:state', { ...state, intentBubble: true, intents: { b: 'pas-une-famille' } })
        .success,
    ).toBe(false);
  });

  it('round:result dit si la bulle a ete tenue', () => {
    const kept = {
      ...roundResult,
      sides: { ...roundResult.sides, a: { ...roundResult.sides.a, intentKept: true } },
    };
    expect(emitted('round:result', kept).success).toBe(true);
  });
});
