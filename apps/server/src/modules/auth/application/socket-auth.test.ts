import { PROTOCOL_VERSION } from '@aura/protocol';
import { describe, expect, it } from 'vitest';
import { SocketAuthenticator, type AccessTokenVerifier } from './socket-auth.js';

/** Verificateur de jeton en memoire : pas de cryptographie dans ces tests. */
const verifier = (valid: Record<string, string>): AccessTokenVerifier => ({
  verify: (token: string) =>
    valid[token] === undefined
      ? Promise.reject(new Error('jeton invalide'))
      : Promise.resolve({ sub: valid[token] }),
});

const authenticator = new SocketAuthenticator(verifier({ 'jwt.bon': 'p_1' }));

const handshake = (overrides: Record<string, unknown> = {}): unknown => ({
  token: 'jwt.bon',
  protocolVersion: PROTOCOL_VERSION,
  ...overrides,
});

describe('SocketAuthenticator — le handshake est la premiere barriere', () => {
  it('accepte un handshake valide et rend le joueur', async () => {
    const result = await authenticator.authenticate(handshake());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.playerId).toBe('p_1');
  });

  it('refuse un jeton inconnu', async () => {
    const result = await authenticator.authenticate(handshake({ token: 'jwt.faux' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('UNAUTHORIZED');
  });

  it('refuse une charge qui ne suit pas le schema', async () => {
    const result = await authenticator.authenticate({ token: 'jwt.bon' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('INVALID_PAYLOAD');
  });

  it('refuse un handshake absent', async () => {
    const result = await authenticator.authenticate(undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('INVALID_PAYLOAD');
  });

  it('refuse un client d une version majeure differente', async () => {
    const result = await authenticator.authenticate(handshake({ protocolVersion: '2.0.0' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('CLIENT_OUTDATED');
  });

  it('accepte une version mineure differente, qui reste compatible', async () => {
    const result = await authenticator.authenticate(handshake({ protocolVersion: '1.9.3' }));
    expect(result.ok).toBe(true);
  });

  it('verifie la version avant le jeton, pour dire au client de se mettre a jour', async () => {
    // Un client perime avec un jeton perime doit voir « mets-toi a jour »,
    // pas « reconnecte-toi » : sinon il boucle sur une reconnexion inutile.
    const result = await authenticator.authenticate({
      token: 'jwt.faux',
      protocolVersion: '2.0.0',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('CLIENT_OUTDATED');
  });

  it('refuse un jeton sans sujet', async () => {
    const sansSujet = new SocketAuthenticator({
      verify: () => Promise.resolve({ sub: '' }),
    });
    const result = await sansSujet.authenticate(handshake());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('UNAUTHORIZED');
  });

  it('rend le meme message quelle que soit la cause de l echec', async () => {
    // Un attaquant ne doit pas pouvoir distinguer « jeton expire »,
    // « signature invalide » et « jeton inexistant » depuis nos reponses : ces
    // trois cas lui apprendraient trois choses differentes. Le detail reste
    // dans le journal du serveur.
    const inconnu = await authenticator.authenticate(handshake({ token: 'jwt.faux' }));
    const vide = await authenticator.authenticate(handshake({ token: 'autre.faux' }));
    const sansSujet = await new SocketAuthenticator({
      verify: () => Promise.resolve({ sub: '' }),
    }).authenticate(handshake());

    const messages = [inconnu, vide, sansSujet].map((r) => (r.ok ? 'ok' : r.message));
    expect(new Set(messages).size).toBe(1);

    const codes = [inconnu, vide, sansSujet].map((r) => (r.ok ? 'ok' : r.code));
    expect(new Set(codes)).toEqual(new Set(['UNAUTHORIZED']));
  });
});
