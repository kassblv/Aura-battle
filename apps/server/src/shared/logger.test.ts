import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';
import { createLogger, PinoLoggerService } from './logger.js';

const config = loadConfig({
  DATABASE_URL: 'postgresql://aura:aura@localhost:5432/aura',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'un-secret-assez-long',
  NODE_ENV: 'test',
});

/** Capture les lignes ecrites par le logger. */
function capture(): { lines: string[]; stream: Writable } {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  return { lines, stream };
}

describe('createLogger — les secrets ne partent jamais dans les journaux', () => {
  it('masque un jeton d acces', () => {
    const { lines, stream } = capture();
    createLogger(config, stream).info({ token: 'jwt.tres.secret' }, 'connexion');
    expect(lines.join('')).not.toContain('jwt.tres.secret');
    expect(lines.join('')).toContain('[masque]');
  });

  it('masque un jeton de rafraichissement et un identifiant d appareil', () => {
    const { lines, stream } = capture();
    createLogger(config, stream).info(
      { refreshToken: 'refresh.secret', deviceId: 'device-abcdef' },
      'authentification',
    );
    const sortie = lines.join('');
    expect(sortie).not.toContain('refresh.secret');
    expect(sortie).not.toContain('device-abcdef');
  });

  /**
   * Defense en profondeur : aucun site d'appel ne journalise ces valeurs
   * aujourd'hui, et rien ne garantit qu'aucun ne le fera. Le `deviceHash` est
   * ce qui distingue le telephone d'un joueur de tous les autres ; le `subject`
   * est ce meme hash, vu depuis la table des identites.
   */
  it('masque l empreinte d un appareil, sous ses deux noms', () => {
    const { lines, stream } = capture();
    createLogger(config, stream).info(
      { deviceHash: 'hash-abcdef', identity: { subject: 'sujet-123456' } },
      'ouverture de session',
    );
    const sortie = lines.join('');
    expect(sortie).not.toContain('hash-abcdef');
    expect(sortie).not.toContain('sujet-123456');
  });

  it('masque un en-tete Authorization', () => {
    const { lines, stream } = capture();
    createLogger(config, stream).info(
      { req: { headers: { authorization: 'Bearer abc.def' } } },
      'requete',
    );
    expect(lines.join('')).not.toContain('abc.def');
  });

  it('masque le choix et le timing d un joueur, qui ne doivent jamais transiter', () => {
    // Regle d'or n°4 : un journal est lu par plus de monde qu'une base de
    // donnees. Le choix secret d'un joueur n'a rien a y faire.
    const { lines, stream } = capture();
    createLogger(config, stream).info(
      { choice: { move: { style: 'provoc', tier: 4 } }, timing: { tapAt: 4012 } },
      'verrouillage',
    );
    const sortie = lines.join('');
    expect(sortie).not.toContain('provoc');
    expect(sortie).not.toContain('4012');
  });

  it('laisse passer ce qui n est pas sensible', () => {
    const { lines, stream } = capture();
    createLogger(config, stream).info({ matchId: 'm_01', round: 2 }, 'manche');
    const sortie = lines.join('');
    expect(sortie).toContain('m_01');
    expect(sortie).toContain('manche');
  });
});

describe('PinoLoggerService — une erreur ne doit jamais disparaitre', () => {
  it('conserve le message d une Error', () => {
    // JSON.stringify(new Error('x')) rend '{}' : message et stack ne sont pas
    // enumerables. Un adaptateur naif avale l'erreur en silence.
    const { lines, stream } = capture();
    new PinoLoggerService(createLogger(config, stream)).error(new Error('connexion refusee'));
    expect(lines.join('')).toContain('connexion refusee');
  });

  it('conserve la pile d appel', () => {
    const { lines, stream } = capture();
    new PinoLoggerService(createLogger(config, stream)).error(new Error('boum'));
    expect(lines.join('')).toContain('stack');
  });

  it('ecrit toujours une chaine telle quelle', () => {
    const { lines, stream } = capture();
    new PinoLoggerService(createLogger(config, stream)).log('serveur pret', 'Bootstrap');
    const sortie = lines.join('');
    expect(sortie).toContain('serveur pret');
    expect(sortie).toContain('Bootstrap');
  });

  it('ne laisse pas un objet quelconque devenir un objet vide', () => {
    const { lines, stream } = capture();
    new PinoLoggerService(createLogger(config, stream)).warn({ matchId: 'm_01', round: 2 });
    expect(lines.join('')).toContain('m_01');
  });
});
