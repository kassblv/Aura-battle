import type { MatchView } from '../match/view.js';
import type { AudioCue } from './cues.js';

/**
 * Du match aux faits sonores, pour les deux modes a la fois.
 *
 * La fonction prend une `MatchView` — la forme que solo et duel en ligne
 * produisent deja tous les deux — et non l etat brut de l un ou de l autre.
 * C est deliberé : l arene avait exactement ce defaut, un mode la pilotait et
 * l autre l avait oublie, et le duel en ligne se jouait sans adversaire a
 * l ecran. Deux implementations du meme concept divergent toujours par
 * l element que personne n a liste.
 *
 * Le son se declenche sur des CHANGEMENTS, pas sur un etat : la boucle
 * d animation repasse soixante fois par seconde sur la meme vue, et sonner la
 * vue courante rejouerait le meme fracas soixante fois. On compare donc deux
 * instantanes successifs et on ne rend que ce qui vient d arriver.
 *
 * Un bord vaut d etre nomme. La revelation ne se lit PAS sur la phase : en
 * ligne, le serveur annonce `reveal` dans un message et le resultat dans un
 * autre, donc au moins une image passe sans lui. C est l arrivee du RESULTAT
 * qui fait le bruit, jamais le changement de phase.
 */

export function cuesForTransition(before: MatchView, after: MatchView): readonly AudioCue[] {
  const cues: AudioCue[] = [];

  if (before.phase === 'recharge' && after.phase === 'choice') {
    cues.push({ type: 'rechargeEnd' });
  }

  const landed = after.lastRound;
  if (landed !== null && landed.round !== before.lastRound?.round) {
    /**
     * Le joueur local sonne en premier.
     *
     * Ce qui compte est qu il entende SA reussite detachee du reste, et elle se
     * detache mieux en tete. L ordre de l IMAGE, lui, est decide ailleurs : le
     * serveur porte un `timeline.revealFirst` pour ca.
     */
    cues.push({
      type: 'reveal',
      local: true,
      quality: landed.myQuality,
      ultimate: landed.myUltimate,
    });

    /**
     * L adversaire n a droit qu au souffle de revelation.
     *
     * Son timing est pourtant public une fois la manche revelee : ce n est pas
     * un secret qu on protege, c est le retour du joueur qu on ne veut pas
     * noyer. Sonner la reussite d en face lui volerait le seul son qui parle
     * de lui.
     */
    cues.push({ type: 'reveal', local: false, quality: 'miss', ultimate: false });

    cues.push({ type: 'clash', counter: landed.countered });
  }

  const ended = after.ended;
  if (ended !== null && before.ended === null) {
    cues.push({
      type: 'matchEnd',
      outcome: ended.winner === null ? 'draw' : ended.winner === 'moi' ? 'win' : 'loss',
    });
  }

  return cues;
}
