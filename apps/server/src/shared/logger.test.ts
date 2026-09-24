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
  it('masque les identifiants et les preuves d authentification', () => {
    const { lines, stream } = capture();
    createLogger(config, stream).info(
      {
        email: 'kassim@gmail.com',
        body: {
          password: 'mot-de-passe-1',
          currentPassword: 'mot-de-passe-2',
          newPassword: 'mot-de-passe-3',
          recoveryCode: 'AURA-SECRET-1',
          secretHash: '$argon2id$secret',
          deviceSecret: 'secret-appareil',
        },
      },
      'requete',
    );
    const sortie = lines.join('');
    for (const secret of [
      'kassim@gmail.com',
      'mot-de-passe-1',
      'mot-de-passe-2',
      'mot-de-passe-3',
      'AURA-SECRET-1',
      '$argon2id$secret',
      'secret-appareil',
    ]) {
      expect(sortie).not.toContain(secret);
    }
  });

  /* Les jokers de pino ne descendent que d'un niveau : `req.body.x` est nomme. */
  it('masque les secrets du corps d une requete journalisee', () => {
    const { lines, stream } = capture();
    createLogger(config, stream).info(
      {
        req: {
          body: {
            password: 'corps-1',
            currentPassword: 'corps-2',
            newPassword: 'corps-3',
            recoveryCode: 'corps-4',
            code: 'corps-5',
            email: 'corps@exemple.fr',
            deviceSecret: 'corps-6',
          },
        },
      },
      'requete',
    );
    const sortie = lines.join('');
    for (const secret of [
      'corps-1',
      'corps-2',
      'corps-3',
      'corps-4',
      'corps-5',
      'corps@exemple.fr',
      'corps-6',
    ]) {
      expect(sortie).not.toContain(secret);
    }
  });

  /* `err.code` est le premier indice d'un incident : il doit rester lisible. */
  it('laisse lisible le code d une erreur', () => {
    const { lines, stream } = capture();
    createLogger(config, stream).info({ err: { code: 'P2002' } }, 'conflit');
    expect(lines.join('')).toContain('P2002');
  });

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

  /**
   * Le journal borne ce qu'une erreur de bibliotheque raconte.
   *
   * Une erreur Prisma recopie les arguments refuses dans son `message`, et sa
   * pile en reprend la premiere ligne. `describeCause` existe pour ca, mais
   * c'est une CONVENTION : partout ou quelqu'un ecrira `logger.error(cause)`
   * avec une erreur de bibliotheque, le message et la pile repartiraient
   * entiers, et aucune relecture ne le verrait passer.
   *
   * Le point de passage obligatoire n'est pas `describeCause`, c'est cet
   * adaptateur. Borner ici ferme la classe entiere plutot que site par site.
   */
  it('borne le journal, quelle que soit la taille de l erreur', () => {
    const journaliser = (repetitions: number): string => {
      const { lines, stream } = capture();
      const bavarde = new Error(`echec\n${'secret-argument '.repeat(repetitions)}`);
      new PinoLoggerService(createLogger(config, stream)).error(bavarde, undefined, 'Test');
      return lines.join('');
    };

    const petite = journaliser(200);
    const enorme = journaliser(20_000);

    // Le debut reste : un journal doit rester diagnosticable.
    expect(petite).toContain('echec');
    // L invariant qui compte : la taille du journal ne suit PAS celle de
    // l erreur. Une erreur cent fois plus longue n ecrit pas cent fois plus.
    expect(petite.length).toBeLessThan(4_000);
    expect(enorme.length).toBeLessThan(4_000);
    expect(Math.abs(enorme.length - petite.length)).toBeLessThan(200);
  });

  it('garde une erreur courte intacte', () => {
    const { lines, stream } = capture();
    new PinoLoggerService(createLogger(config, stream)).error(
      new Error('connexion refusee'),
      undefined,
      'Test',
    );
    expect(lines.join('')).toContain('connexion refusee');
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
