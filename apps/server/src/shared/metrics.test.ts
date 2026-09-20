import { describe, expect, it } from 'vitest';
import { CLIENT_MESSAGE_NAMES } from '@aura/protocol';
import { DurationHistogram, MessageMetrics, type MetricsSnapshot } from './metrics.js';

/**
 * Tests de l'instrumentation de charge (jalon M7).
 *
 * Ce qui est verifie ici n'est pas « la mesure est rapide » mais « la mesure
 * est **juste** » : un banc de charge qui apparie les mauvaises durees produit
 * des chiffres plausibles et faux, et personne ne s'en apercoit — c'est le pire
 * defaut possible pour un outil dont tout le role est de dire la verite.
 */

/** Un relevé actif ; echoue si la mesure etait eteinte. */
function activeSnapshot(metrics: MessageMetrics): MetricsSnapshot {
  const snapshot = metrics.snapshot();
  if (!snapshot.enabled) throw new Error('mesure eteinte');
  return snapshot;
}

describe('DurationHistogram', () => {
  it('ne rend que des zeros tant qu il n a rien vu', () => {
    const snapshot = new DurationHistogram().snapshot();
    expect(snapshot.count).toBe(0);
    expect(snapshot.p95Ms).toBe(0);
    expect(snapshot.meanMs).toBe(0);
  });

  it('place un percentile dans le palier qui le contient', () => {
    const histogram = new DurationHistogram();
    // 99 mesures a 1 ms, une a 50 ms : la p95 doit rester a 1 ms, la p99 aussi,
    // et seul le maximum doit voir l'a-coup.
    for (let i = 0; i < 99; i += 1) histogram.record(1_000);
    histogram.record(50_000);

    const snapshot = histogram.snapshot();
    expect(snapshot.count).toBe(100);
    expect(snapshot.p95Ms).toBeLessThanOrEqual(1.05);
    expect(snapshot.p99Ms).toBeLessThanOrEqual(1.05);
    expect(snapshot.maxMs).toBe(50);
    expect(snapshot.minMs).toBe(1);
  });

  /**
   * Le percentile est rendu par la **borne haute** du palier.
   *
   * C'est ce qui garantit qu'on ne declare jamais un seuil tenu alors qu'il ne
   * l'est pas : l'erreur de l'histogramme joue toujours dans le sens severe.
   */
  it('n annonce jamais moins que la valeur mesuree', () => {
    const histogram = new DurationHistogram();
    for (const us of [19_960, 19_970, 19_980, 19_990]) histogram.record(us);
    expect(histogram.snapshot().p95Ms).toBeGreaterThanOrEqual(19.99);
  });

  it('compte les mesures hors echelle sans les perdre', () => {
    const histogram = new DurationHistogram();
    histogram.record(1_000);
    histogram.record(30_000_000);

    const snapshot = histogram.snapshot();
    expect(snapshot.overflow).toBe(1);
    expect(snapshot.maxMs).toBe(30_000);
    // Le maximum reste exact meme hors echelle : c'est le seul chiffre qui
    // permet de dire de combien on a depasse.
    expect(snapshot.p999Ms).toBe(30_000);
  });

  /**
   * L'echelle monte jusqu'a cinq secondes.
   *
   * Plafonnee a 200 ms, elle rendait `p95 = p99 = max` des que l'ecriture d'un
   * match depassait ce seuil en charge — trois chiffres identiques, donc aucune
   * forme de distribution, a l'endroit meme ou il fallait la lire.
   */
  it('distingue encore les durees de l ordre de la seconde', () => {
    const histogram = new DurationHistogram();
    for (let i = 0; i < 95; i += 1) histogram.record(300_000);
    for (let i = 0; i < 5; i += 1) histogram.record(1_200_000);

    const snapshot = histogram.snapshot();
    expect(snapshot.p50Ms).toBeLessThanOrEqual(325);
    expect(snapshot.p95Ms).toBeLessThanOrEqual(325);
    expect(snapshot.p99Ms).toBeGreaterThanOrEqual(1_200);
    expect(snapshot.overflow).toBe(0);
  });

  it('oublie tout a la remise a zero', () => {
    const histogram = new DurationHistogram();
    histogram.record(5_000);
    histogram.reset();
    expect(histogram.size).toBe(0);
    expect(histogram.snapshot().maxMs).toBe(0);
  });
});

describe('MessageMetrics, eteinte', () => {
  it('ne rend rien et ne retient rien', () => {
    const metrics = new MessageMetrics(false);
    const socket = {};
    metrics.received(socket, 'ping');
    metrics.settleHandled(socket, 'ping');
    expect(metrics.snapshot()).toEqual({ enabled: false });
  });
});

