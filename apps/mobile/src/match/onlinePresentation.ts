import type { Seat } from '@aura/rules';
import { animationFor, systemAnimation } from '../content/animations.js';
import type { Look } from '../app/wardrobe.js';
import type { OnlinePhase, OnlineState } from './online.js';
import type { FighterPresentation, Presentation, PresentOptions } from './presentation.js';

/**
 * De l etat d un match en ligne a ce que l arene doit afficher.
 *
 * Le pendant de `present`, pour l autre source de verite. Le solo tient un
 * `MatchState` complet — il fait tourner le moteur lui-meme ; le client en
 * ligne, lui, ne connait que ce que le serveur a bien voulu lui dire, et c est
 * exactement le point : les deux chemins doivent produire la MEME scene, sinon
 * le duel en ligne se joue sur un autre jeu que l entrainement.
 *
 * Meme discipline que `present` sur la regle d or n°4, avec un piege de plus.
 * En ligne, le resultat d une manche reste en memoire apres sa revelation :
 * `lastRound` survit a la manche suivante. Le rejouer pendant la recharge
 * suivante ferait danser les deux combattants avec une manche de retard — et
 * surtout, montrerait le mouvement adverse alors que la manche en cours est
 * encore secrete. Le reseau n aurait rien divulgue ; l ecran, si.
 */

const CHARGE = 'charge';

/** Ferveur par phase. Elle suit l enjeu, comme en solo. */
const HYPE_BY_PHASE: Readonly<Record<OnlinePhase, number>> = {
  idle: 0.2,
  intro: 0.18,
  recharge: 0.55,
  choice: 0.4,
  reveal: 0.95,
  ended: 0.7,
};

export function presentOnline(
  state: OnlineState,
  looks: Readonly<Record<Seat, Look>>,
  options: PresentOptions = {},
): Presentation {
  const revealing = state.phase === 'reveal' || state.phase === 'ended';

  /**
   * Le resultat de la manche affichee, et seulement d elle.
   *
   * La comparaison des numeros est ce qui empeche la fuite d une manche a
   * l autre : hors revelation, ou si `lastRound` decrit une manche deja jouee,
   * il n y a rien a montrer.
   */
  const round =
    revealing && state.lastRound !== null && state.lastRound.round === state.round
      ? state.lastRound
      : null;

  /**
   * Le rig de gauche est toujours le joueur local, jamais « le siege A ».
   *
   * Le reste de l ecran l a deja tranche : le bandeau ecrit « Toi » a gauche et
   * `looks.a` porte la tenue du vestiaire. Le serveur, lui, assoit la moitie
   * des joueurs en B. Lire `sides` par siege revenait donc a faire danser, chez
   * un joueur sur deux, sa propre tenue sur le mouvement de l adversaire.
   */
  const mine: Seat = state.seat ?? 'a';
  const seatOfRig: Readonly<Record<Seat, Seat>> = {
    a: mine,
    b: mine === 'a' ? 'b' : 'a',
  };

  const animationOf = (rig: Seat): string => {
    if (round === null) return systemAnimation(CHARGE).id;
    const seat = seatOfRig[rig];

    if (options.showOutcome === true && round.winner !== null) {
      return systemAnimation(round.winner === seat ? 'victory' : 'stagger').id;
    }

    const side = round.sides[seat];
    // Le cosmetique vient du serveur avec le resultat : l honorer est legitime,
    // et c est la seule facon de voir la danse que l adversaire a payee.
    return animationFor(side.move, side.cosmetic.animationId).id;
  };

  /*
    L effet d aura suit exactement l animation : meme message, meme condition.

    Il depend du palier joue, donc le montrer avant la revelation dirait le
    choix secret (regle d or n°4). L aligner sur `animationOf` plutot que sur
    une condition ecrite a cote est ce qui garantit que les deux ne peuvent
    pas se desynchroniser — un jour ou l autre, l une des deux conditions
    aurait bouge sans l autre.
  */
  const effectOf = (rig: Seat): string | undefined =>
    round === null ? undefined : round.sides[seatOfRig[rig]].cosmetic.effectId;

  const present = (rig: Seat, look: Look): FighterPresentation => {
    const effectId = effectOf(rig);
    return {
      animationId: animationOf(rig),
      look,
      ...(effectId === undefined ? {} : { auraEffectId: effectId }),
    };
  };

  return {
    fighters: { a: present('a', looks.a), b: present('b', looks.b) },
    hype: HYPE_BY_PHASE[state.phase],
  };
}
