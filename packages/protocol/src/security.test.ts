import { describe, expect, it } from 'vitest';
import { parseClientMessage } from './client.js';
import { parseHandshake } from './handshake.js';
import { parseServerMessage } from './server.js';

/**
 * Tests issus de la relecture de securite du jalon M2.
 * Chacun reproduit une exploitation concrete signalee par le relecteur.
 */

describe('intent:show — le bonus d Ultime ne doit pas etre gratuit', () => {
  const announce = (style: string): unknown => ({
    matchId: 'm_01',
    round: 1,
    seq: 3,
    style,
  });

  it('exige un seq, pour que le serveur puisse imposer une annonce unique', () => {
    expect(parseClientMessage('intent:show', announce('calme')).success).toBe(true);
    const { seq: _omis, ...sansSeq } = announce('calme') as Record<string, unknown>;
    expect(parseClientMessage('intent:show', sansSeq).success).toBe(false);
  });

  it('n accepte qu un seul style par message', () => {
    expect(
      parseClientMessage('intent:show', { ...(announce('calme') as object), styles: ['hype'] })
        .success,
    ).toBe(false);
  });
});

describe('identifiants — pas d injection de journal ni de collision de cle', () => {
  it('refuse un identifiant de match contenant un saut de ligne', () => {
    // Sans contrainte de jeu de caracteres, ceci fabrique de fausses lignes pino.
    const injection = 'm_01\n{"level":30,"msg":"faux"}';
    expect(parseClientMessage('match:rejoin', { matchId: injection }).success).toBe(false);
  });

  it('refuse un identifiant de match contenant un deux-points', () => {
    // Les cles Redis et les rooms Socket.IO se construisent par concatenation.
    expect(parseClientMessage('match:rejoin', { matchId: 'm:01:lock' }).success).toBe(false);
  });

  it('accepte un identifiant de match normal', () => {
    expect(parseClientMessage('match:rejoin', { matchId: 'm_01-abc' }).success).toBe(true);
  });

  it('impose un code d invitation lisible a voix haute', () => {
    expect(parseClientMessage('invite:join', { code: 'AB12CD' }).success).toBe(true);
    expect(parseClientMessage('invite:join', { code: 'ab 12' }).success).toBe(false);
  });

  it('impose un identifiant d emote pointe', () => {
    expect(
      parseClientMessage('emote:send', { matchId: 'm_01', emoteId: 'emote.rire' }).success,
    ).toBe(true);
    expect(
      parseClientMessage('emote:send', { matchId: 'm_01', emoteId: '../../etc/passwd' }).success,
    ).toBe(false);
  });
});

describe('cosmetiques — le registre sortant n a plus de conteneur ouvert', () => {
  const found = (cosmetics: unknown): unknown => ({
    matchId: 'm_01',
    seat: 'a',
    opponent: { displayName: 'Invite 4821', league: 'bronze', cosmetics },
    protocolVersion: '1.0.0',
    rulesVersion: '0.0.0',
    contentVersion: '1.0.0',
    ghost: false,
  });

  it('accepte les emplacements connus', () => {
    expect(
      parseServerMessage('match:found', found({ auraColor: 'color.gold', outfit: 'outfit.noir' }))
        .success,
    ).toBe(true);
  });

  it('refuse qu on y deverse le profil complet de l adversaire', () => {
    // Le scenario exact que le garde-fou doit attraper : un bug qui etale
    // `{ ...opponentProfile }` dans un champ ouvert.
    expect(
      parseServerMessage(
        'match:found',
        found({ auraColor: 'color.gold', mmr: '1240', energy: '14', ultimateGauge: '80' }),
      ).success,
    ).toBe(false);
  });
});

describe('taps — monotonie verifiable sans etat', () => {
  const taps = (list: { orbIndex: number; t: number }[]): unknown => ({
    matchId: 'm_01',
    round: 1,
    seq: 1,
    taps: list,
  });

  it('accepte des instants croissants', () => {
    expect(
      parseClientMessage(
        'recharge:taps',
        taps([
          { orbIndex: 0, t: 100 },
          { orbIndex: 1, t: 400 },
        ]),
      ).success,
    ).toBe(true);
  });

  it('refuse des instants qui reculent', () => {
    expect(
      parseClientMessage(
        'recharge:taps',
        taps([
          { orbIndex: 0, t: 400 },
          { orbIndex: 1, t: 100 },
        ]),
      ).success,
    ).toBe(false);
  });

  it('borne l indice d orbe a ce que la sequence peut contenir', () => {
    expect(parseClientMessage('recharge:taps', taps([{ orbIndex: 1e15, t: 100 }])).success).toBe(
      false,
    );
  });
});

describe('timing — la charge reste dans la phase de choix', () => {
  const lock = (timing: unknown): unknown => ({
    matchId: 'm_01',
    round: 1,
    seq: 9,
    move: { style: 'provoc', tier: 2 },
    amp: 1,
    ult: false,
    timing,
  });

  it('refuse une charge lancee bien au-dela de la phase', () => {
    expect(
      parseClientMessage('choice:lock', lock({ chargeAt: 1e12, tapAt: 1e12 + 500 })).success,
    ).toBe(false);
  });

  it('accepte une charge lancee dans la phase', () => {
    expect(parseClientMessage('choice:lock', lock({ chargeAt: 3_100, tapAt: 4_012 })).success).toBe(
      true,
    );
  });
});

describe('messages sortants — plus de chaine sans borne', () => {
  it('borne le message d erreur, qui ne doit jamais vehiculer d etat de match', () => {
    expect(
      parseServerMessage('error', {
        code: 'INVALID_PAYLOAD',
        message: 'x'.repeat(5_000),
        retryable: false,
      }).success,
    ).toBe(false);
  });

  it('impose le schema attendu au lien profond d invitation', () => {
    const invite = (deepLink: string): unknown => ({
      code: 'AB12CD',
      deepLink,
      expiresAt: 1_700_000_000_000,
    });
    expect(parseServerMessage('invite:created', invite('aurabattle://invite/AB12CD')).success).toBe(
      true,
    );
    expect(parseServerMessage('invite:created', invite('javascript:alert(1)')).success).toBe(false);
  });
});

describe('handshake — le seul point d entree qui porte le jeton', () => {
  it('accepte un handshake conforme', () => {
    expect(parseHandshake({ token: 'jwt.token.value', protocolVersion: '1.0.0' }).success).toBe(
      true,
    );
  });

  it('refuse un jeton vide ou demesure', () => {
    expect(parseHandshake({ token: '', protocolVersion: '1.0.0' }).success).toBe(false);
    expect(parseHandshake({ token: 'x'.repeat(9_000), protocolVersion: '1.0.0' }).success).toBe(
      false,
    );
  });

  it('refuse un champ supplementaire', () => {
    expect(
      parseHandshake({ token: 'jwt', protocolVersion: '1.0.0', playerId: 'p_1' }).success,
    ).toBe(false);
  });
});
