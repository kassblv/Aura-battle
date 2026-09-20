import type { Socket } from 'socket.io';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../../shared/config.js';
import { createLogger, PinoLoggerService } from '../../../shared/logger.js';
import { MessageMetrics } from '../../../shared/metrics.js';
import { UNKNOWN_PLAYER_NAME } from '../domain/directory.js';
import { SocketNotifier } from './socket-notifier.js';

/**
 * Registre des sessions : qui est la, sous quel nom, et sur quelle socket.
 *
 * Deux reponses de ce fichier portent des consequences hors de proportion avec
 * leur taille. `unregister` doit dire **si c'etait la socket courante** : sans
 * ce booleen, chaque reconnexion legitime arme un forfait et vide la file du
 * joueur qui revient. Et `displayNameOf` doit repondre **synchroniquement**,
 * parce que c'est ce qui permet a l'ouverture d'un match de n'avoir aucun point
 * de suspension entre le controle des sieges et leur reservation.
 */

const config = loadConfig({
  DATABASE_URL: 'postgresql://inutilise',
  REDIS_URL: 'redis://inutilise',
  JWT_SECRET: 'un-secret-assez-long',
  NODE_ENV: 'test',
});

/** Socket de test : on lit ce qui en sort, on note si elle a ete fermee. */
class FakeSocket {
  readonly emitted: { name: string; payload: unknown }[] = [];
  closed = false;

  emit(name: string, payload: unknown): void {
    this.emitted.push({ name, payload });
  }

  disconnect(): void {
    this.closed = true;
  }

  asSocket(): Socket {
    return this as unknown as Socket;
  }
}

let notifier: SocketNotifier;

beforeEach(() => {
  notifier = new SocketNotifier(
    new PinoLoggerService(createLogger(config)),
    new MessageMetrics(false),
  );
});

describe('register', () => {
  it('ferme la socket precedente du meme joueur', () => {
    const ancienne = new FakeSocket();
    const nouvelle = new FakeSocket();

    notifier.register('p1', ancienne.asSocket(), 'Aura Rouge');
    notifier.register('p1', nouvelle.asSocket(), 'Aura Rouge');

    // Sans cette fermeture, l'ancienne socket reste authentifiee et peut encore
    // emettre : cent sockets vaudraient cent fois le budget de debit.
    expect(ancienne.closed).toBe(true);
    expect(nouvelle.closed).toBe(false);
  });

  it('envoie desormais sur la nouvelle socket', () => {
    const ancienne = new FakeSocket();
    const nouvelle = new FakeSocket();

    notifier.register('p1', ancienne.asSocket(), 'Aura Rouge');
    notifier.register('p1', nouvelle.asSocket(), 'Aura Rouge');
    notifier.send('p1', 'pong', { t: 1, serverTime: 2 });

    expect(nouvelle.emitted.map((m) => m.name)).toEqual(['pong']);
    expect(ancienne.emitted).toHaveLength(0);
  });
});

describe('unregister', () => {
  it('confirme le retrait de la socket courante', () => {
    const socket = new FakeSocket();
    notifier.register('p1', socket.asSocket(), 'Aura Rouge');

    expect(notifier.unregister('p1', socket.asSocket())).toBe(true);
    expect(notifier.isConnected('p1')).toBe(false);
  });

  /**
   * Le cas qui compte.
   *
   * `register` ferme la socket precedente, et Socket.IO emet `disconnect`
   * synchroniquement dans la meme pile : le handler de l'ancienne socket se
   * declenche **pendant** une reconnexion legitime. S'il en tirait un abandon,
   * chaque retour de tunnel couterait la partie.
   */
  it('refuse le retrait d une socket deja remplacee', () => {
    const ancienne = new FakeSocket();
    const nouvelle = new FakeSocket();
    notifier.register('p1', ancienne.asSocket(), 'Aura Rouge');
    notifier.register('p1', nouvelle.asSocket(), 'Aura Rouge');

    expect(notifier.unregister('p1', ancienne.asSocket())).toBe(false);
    // Et le joueur reste connecte : c'est la nouvelle socket qui compte.
    expect(notifier.isConnected('p1')).toBe(true);
  });

  it('refuse le retrait d un joueur inconnu', () => {
    expect(notifier.unregister('jamais-vu', new FakeSocket().asSocket())).toBe(false);
  });
});

describe('displayNameOf', () => {
  it('rend le nom resolu a la connexion', () => {
    notifier.register('p1', new FakeSocket().asSocket(), 'Aura Rouge');
    expect(notifier.displayNameOf('p1')).toBe('Aura Rouge');
  });

  it('suit la reconnexion quand le nom a change', () => {
    notifier.register('p1', new FakeSocket().asSocket(), 'Ancien Nom');
    notifier.register('p1', new FakeSocket().asSocket(), 'Nouveau Nom');

    expect(notifier.displayNameOf('p1')).toBe('Nouveau Nom');
  });

  /** Un nom manquant ne vaut pas un duel annule. */
  it('retombe sur le nom de repli pour un joueur absent', () => {
    expect(notifier.displayNameOf('deconnecte')).toBe(UNKNOWN_PLAYER_NAME);
  });
});

describe('send', () => {
  it('refuse d emettre un message qui ne passe pas son propre schema', () => {
    const socket = new FakeSocket();
    notifier.register('p1', socket.asSocket(), 'Aura Rouge');

    // `serverTime` doit etre un entier positif : un message sortant invalide
    // est un defaut du serveur, et il ne part pas.
    notifier.send('p1', 'pong', { t: 1, serverTime: -5 });

    expect(socket.emitted).toHaveLength(0);
  });

  it('ne se plaint pas d un joueur deconnecte', () => {
    // Le match continue sans lui : il reprendra sur `match:rejoin`.
    expect(() => {
      notifier.send('absent', 'pong', { t: 1, serverTime: 2 });
    }).not.toThrow();
  });
});