describe('MessageMetrics, allumee', () => {
  it('compte un message traite sous le nom de son evenement', () => {
    const metrics = new MessageMetrics(true);
    const socket = {};

    metrics.received(socket, 'recharge:taps');
    metrics.recordInboundFilter(socket);
    metrics.settleHandled(socket, 'recharge:taps');

    const snapshot = activeSnapshot(metrics);
    expect(snapshot.messages.handled).toBe(1);
    expect(snapshot.messages.rejected).toBe(0);
    expect(snapshot.messages.total.count).toBe(1);
    expect(snapshot.messages.byEvent['recharge:taps']?.count).toBe(1);
    expect(snapshot.inboundFilter.count).toBe(1);
    expect(snapshot.unmatched).toBe(0);
  });

  it('compte un message refuse par le filtre, car il a coute du temps serveur', () => {
    const metrics = new MessageMetrics(true);
    const socket = {};

    metrics.received(socket, 'choice:lock');
    metrics.settleRejected(socket, 'choice:lock');

    const snapshot = activeSnapshot(metrics);
    expect(snapshot.messages.rejected).toBe(1);
    expect(snapshot.messages.handled).toBe(0);
    expect(snapshot.messages.total.count).toBe(1);
  });

  /**
   * Deux gestionnaires qui se terminent dans le desordre.
   *
   * `queue:join` interroge Redis ; le `ping` arrive derriere lui repond
   * sur-le-champ. Solder « le plus ancien en attente » attribuerait donc
   * l'attente de Redis au ping, et rendrait la p95 de `ping` — le message le
   * plus frequent du protocole — completement fausse.
   */
  it('apparie par nom, pas par ordre d arrivee', () => {
    const metrics = new MessageMetrics(true);
    const socket = {};

    metrics.received(socket, 'queue:join');
    metrics.received(socket, 'ping');
    metrics.settleHandled(socket, 'ping');
    metrics.settleHandled(socket, 'queue:join');

    const snapshot = activeSnapshot(metrics);
    expect(snapshot.messages.byEvent.ping?.count).toBe(1);
    expect(snapshot.messages.byEvent['queue:join']?.count).toBe(1);
    expect(snapshot.unmatched).toBe(0);
  });

  /**
   * Un message valide sans gestionnaire ne doit rien decaler.
   *
   * `intent:show` est dans le registre du protocole mais n'a pas encore de
   * `@SubscribeMessage` : sa trace n'est jamais soldee. Avec un appariement
   * par ordre d'arrivee, elle prendrait la place de tous les messages
   * suivants de la meme socket — chacun se verrait attribuer l'instant
   * d'arrivee du precedent, et la mesure derivererait sans jamais paraitre
   * anormale.
   */
  it('n est pas decalee par un message sans gestionnaire', () => {
    const metrics = new MessageMetrics(true);
    const socket = {};

    metrics.received(socket, 'intent:show');
    metrics.received(socket, 'ping');
    metrics.settleHandled(socket, 'ping');

    const snapshot = activeSnapshot(metrics);
    expect(snapshot.messages.byEvent.ping?.count).toBe(1);
    expect(snapshot.messages.byEvent['intent:show']).toBeUndefined();
    expect(snapshot.unmatched).toBe(0);
  });

  it('signale un soldé sans trace d arrivee plutot que de l inventer', () => {
    const metrics = new MessageMetrics(true);
    const socket = {};

    metrics.received(socket, 'ping');
    metrics.settleHandled(socket, 'ping');
    metrics.settleHandled(socket, 'ping');

    expect(activeSnapshot(metrics).unmatched).toBe(1);
  });

  /**
   * La memoire par connexion est bornee.
   *
   * Sans cette borne, une socket qui n'envoie que des messages sans
   * gestionnaire accumulerait une trace par message jusqu'a sa fermeture — une
   * fuite de memoire dans l'outil meme qui sert a chercher les fuites.
   */
  it('evince les traces les plus anciennes au-dela de sa borne', () => {
    const metrics = new MessageMetrics(true);
    const socket = {};

    for (let i = 0; i < 40; i += 1) metrics.received(socket, 'intent:show');

    expect(activeSnapshot(metrics).messages.unsettled).toBe(8);
  });

  it('oublie une connexion fermee', () => {
    const metrics = new MessageMetrics(true);
    const socket = {};

    metrics.received(socket, 'ping');
    metrics.forget(socket);
    metrics.settleHandled(socket, 'ping');

    const snapshot = activeSnapshot(metrics);
    expect(snapshot.messages.total.count).toBe(0);
    // Rien a solder n'est pas une anomalie de mesure : la socket n'existe plus.
    expect(snapshot.unmatched).toBe(0);
  });

  /**
   * Une tache de fond qui echoue ne se voit nulle part ailleurs.
   *
   * L'ecriture d'un match acheve part apres que les deux joueurs ont recu leur
   * resultat : son echec ne retarde personne, n'apparait dans aucun percentile
   * de message, et ne se lit que dans le journal, un match a la fois. Le
   * compteur est le seul endroit ou « des matchs disparaissent » devient un
   * chiffre.
   */
  it('compte une tache de fond, reussie ou echouee', async () => {
    const metrics = new MessageMetrics(true);

    await metrics.observeTask('match:save', () => Promise.resolve('ok'));
    await expect(
      metrics.observeTask('match:save', () => Promise.reject(new Error('base indisponible'))),
    ).rejects.toThrow('base indisponible');

    const snapshot = activeSnapshot(metrics);
    expect(snapshot.tasks['match:save']?.count).toBe(2);
    expect(snapshot.tasks['match:save']?.failures).toBe(1);
  });

  it('laisse passer une tache de fond quand la mesure est eteinte', async () => {
    const metrics = new MessageMetrics(false);
    await expect(metrics.observeTask('match:save', () => Promise.resolve(7))).resolves.toBe(7);
    expect(metrics.snapshot()).toEqual({ enabled: false });
  });

  it('publie les compteurs vivants au moment du relevé', () => {
    const metrics = new MessageMetrics(true);
    let matches = 0;
    metrics.registerGauge('liveMatches', () => matches);

    expect(activeSnapshot(metrics).gauges.liveMatches).toBe(0);
    matches = 500;
    expect(activeSnapshot(metrics).gauges.liveMatches).toBe(500);
  });

  it('repart d une fenetre vide', () => {
    const metrics = new MessageMetrics(true);
    const socket = {};

    metrics.received(socket, 'ping');
    metrics.settleHandled(socket, 'ping');
    metrics.reset();

    const snapshot = activeSnapshot(metrics);
    expect(snapshot.messages.total.count).toBe(0);
    expect(snapshot.messages.handled).toBe(0);
    expect(snapshot.messages.byEvent).toEqual({});
  });

  it('mesure une duree reelle, pas un zero constant', () => {
    const metrics = new MessageMetrics(true);
    const socket = {};

    metrics.received(socket, 'ping');
    const until = process.hrtime.bigint() + 3_000_000n;
    while (process.hrtime.bigint() < until) {
      /* occupation deliberee de la boucle */
    }
    metrics.settleHandled(socket, 'ping');

    expect(activeSnapshot(metrics).messages.total.maxMs).toBeGreaterThanOrEqual(3);
  });
});

