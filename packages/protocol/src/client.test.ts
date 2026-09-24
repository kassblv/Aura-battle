import { BALANCE } from '@aura/rules';
import { describe, expect, it } from 'vitest';
import {
  CLIENT_MESSAGES,
  CLIENT_MESSAGE_NAMES,
  MAX_TAPS_PER_MESSAGE,
  parseClientMessage,
  serializeClientMessage,
} from './client.js';

/**
 * Les charges utiles viennent de docs/03-pvp-protocol.md. Seule la valeur des
 * sieges change : `a` / `b` au lieu de `left` / `right` (voir ADR 0006).
 */

const validLock = {
  matchId: 'm_01',
  round: 1,
  seq: 9,
  move: { style: 'provoc', tier: 2 },
  amp: 1,
  ult: false,
  timing: { chargeAt: 3_100, tapAt: 4_012 },
};

const validTaps = {
  matchId: 'm_01',
  round: 1,
  seq: 1,
  taps: [
    { orbIndex: 0, t: 412 },
    { orbIndex: 2, t: 780 },
  ],
};

describe('registre des messages client', () => {
  it('couvre tous les evenements du protocole', () => {
    expect([...CLIENT_MESSAGE_NAMES].sort()).toEqual(
      [
        'choice:lock',
        'intent:show',
        'invite:create',
        'invite:join',
        'match:forfeit',
        'match:ready',
        'match:rejoin',
        'ping',
        'queue:join',
        'queue:leave',
        'recharge:taps',
      ].sort(),
    );
  });

  it('associe un schema a chaque nom', () => {
    for (const name of CLIENT_MESSAGE_NAMES) {
      expect(CLIENT_MESSAGES[name]).toBeDefined();
    }
  });

  it('rejette un nom d evenement inconnu', () => {
    // Le nom vient du reseau : il faut le verifier a l execution, pas seulement
    // a la compilation.
    const result = parseClientMessage('inconnu:truc', {});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('inconnu:truc');
    }
  });
});

describe('recharge:taps', () => {
  it('accepte l exemple du protocole', () => {
    expect(parseClientMessage('recharge:taps', validTaps).success).toBe(true);
  });

  it('accepte une liste de taps vide', () => {
    expect(parseClientMessage('recharge:taps', { ...validTaps, taps: [] }).success).toBe(true);
  });

  it('refuse un instant hors de la fenetre de recharge', () => {
    expect(
      parseClientMessage('recharge:taps', { ...validTaps, taps: [{ orbIndex: 0, t: 6_001 }] })
        .success,
    ).toBe(false);
    expect(
      parseClientMessage('recharge:taps', { ...validTaps, taps: [{ orbIndex: 0, t: -1 }] }).success,
    ).toBe(false);
  });

  it('refuse un indice d orbe negatif ou fractionnaire', () => {
    expect(
      parseClientMessage('recharge:taps', { ...validTaps, taps: [{ orbIndex: -1, t: 100 }] })
        .success,
    ).toBe(false);
    expect(
      parseClientMessage('recharge:taps', { ...validTaps, taps: [{ orbIndex: 1.5, t: 100 }] })
        .success,
    ).toBe(false);
  });

  it('borne le tableau au maximum physiquement atteignable', () => {
    const tooMany = Array.from({ length: MAX_TAPS_PER_MESSAGE + 1 }, (_unused, i) => ({
      orbIndex: i,
      t: 10,
    }));
    expect(parseClientMessage('recharge:taps', { ...validTaps, taps: tooMany }).success).toBe(
      false,
    );
  });

  it('refuse une manche hors du match', () => {
    expect(parseClientMessage('recharge:taps', { ...validTaps, round: 0 }).success).toBe(false);
    expect(parseClientMessage('recharge:taps', { ...validTaps, round: 4 }).success).toBe(false);
  });

  it('refuse un seq negatif', () => {
    expect(parseClientMessage('recharge:taps', { ...validTaps, seq: -1 }).success).toBe(false);
  });

  it('refuse un champ inconnu, qui trahit un client desynchronise', () => {
    expect(parseClientMessage('recharge:taps', { ...validTaps, points: 999 }).success).toBe(false);
  });
});

