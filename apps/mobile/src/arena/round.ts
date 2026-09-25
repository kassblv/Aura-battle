import type { Seat, TimingQuality } from '@aura/rules';
import type { ArenaEvent } from './events.js';
import { CLASH_DURATION_MS, CLASH_HIT_AT } from './clash.js';

/**
 * De la manche revelee a la choregraphie de l arene.
 *
 * Deux traductions, toutes deux pures :
 *
 * 1. `storyOfRound` passe du vocabulaire de l ecran (« moi », « adversaire »)
 *    a celui de l arene (les deux rigs, `a` a gauche et `b` a droite). Le rig
 *    `a` est **toujours** le joueur de cet appareil, jamais « le siege A » du
 *    serveur : `onlinePresentation.ts` a deja tranche cela, et le refaire
 *    autrement ferait danser la tenue du vestiaire sur le mouvement d en face.
 * 2. `roundChoreography` etale les faits dans le temps : qui se revele, quand
 *    les auras se percutent, quand tombe le verdict.
 *
 * Rien ici ne decide d un score. La manche est deja tranchee quand elle
 * arrive : l arene choisit seulement comment la raconter (regle d or n°1).
 */

/** Un cote de la manche, vu de l arene. */
export interface RoundSideStory {
  readonly score: number;
  readonly quality: TimingQuality;
  readonly ultimate: boolean;
  /** Ce siege a contre l autre. */
  readonly counters: boolean;
}

export interface RoundStory {
  /** Numero de la manche : c est lui qui distingue « nouveau » de « encore ». */
  readonly round: number;
  readonly sides: Readonly<Record<Seat, RoundSideStory>>;
  readonly winner: Seat | null;
  /** Qui se revele en premier. Le serveur le dit dans `timeline.revealFirst`. */
  readonly revealFirst: Seat;
}

/**
 * Ce que l arene lit d une manche terminee.
 *
 * Structurellement compatible avec `RoundView` de `match/view.ts`, qui porte
 * tous ces champs depuis le chantier n°3. Ils restent facultatifs ici pour les
 * appelants qui n'ont qu'un resume de manche. Ce ne sont pas des details de
 * confort : sans eux, l arene ne sait ni qui a contre qui, ni si l adversaire a
 * lache son Ultime. Les replis ci-dessous sont explicites et testes.
 */
export interface RoundReport {
  readonly round: number;
  readonly winner: 'moi' | 'adversaire' | null;
  readonly myScore: number;
  readonly opponentScore: number;
  readonly myQuality: TimingQuality;
  readonly myUltimate: boolean;
  /** L un des deux a contre l autre, sans dire lequel. */
  readonly countered: boolean;
  readonly opponentQuality?: TimingQuality | undefined;
  readonly opponentUltimate?: boolean | undefined;
  /** Qui a contre. Absent, on l attribue au vainqueur — voir `counterSeat`. */
  readonly counteredBy?: 'moi' | 'adversaire' | null | undefined;
  readonly revealFirst?: 'moi' | 'adversaire' | undefined;
}

const seatOf = (side: 'moi' | 'adversaire'): Seat => (side === 'moi' ? 'a' : 'b');

/**
 * Qui a contre, quand la vue ne le dit pas.
 *
 * Un contre multiplie le score du contreur par 1,35 et divise celui du contre
 * par 0,85 : l ecart est de 59 %, et celui qui contre gagne la manche sauf a
 * partir de tres loin. Attribuer le contre au vainqueur est donc juste presque
 * toujours — mais « presque » est la raison pour laquelle `counteredBy` doit
 * finir par arriver dans la vue.
 */
function counterSeat(report: RoundReport): Seat | null {
  if (report.counteredBy !== undefined) {
    return report.counteredBy === null ? null : seatOf(report.counteredBy);
  }
  if (!report.countered || report.winner === null) return null;
  return seatOf(report.winner);
}

export function storyOfRound(report: RoundReport): RoundStory {
  const counter = counterSeat(report);

  return {
    round: report.round,
    winner: report.winner === null ? null : seatOf(report.winner),
    sides: {
      a: {
        score: report.myScore,
        quality: report.myQuality,
        ultimate: report.myUltimate,
        counters: counter === 'a',
      },
      b: {
        score: report.opponentScore,
        // Le timing adverse est public une fois la manche revelee : c est
        // `round:result` qui le porte, pas une deduction du client.
        quality: report.opponentQuality ?? 'good',
        ultimate: report.opponentUltimate ?? false,
        counters: counter === 'b',
      },
    },
    /*
      A defaut de `timeline.revealFirst`, l adversaire ouvre.

      Le prototype reveille dans l ordre `['right', 'left']` en solo, et pour
      une raison de mise en scene : la revelation du joueur est le point haut,
      elle doit arriver en dernier, juste avant le choc.
    */
    revealFirst: seatOf(report.revealFirst ?? 'adversaire'),
  };
}

/* ------------------------------------------------------------------ *
 * La choregraphie
 * ------------------------------------------------------------------ */

