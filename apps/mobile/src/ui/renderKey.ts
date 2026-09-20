import type { MatchView } from '../match/view.js';

/**
 * Ce qui oblige l ecran de match a se redessiner — et, en creux, tout ce qui
 * ne l oblige pas.
 *
 * L ecran recoit une vue neuve a chaque image. La plupart de ses champs sont
 * pourtant immobiles pendant toute une phase : les paliers, les
 * amplificateurs, l energie, les manches gagnees, le nom de l adversaire. Seule
 * l horloge bouge, et l horloge est peinte par la boucle d animation
 * (`ui/frame.ts`), pas par React.
 *
 * Cette cle resume donc la vue a ce que React dessine vraiment. Deux vues de
 * meme cle produisent le meme arbre : on peut sauter le rendu sans rien perdre
 * a l ecran.
 *
 * **Ce qui n y est pas est un choix, pas un oubli :**
 *
 * - `phaseEndsAtMs` y est, lui, parce qu un message serveur peut le corriger en
 *   pleine phase (reprise apres coupure). La boucle lit la vue par une
 *   reference que seul un rendu rafraichit : une correction qui ne declencherait
 *   aucun rendu laisserait l aiguille et le compte a rebours sur l ancienne
 *   echeance.
 * - `taps` y figure par sa **longueur**, pour la meme raison : sans rendu,
 *   l orbe touchee resterait a l ecran.
 * - Les champs que seule l arene consomme (`myQuality`, `myUltimate`,
 *   `countered`) n y sont pas : l arene lit sa propre reference et ne passe pas
 *   par React.
 */

/**
 * Geometrie de la jauge tiree par le moteur, sous les noms plats de `view.ts`.
 *
 * `MatchView` ne publie pour l instant que `meterPeriodMs`, alors que le moteur
 * tire aussi un **centre** par manche (entre 0,30 et 0,70) et que le serveur
 * l envoie dans `choice:start`. Tant que ces trois champs manquent, la jauge se
 * rabat sur une zone centree — un dessin, pas la verite. Le jour ou `view.ts`
 * les porte, la jauge les prend sans qu une ligne change ailleurs.
 */
export interface MeterZonesView {
  readonly meterCenter: number;
  readonly meterZoneWidth: number;
  readonly meterPerfectWidth: number;
}

export type KeyedView = MatchView & Partial<MeterZonesView>;

/** Un champ absent et un champ nul doivent donner deux cles differentes. */
const tag = (value: number | boolean | string | null | undefined): string =>
  value === undefined ? '~' : value === null ? '-' : String(value);

export function renderKey(view: KeyedView): string {
  const last = view.lastRound;
  return [
    view.phase,
    view.round,
    view.phaseEndsAtMs,
    view.phaseDurationMs,
    tag(view.me.energy),
    view.me.roundsWon,
    view.opponent.roundsWon,
    view.opponentLocked,
    view.orbs.length,
    view.taps.length,
    view.meterPeriodMs,
    tag(view.meterCenter),
    tag(view.meterZoneWidth),
    tag(view.meterPerfectWidth),
    last === null
      ? '-'
      : [last.round, tag(last.winner), last.myScore, last.opponentScore].join(':'),
    view.ended === null ? '-' : tag(view.ended.winner),
  ].join('|');
}
