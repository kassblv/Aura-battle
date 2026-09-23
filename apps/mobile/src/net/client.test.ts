import { PROTOCOL_VERSION } from '@aura/protocol';
import { describe, expect, it, vi } from 'vitest';
import { createGameClient, type Transport } from './client.js';

/** Double de transport : on pousse des messages comme le ferait le serveur. */
function transport(): Transport & {
  emit(name: string, payload: unknown): void;
  readonly sent: { name: string; payload: unknown }[];
  connect(): void;
  drop(): void;
  readonly woken: () => number;
} {
  const handlers = new Map<string, (payload: unknown) => void>();
  let onConnect: (() => void) | null = null;
  let onDisconnect: (() => void) | null = null;
  const sent: { name: string; payload: unknown }[] = [];
  let wokenCount = 0;

  return {
    sent,
    woken: () => wokenCount,
    send: (name, payload) => {
      sent.push({ name, payload });
    },
    onMessage: (handler) => {
      handlers.set('*', handler);
    },
    onConnect: (handler) => {
      onConnect = handler;
    },
    onDisconnect: (handler) => {
      onDisconnect = handler;
    },
    close: () => undefined,
    wake: () => {
      wokenCount++;
    },
    emit: (name, payload) => {
      handlers.get('*')?.(name === undefined ? payload : { name, payload });
    },
    connect: () => onConnect?.(),
    drop: () => onDisconnect?.(),
  };
}

const matchFound = {
  matchId: 'm_11111111-1111-4111-8111-111111111111',
  seat: 'a',
  opponent: { displayName: 'Nova', league: 'Or II', cosmetics: {} },
  protocolVersion: PROTOCOL_VERSION,
  rulesVersion: '1.0.0',
  contentVersion: '1.0.0',
  ghost: false,
};

describe('createGameClient', () => {
  it('annonce les messages valides sous leur nom', () => {
    const link = transport();
    const client = createGameClient(link);
    const seen = vi.fn();
    client.on('match:found', seen);

    link.emit('match:found', matchFound);
    expect(seen).toHaveBeenCalledWith(matchFound);
  });

  /**
   * Un message qui ne passe pas le schema est jete, pas transmis.
   *
   * C'est la moitie du garde-fou qu'on oublie : le serveur valide ce qu'il
   * recoit, le client doit valider ce qu'il lit. Un mandataire, une extension
   * ou une version plus recente du serveur peuvent poser n'importe quoi sur ce
   * canal, et l'interface n'a aucun moyen de s'en remettre a mi-chemin.
   */
  it('jette un message qui ne respecte pas le schema', () => {
    const link = transport();
    const client = createGameClient(link);
    const seen = vi.fn();
    client.on('match:found', seen);

    link.emit('match:found', { matchId: 'pas-un-identifiant' });
    expect(seen).not.toHaveBeenCalled();
    expect(client.droppedMessages).toBe(1);
  });

  it('jette un nom de message inconnu sans se plaindre bruyamment', () => {
    const link = transport();
    const client = createGameClient(link);
    link.emit('match:teleport', {});
    // Un serveur plus recent peut parler de choses qu'on ignore : ce n'est pas
    // une panne, c'est une version d'avance.
    expect(client.droppedMessages).toBe(1);
  });

  it('ne parle qu aux abonnes du bon message', () => {
    const link = transport();
    const client = createGameClient(link);
    const other = vi.fn();
    client.on('round:intro', other);
    link.emit('match:found', matchFound);
    expect(other).not.toHaveBeenCalled();
  });

  it('laisse se desabonner', () => {
    const link = transport();
    const client = createGameClient(link);
    const seen = vi.fn();
    const off = client.on('match:found', seen);
    off();
    link.emit('match:found', matchFound);
    expect(seen).not.toHaveBeenCalled();
  });
});