describe('choice:lock', () => {
  it('accepte l exemple du protocole', () => {
    expect(parseClientMessage('choice:lock', validLock).success).toBe(true);
  });

  it('accepte une charge sans tap de timing', () => {
    expect(
      parseClientMessage('choice:lock', { ...validLock, timing: { chargeAt: 100, tapAt: null } })
        .success,
    ).toBe(true);
  });

  /*
    L'apparence ne vient plus du client, et le schema le refuse desormais.

    Le champ existait, facultatif, et le serveur relayait son contenu tel quel
    a l'adversaire a la revelation — sans controle de possession. N'importe
    qui pouvait porter le skin a 850 pieces en fabriquant un message. Regle
    d'or n°1 : le client n'envoie que des intentions, et une apparence n'en
    est pas une. Le serveur la resout seul, a partir du palier joue et de ce
    que la base dit du joueur.
  */
  it('refuse un cosmetique : l apparence ne vient plus du client', () => {
    expect(
      parseClientMessage('choice:lock', {
        ...validLock,
        cosmetic: { animationId: 'anim.provoc.t2.mewing', effectId: 'fx.sparks' },
      }).success,
    ).toBe(false);
  });

  it('refuse un style ou un palier inconnu', () => {
    expect(
      parseClientMessage('choice:lock', { ...validLock, move: { style: 'chill', tier: 2 } })
        .success,
    ).toBe(false);
    expect(
      parseClientMessage('choice:lock', { ...validLock, move: { style: 'provoc', tier: 5 } })
        .success,
    ).toBe(false);
  });

  it('refuse un amplificateur hors bornes', () => {
    expect(parseClientMessage('choice:lock', { ...validLock, amp: 5 }).success).toBe(false);
    expect(parseClientMessage('choice:lock', { ...validLock, amp: -1 }).success).toBe(false);
  });

  it('refuse une charge negative', () => {
    expect(
      parseClientMessage('choice:lock', { ...validLock, timing: { chargeAt: -1, tapAt: 500 } })
        .success,
    ).toBe(false);
  });

  it('refuse un tap trop rapide apres le lancement de la charge', () => {
    // Moins de 120 ms : humainement impossible, donc rejete (docs/03).
    expect(
      parseClientMessage('choice:lock', { ...validLock, timing: { chargeAt: 1_000, tapAt: 1_100 } })
        .success,
    ).toBe(false);
  });

  it('refuse un tap au-dela des six secondes de charge', () => {
    expect(
      parseClientMessage('choice:lock', {
        ...validLock,
        timing: { chargeAt: 1_000, tapAt: 1_000 + 6_001 },
      }).success,
    ).toBe(false);
  });

  it('refuse un tap anterieur a la charge', () => {
    expect(
      parseClientMessage('choice:lock', { ...validLock, timing: { chargeAt: 2_000, tapAt: 1_000 } })
        .success,
    ).toBe(false);
  });

  it('n accepte aucun score calcule par le client', () => {
    expect(parseClientMessage('choice:lock', { ...validLock, score: 120 }).success).toBe(false);
  });
});

describe('messages de file et d invitation', () => {
  it('accepte les deux modes de file', () => {
    expect(parseClientMessage('queue:join', { mode: 'ranked' }).success).toBe(true);
    expect(parseClientMessage('queue:join', { mode: 'casual' }).success).toBe(true);
  });

  it('refuse un mode inconnu', () => {
    expect(parseClientMessage('queue:join', { mode: 'tournament' }).success).toBe(false);
  });

  it('accepte un code d invitation et refuse un code vide', () => {
    expect(parseClientMessage('invite:join', { code: 'AB12CD' }).success).toBe(true);
    expect(parseClientMessage('invite:join', { code: '' }).success).toBe(false);
  });

  it('accepte les messages sans charge utile', () => {
    expect(parseClientMessage('queue:leave', {}).success).toBe(true);
    expect(parseClientMessage('invite:create', {}).success).toBe(true);
  });
});

describe('ping', () => {
  it('accepte un instant client', () => {
    expect(parseClientMessage('ping', { t: 12_345.67 }).success).toBe(true);
  });

  it('refuse un instant qui n est pas un nombre', () => {
    expect(parseClientMessage('ping', { t: '12345' }).success).toBe(false);
  });
});

describe('serializeClientMessage', () => {
  it('laisse passer un message bien forme', () => {
    expect(serializeClientMessage('ping', { t: 1234 }).success).toBe(true);
  });

  /**
   * Le jumeau de `serializeServerMessage` : un message malforme serait refuse
   * par le serveur sans que le client l'apprenne autrement qu'en attendant une
   * reponse qui ne vient jamais.
   */
  it('refuse un message que le serveur rejetterait', () => {
    expect(serializeClientMessage('ping', { t: 'maintenant' } as never).success).toBe(false);
  });

  it('rend la valeur validee, pas la valeur donnee', () => {
    const result = serializeClientMessage('queue:join', { mode: 'ranked' });
    expect(result.success && result.data).toEqual({ mode: 'ranked' });
  });
});

describe('tap dans le vide', () => {
  const taps = (list: unknown) =>
    parseClientMessage('recharge:taps', {
      matchId: 'm_1',
      round: 1,
      seq: 0,
      taps: list,
    }).success;

  /**
   * `docs/01` : taper dans le vide remet le combo a zero. La regle n'existe
   * qu'a condition que le geste puisse etre declare — sinon le serveur ne le
   * voit jamais et marteler l'ecran devient gratuit.
   */
  it('accepte un tap sans orbe', () => {
    expect(taps([{ orbIndex: null, t: 120 }])).toBe(true);
  });

  it('accepte un tap sur une orbe', () => {
    expect(taps([{ orbIndex: 3, t: 120 }])).toBe(true);
  });

  it('refuse un indice d orbe negatif', () => {
    expect(taps([{ orbIndex: -1, t: 120 }])).toBe(false);
  });
});

describe('familles', () => {
  it('intent:show accepte les cinq familles du moteur', () => {
    for (const style of BALANCE.styles) {
      const intent = { matchId: 'm_1', round: 1, seq: 2, style };
      expect(CLIENT_MESSAGES['intent:show'].safeParse(intent).success, style).toBe(true);
    }
  });

  it('intent:show refuse une famille inconnue', () => {
    const intent = { matchId: 'm_1', round: 1, seq: 2, style: 'danse' };
    expect(CLIENT_MESSAGES['intent:show'].safeParse(intent).success).toBe(false);
  });
});