/** Premiere revelation : le temps que la phase s installe. */
export const REVEAL_FIRST_AT_MS = 120;
/**
 * Ecart entre les deux revelations.
 *
 * Il etait de 500 ms, et tout tenait en 1 400 : le second danseur passait
 * 780 ms a l ecran avant de basculer sur la joie ou l encaissement — a peine
 * une mesure. Une aura battle existe pour montrer deux memes face a face ; on
 * leur laisse le temps d etre vus, sans toucher a la duree de la revelation
 * (4,5 s, `BALANCE`), que le panneau de verdict partage.
 */
export const REVEAL_GAP_MS = 700;
/**
 * Depart du choc.
 *
 * Les deux danses tournent depuis 730 ms quand les faisceaux partent : le
 * choc se joue par-dessus elles, pas a leur place. Plus tard, le panneau de
 * verdict n aurait plus ses deux secondes de lecture.
 */
export const CLASH_AT_MS = 1_550;
/**
 * Verdict : pose de victoire d un cote, d encaissement de l autre.
 *
 * Calcule, pas recopie : le contact tombe a `CLASH_HIT_AT` de la duree du
 * choc, et c est a cet instant precis que le perdant doit encaisser —
 * **parce qu** il vient d etre touche, pas avant que les auras se rencontrent.
 * `useOnlineMatch` et `useMatch` le lisent ici, par `outcomeShown`.
 */
export const VICTORY_AT_MS = Math.round(CLASH_AT_MS + CLASH_DURATION_MS * CLASH_HIT_AT);

/**
 * La joie et l encaissement sont-ils a l ecran, `inPhaseMs` apres le debut de la phase ?
 *
 * Un seul endroit pour le dire : l ecran en ligne gardait sa propre copie de
 * l instant (`VERDICT_AFTER_MS`), qui aurait continue de valoir 1 400 ms le
 * jour ou la choregraphie aurait bouge — et le perdant aurait chancele avant
 * d etre touche. Le solo, lui, basculait des la premiere image de la
 * revelation : les danses ne s y voyaient pas du tout.
 */
export function outcomeShown(phase: string, inPhaseMs: number): boolean {
  if (phase === 'ended') return true;
  return phase === 'reveal' && inPhaseMs >= VICTORY_AT_MS;
}

/**
 * Apparition du panneau de verdict, une fois les faisceaux eteints.
 *
 * Le panneau se pose au centre, la ou les deux auras se rencontrent. Il
 * s affichait des la premiere image de la revelation et masquait donc le
 * choc tout entier — le seul moment que la manche prepare. Le score tombe
 * apres l image, pas a sa place : la revelation dure 4,5 s, il reste plus de
 * deux secondes pour le lire.
 */
export const VERDICT_PANEL_AT_MS = CLASH_AT_MS + CLASH_DURATION_MS;

/** Le panneau de verdict est-il a l ecran, `inPhaseMs` apres le debut de la phase ? */
export function verdictPanelShown(phase: string, inPhaseMs: number): boolean {
  if (phase === 'ended') return true;
  return phase === 'reveal' && inPhaseMs >= VERDICT_PANEL_AT_MS;
}

export interface ScheduledArenaEvent {
  /** Instant de l evenement, en millisecondes depuis le debut de la revelation. */
  readonly atMs: number;
  readonly event: ArenaEvent;
}

/**
 * Les quatre temps d une manche revelee, dans l ordre.
 *
 * Fonction pure : elle ne connait ni l horloge ni la scene. C est le
 * realisateur (`director.ts`) qui la deroule image par image.
 */
export function roundChoreography(story: RoundStory): readonly ScheduledArenaEvent[] {
  const second: Seat = story.revealFirst === 'a' ? 'b' : 'a';
  const order: readonly Seat[] = [story.revealFirst, second];

  const reveals = order.map((seat, index): ScheduledArenaEvent => {
    const side = story.sides[seat];
    return {
      atMs: REVEAL_FIRST_AT_MS + index * REVEAL_GAP_MS,
      event: {
        type: 'reveal',
        seat,
        // Le rig `a` est le joueur de cet appareil : lui seul recoit le flash.
        local: seat === 'a',
        score: side.score,
        quality: side.quality,
        ultimate: side.ultimate,
      },
    };
  });

  const counter: Seat | null = story.sides.a.counters ? 'a' : story.sides.b.counters ? 'b' : null;

  return [
    ...reveals,
    {
      atMs: CLASH_AT_MS,
      event: { type: 'clash', winner: story.winner, counter, ultimate: ultimateSeat(story) },
    },
    { atMs: VICTORY_AT_MS, event: { type: 'victory', seat: story.winner } },
  ];
}

/**
 * Le seul Ultime de la manche, s il n y en a qu un.
 *
 * Deux Ultimes ne designent personne : aucun des deux ne se detache, et un
 * choc qui pencherait vers l un mentirait sur ce qui s est passe.
 */
function ultimateSeat(story: RoundStory): Seat | null {
  const a = story.sides.a.ultimate;
  const b = story.sides.b.ultimate;
  if (a === b) return null;
  return a ? 'a' : 'b';
}