/**
 * Le nom d'un evenement Socket.IO est choisi par le CLIENT.
 *
 * `socket.onAny` voit donc tout ce qu'une socket veut bien emettre, y compris
 * ce que le protocole ne connait pas — et le filtre d'entree refuse ces
 * messages-la, ce qui les fait passer par `settleRejected`, c'est-a-dire par
 * la table indexee par nom. Une table qui grandit a chaque nom inedit est une
 * table que l'adversaire remplit : il suffit d'emettre des noms tires au
 * hasard pour faire naitre un histogramme par nom, jusqu'a epuiser la memoire
 * du noeud.
 *
 * C'est le piege que `CLAUDE.md` enonce : **le protocole borne un message, pas
 * la somme des messages**. La borne ne peut pas venir du schema — un nom
 * inconnu n'a pas de schema — elle doit venir d'ici.
 */
describe('noms d evenements inventes par le client', () => {
  it('ne cree pas un histogramme par nom inconnu', () => {
    const metrics = new MessageMetrics(true);
    const socket = {};

    for (let i = 0; i < 5_000; i += 1) {
      const invente = `truc:${i}`;
      metrics.received(socket, invente);
      metrics.settleRejected(socket, invente);
    }

    const snapshot = activeSnapshot(metrics);
    expect(Object.keys(snapshot.messages.byEvent).length).toBeLessThanOrEqual(
      CLIENT_MESSAGE_NAMES.length + 1,
    );
  });

  /**
   * Les refuser ne doit pas revenir a les ignorer : le temps passe a rejeter
   * un message inconnu est du temps serveur, et il doit rester visible.
   * Il est simplement compte ensemble, sous un seul nom.
   */
  it('les compte tous ensemble, sans les perdre', () => {
    const metrics = new MessageMetrics(true);
    const socket = {};

    for (let i = 0; i < 40; i += 1) {
      metrics.received(socket, `truc:${i}`);
      metrics.settleRejected(socket, `truc:${i}`);
    }

    const snapshot = activeSnapshot(metrics);
    expect(snapshot.messages.rejected).toBe(40);
    expect(snapshot.messages.total.count).toBe(40);
    expect(snapshot.messages.byEvent.inconnu?.count).toBe(40);
  });

  /** Un vrai nom de message garde son propre histogramme, lui. */
  it('laisse chaque message du protocole a son propre compteur', () => {
    const metrics = new MessageMetrics(true);
    const socket = {};

    for (const nom of CLIENT_MESSAGE_NAMES) {
      metrics.received(socket, nom);
      metrics.settleHandled(socket, nom);
    }

    const snapshot = activeSnapshot(metrics);
    for (const nom of CLIENT_MESSAGE_NAMES) {
      expect(snapshot.messages.byEvent[nom]?.count).toBe(1);
    }
    expect(snapshot.messages.byEvent.inconnu).toBeUndefined();
  });
});
