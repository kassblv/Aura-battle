import { createHash } from 'node:crypto';
import { PROTOCOL_VERSION } from '@aura/protocol';
import { io, type Socket } from 'socket.io-client';
import { percentilesOf, type Percentiles } from './protocol.js';

/**
 * Un client temoin, tenu par l'orchestrateur lui-meme (jalon M7).
 *
 * Il ne joue pas : il se connecte et envoie un `ping` toutes les 200 ms. Son
 * interet est d'etre **seul dans un processus inoccupe**, la ou chaque
 * processus client du banc tient deux cent cinquante sockets.
 *
 * C'est ce qui permet de trancher une question que le relevé serveur ne peut
 * pas trancher seul : quand les clients du banc mesurent cent millisecondes
 * d'aller-retour alors que le serveur annonce un dixieme de milliseconde de
 * traitement, ou sont passees les quatre-vingt-dix-neuf autres ? Si le temoin
 * repond vite, elles sont dans les processus clients — et la latence relevee
 * par le banc dit quelque chose du banc, pas du serveur.
 */
export class WitnessClient {
  private socket: Socket | null = null;
  private timer: NodeJS.Timeout | null = null;
  private readonly rtt: number[] = [];

  /** Ouvre une session dediee et connecte le temoin. */
  async connect(httpUrl: string, wsUrl: string): Promise<void> {
    const deviceSecret = createHash('sha256').update('aura-bench-witness').digest('hex');
    const response = await fetch(`${httpUrl}/auth/device`, {
      method: 'POST',
      // Son adresse a lui, hors de la plage des joueurs simules (`worker.ts`).
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.255.255.254' },
      body: JSON.stringify({ deviceSecret }),
    });
    if (!response.ok) throw new Error('le temoin n a pas pu ouvrir de session');
    const session = (await response.json()) as { accessToken: string };

    const socket = io(wsUrl, {
      transports: ['websocket'],
      auth: { token: session.accessToken, protocolVersion: PROTOCOL_VERSION },
      forceNew: true,
      reconnection: false,
      autoConnect: false,
    });
    socket.on('pong', (payload: { t: number }) => {
      this.rtt.push(Date.now() - payload.t);
    });

    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => {
        resolve();
      });
      socket.once('connect_error', (cause: Error) => {
        reject(cause);
      });
      socket.connect();
    });
    this.socket = socket;
  }

  /** Repart d'un echantillon vide et bat la mesure. */
  start(periodMs = 200): void {
    this.rtt.length = 0;
    this.timer = setInterval(() => {
      this.socket?.emit('ping', { t: Date.now() });
    }, periodMs);
  }

  stop(): Percentiles {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.socket?.disconnect();
    return percentilesOf(this.rtt);
  }
}