describe('envoi', () => {
  it('refuse d emettre un message que le schema rejette', () => {
    const link = transport();
    const client = createGameClient(link);
    // Valider le sortant protege le joueur : un message malforme serait refuse
    // par le serveur, et le client attendrait une reponse qui ne vient jamais.
    // Un espace suffit : un identifiant de match sert de cle Redis et de champ
    // de journal, ou une espace ouvre une collision ou une fausse ligne.
    expect(client.send('match:ready', { matchId: 'm 1' })).toBe(false);
    expect(link.sent).toHaveLength(0);
  });

  it('emet un message bien forme', () => {
    const link = transport();
    const client = createGameClient(link);
    expect(client.send('match:ready', { matchId: matchFound.matchId })).toBe(true);
    expect(link.sent[0]?.name).toBe('match:ready');
  });
});

describe('horloge', () => {
  it('mesure le decalage avec le serveur au fil des pongs', () => {
    const link = transport();
    let now = 1000;
    const client = createGameClient(link, { now: () => now });

    client.ping();
    const ping = link.sent.find((message) => message.name === 'ping');
    expect(ping).toBeDefined();

    now = 1040;
    link.emit('pong', { t: (ping?.payload as { t: number }).t, serverTime: 501_020 });
    expect(client.clock.synced).toBe(true);
    expect(client.clock.offsetMs).toBeCloseTo(501_020 - 1020, 3);
  });

  /**
   * Un `pong` dont l'estampille ne correspond a aucun `ping` emis ne mesure
   * rien : l'accepter ferait entrer un decalage invente dans l'horloge qui
   * date les taps.
   */
  it('ignore un pong qui ne repond a aucun ping', () => {
    const link = transport();
    const client = createGameClient(link, { now: () => 1000 });
    link.emit('pong', { t: 999_999, serverTime: 500_000 });
    expect(client.clock.synced).toBe(false);
  });
});

describe('cycle de vie', () => {
  it('suit l etat du lien', () => {
    const link = transport();
    const client = createGameClient(link);
    expect(client.connection.status).toBe('connecting');
    link.connect();
    expect(client.connection.status).toBe('online');
    link.drop();
    expect(client.connection.status).toBe('offline');
  });

  it('redemande l etat du match apres une coupure', () => {
    const link = transport();
    createGameClient(link);
    link.connect();
    link.emit('match:found', matchFound);
    link.drop();
    link.connect();
    expect(link.sent.at(-1)).toEqual({
      name: 'match:rejoin',
      payload: { matchId: matchFound.matchId },
    });
  });

  it('cesse de reclamer un match termine', () => {
    const link = transport();
    createGameClient(link);
    link.connect();
    link.emit('match:found', matchFound);
    link.emit('match:end', {
      matchId: matchFound.matchId,
      winner: 'a',
      reason: 'rounds',
      rating: { before: 1200, after: 1215, leagueBefore: 'Or II', leagueAfter: 'Or II' },
      rewards: { softCurrency: 40, xp: 120, xpTotal: 120 },
    });
    link.drop();
    link.connect();
    expect(link.sent.some((message) => message.name === 'match:rejoin')).toBe(false);
  });
});

describe('wake — le retour au premier plan', () => {
  /*
    Une socket qui se croit vivante apres une mise en veille.

    iOS suspend la WebView : les battements de coeur ne partent plus, le
    serveur finit par fermer de son cote, mais le client ne l'apprend qu'au
    prochain paquet — qui part dans le vide. Le joueur voit « en ligne » et
    rien ne bouge. Au retour, on force donc la verification plutot que de
    croire un etat qui date d'avant la veille.
  */
  it('reconnecte une socket qui se croit encore ouverte', () => {
    const link = transport();
    const client = createGameClient(link);
    link.connect();
    expect(client.connection.status).not.toBe('offline');

    client.wake();
    expect(link.woken()).toBe(1);
  });

  /*
    Deja hors ligne, il n'y a rien a verifier : la reconnexion de Socket.IO
    tourne deja, et la brusquer relancerait son compte a rebours depuis zero.
  */
  it('ne brusque pas une reconnexion deja en cours', () => {
    const link = transport();
    const client = createGameClient(link);
    link.connect();
    link.drop();

    client.wake();
    expect(link.woken()).toBe(0);
  });
});
