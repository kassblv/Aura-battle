import { describe, expect, it } from 'vitest';
import { parseClientMessage } from './client.js';
import { MAX_PARSE_ERROR_LENGTH } from './primitives.js';
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

  /**
   * Le client n'envoie plus aucun identifiant de contenu.
   *
   * C'etait la derniere surface ou il en fournissait un — celui que le serveur
   * irait chercher dans le catalogue, donc celui ou une traversee de chemin
   * qui passerait la validation irait lire ce qu'elle veut sur le disque. Le
   * schema le refusait deja ; il refuse maintenant le champ entier, ce qui est
   * plus fort : il n'y a plus de chaine a valider, donc plus rien a rater.
   *
   * Le meme controle vaut toujours cote SORTANT, ou `round:result` porte
   * encore un cosmetique — emis par le serveur, mais valide a l'emission.
   */
  it('n accepte plus aucun identifiant de contenu venu du client', () => {
    const choix = {
      matchId: 'm_01',
      round: 1,
      seq: 1,
      move: { style: 'hype', tier: 2 },
      amp: 1,
      ult: false,
      timing: { chargeAt: 0, tapAt: 400 },
    };
    expect(parseClientMessage('choice:lock', choix).success).toBe(true);
    for (const animationId of ['anim.hype.t2.floss', '../../etc/passwd']) {
      expect(
        parseClientMessage('choice:lock', {
          ...choix,
          cosmetic: { animationId, effectId: 'fx.glow' },
        }).success,
        animationId,
      ).toBe(false);
    }
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

/**
 * Le message d'erreur d'analyse est-il, lui aussi, une charge utile ?
 *
 * Relecture de securite du banc de charge. `unrecognized_keys` de zod recopie
 * **les noms de toutes les cles inattendues**. Un message par ailleurs valide,
 * accompagne de milliers de cles inconnues, fabrique donc une chaine d'erreur
 * proportionnelle a ce que le client a envoye — mesure a 58 918 caracteres
 * pour 2 000 cles, et rien n'empeche d'en envoyer bien plus.
 *
 * Cette chaine part ensuite dans trois journaux : le `debug` de la passerelle,
 * `reportInvalid` du notifier, et le notifier de fantome. En developpement la
 * donnee du client y atterrit ; en production le litteral gabarit la
 * concatene **avant** que pino ne teste le niveau, donc le serveur paie
 * l'allocation sans meme produire de ligne.
 *
 * La borne vit ici plutot que dans chaque appelant : trois journaux
 * aujourd'hui, un quatrieme demain, et il suffit d'en oublier un.
 */
describe('un message d erreur ne se laisse pas remplir par le client', () => {
  const avecCles = (combien: number): Record<string, unknown> => {
    const charge: Record<string, unknown> = { matchId: 'm_01' };
    for (let i = 0; i < combien; i += 1) charge[`cle_inattendue_numero_${i}`] = 1;
    return charge;
  };

  it('borne la chaine d erreur quoi que le client envoie', () => {
    const parsed = parseClientMessage('match:ready', avecCles(2_000));
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.length).toBeLessThanOrEqual(MAX_PARSE_ERROR_LENGTH);
  });

  /**
   * La borne ne doit pas dependre de la taille de l'envoi : deux charges
   * separees par un facteur dix doivent produire la meme longueur bornee,
   * sinon ce n'est pas une borne.
   */
  it('ne grandit pas avec la charge', () => {
    const petit = parseClientMessage('match:ready', avecCles(500));
    const gros = parseClientMessage('match:ready', avecCles(5_000));
    if (petit.success || gros.success) throw new Error('les deux devraient echouer');
    expect(gros.error.length).toBe(petit.error.length);
  });

  /** Borner ne doit pas rendre le message inutile : le chemin reste lisible. */
  it('garde le chemin du champ fautif', () => {
    const parsed = parseClientMessage('recharge:taps', { matchId: 'm_01', round: 1, taps: 'non' });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error).toContain('taps');
  });
});
