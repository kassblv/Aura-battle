import type { Style, Tier } from '@aura/content';
import { BALANCE, beats, type Move } from '@aura/rules';
import { CLASH_AT_MS, REVEAL_FIRST_AT_MS, REVEAL_GAP_MS } from '../arena/round.js';
import { poseIcon } from '../content/animations.js';
import type { RoundView } from '../match/view.js';
import { memeGallery } from './memes.js';
import { danceOptions, type Wardrobe } from './wardrobe.js';

/**
 * La scene de revelation (chantier n°3), en donnees pures.
 *
 * L'arene joue deja le rythme de la revelation ; ce module decide ce que
 * l'interface en raconte : les deux cartes jouees, l'instant ou chacune se
 * montre, et le bandeau qui dit POURQUOI une aura gagne au choc.
 *
 * Tout vient de la manche deja resolue (`RoundView`) : rien ici ne peut
 * reveler plus tot ce que le serveur n'a pas encore publie.
 */

export type Side = 'moi' | 'adversaire';

export interface RevealCard {
  readonly poseId: string;
  readonly name: string;
  readonly icon: string;
  readonly family: Style;
  readonly tier: Tier;
  /** Instant ou la carte se montre, en ms depuis le debut de la revelation. */
  readonly atMs: number;
  /** Arrive face cachee et se retourne a son instant. */
  readonly faceDown: boolean;
  readonly shiny: boolean;
}

export type RevealCallout =
  | {
      readonly kind: 'counter';
      readonly by: Side;
      readonly winner: Style;
      readonly loser: Style;
      readonly multiplier: number;
    }
  | { readonly kind: 'mirror'; readonly family: Style }
  /** `by` : le camp dont l'Ultime a annule le contre subi. */
  | { readonly kind: 'blocked'; readonly by: Side };

export interface RevealScene {
  readonly mine: RevealCard;
  readonly theirs: RevealCard;
  readonly callout: RevealCallout | null;
  readonly calloutAtMs: number;
}

const gallery = memeGallery();

/** La pose adverse annoncee, si elle joue bien ce mouvement ; sinon l'offerte. */
function opponentPose(move: Move, poseId: string | null): { id: string; name: string } {
  const cell = gallery.filter((card) => card.style === move.style && card.tier === move.tier);
  const card = cell.find((c) => c.animationId === poseId) ?? cell.find((c) => c.free) ?? cell[0];
  return { id: card?.animationId ?? '', name: card?.name ?? '' };
}

function calloutOf(round: RoundView): RevealCallout | null {
  const mine = round.myMove.style;
  const theirs = round.opponentMove.style;
  if (round.counteredBy !== null) {
    const byMe = round.counteredBy === 'moi';
    return {
      kind: 'counter',
      by: round.counteredBy,
      winner: byMe ? mine : theirs,
      loser: byMe ? theirs : mine,
      multiplier: BALANCE.counter.winnerMultiplier,
    };
  }
  if (round.counterBlocked) {
    // L'Ultime protege celui qui aurait subi le contre.
    return { kind: 'blocked', by: beats(mine, theirs) ? 'adversaire' : 'moi' };
  }
  if (mine === theirs) return { kind: 'mirror', family: mine };
  return null;
}

export function revealScene(round: RoundView, wardrobe: Wardrobe): RevealScene {
  const first = REVEAL_FIRST_AT_MS;
  const second = REVEAL_FIRST_AT_MS + REVEAL_GAP_MS;
  const myFirst = round.revealFirst === 'moi';

  const myPose = danceOptions(wardrobe, round.myMove);
  const myCard = myPose.choices.find((card) => card.animationId === myPose.current);
  const their = opponentPose(round.opponentMove, round.opponentPoseId);

  return {
    mine: {
      poseId: myPose.current,
      name: myCard?.name ?? '',
      icon: poseIcon(myPose.current),
      family: round.myMove.style,
      tier: round.myMove.tier,
      atMs: myFirst ? first : second,
      faceDown: false,
      shiny: round.myShiny,
    },
    theirs: {
      poseId: their.id,
      name: their.name,
      icon: poseIcon(their.id),
      family: round.opponentMove.style,
      tier: round.opponentMove.tier,
      atMs: myFirst ? second : first,
      faceDown: true,
      shiny: round.opponentShiny,
    },
    callout: calloutOf(round),
    calloutAtMs: CLASH_AT_MS,
  };
}
