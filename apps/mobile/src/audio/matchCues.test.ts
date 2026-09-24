import { describe, expect, it } from 'vitest';
import type { MatchView, RoundView } from '../match/view.js';
import { soundForCue } from './cues.js';
import { cuesForTransition } from './matchCues.js';

function round(over: Partial<RoundView> = {}): RoundView {
  return {
    round: 1,
    winner: 'moi',
    myScore: 50,
    opponentScore: 40,
    myQuality: 'perfect',
    myUltimate: false,
    countered: false,
    myShiny: false,
    opponentShiny: false,
    ...over,
  };
}

function view(phase: MatchView['phase'], over: Partial<MatchView> = {}): MatchView {
  return {
    phase,
    round: 1,
    phaseEndsAtMs: 0,
    phaseDurationMs: 1,
    me: { energy: 8, ultimate: 0, roundsWon: 0, shiny: null },
    opponent: { energy: null, ultimate: null, roundsWon: 0, shiny: null },
    orbs: [],
    taps: [],
    meterPeriodMs: 0,
    opponentLocked: false,
    lastRound: null,
    ended: null,
    ...over,
  };
}

describe('cuesForTransition', () => {
  /**
   * Le piege que cette fonction existe pour eviter : la boucle d animation
   * repasse soixante fois par seconde sur la meme vue, et sonner la vue
   * rejouerait le meme fracas soixante fois.
   */
  it('ne sonne rien quand rien ne change', () => {
    const still = view('recharge');
    expect(cuesForTransition(still, still)).toEqual([]);
  });

  it('sonne la fin de recharge au passage au choix', () => {
    expect(cuesForTransition(view('recharge'), view('choice'))).toEqual([{ type: 'rechargeEnd' }]);
  });

  /**
   * En ligne, le serveur annonce `reveal` dans un message et le resultat dans
   * un autre : attacher le fracas au changement de phase le ferait sonner
   * avant que quoi que ce soit ne soit revele.
   */
  it('ne sonne pas la revelation tant que le resultat n est pas arrive', () => {
    expect(cuesForTransition(view('choice'), view('reveal'))).toEqual([]);
  });

  it('sonne les deux revelations puis le choc quand le resultat arrive', () => {
    const cues = cuesForTransition(view('reveal'), view('reveal', { lastRound: round() }));
    expect(cues.map((cue) => cue.type)).toEqual(['reveal', 'reveal', 'clash']);
    expect(cues[0]).toMatchObject({ local: true });
    expect(cues[1]).toMatchObject({ local: false });
  });

  it('sonne la qualite du timing du joueur local', () => {
    const cues = cuesForTransition(
      view('reveal'),
      view('reveal', { lastRound: round({ myQuality: 'perfect' }) }),
    );
    expect(soundForCue(cues[0]!)?.name).toBe('perfect');
  });

  it('sonne l Ultime du joueur local', () => {
    const cues = cuesForTransition(
      view('reveal'),
      view('reveal', { lastRound: round({ myUltimate: true }) }),
    );
    expect(soundForCue(cues[0]!)?.name).toBe('ultimate');
  });

  /**
   * Question de gout, pas de secret : a la revelation, le timing des deux
   * joueurs est public. Mais sonner la reussite d en face volerait au joueur
   * le seul retour qui parle de LUI.
   */
  it('ne sonne jamais la reussite adverse', () => {
    for (const quality of ['perfect', 'good', 'miss'] as const) {
      const cues = cuesForTransition(
        view('reveal'),
        view('reveal', { lastRound: round({ myQuality: quality }) }),
      );
      expect(soundForCue(cues[1]!)?.name).toBe('reveal');
    }
  });

  it('annonce un contre quand il y en a un', () => {
    const cues = cuesForTransition(
      view('reveal'),
      view('reveal', { lastRound: round({ countered: true }) }),
    );
    expect(cues).toContainEqual({ type: 'clash', counter: true });
  });

  it('ne rejoue pas une manche deja sonnee', () => {
    const played = view('reveal', { lastRound: round() });
    expect(cuesForTransition(played, played)).toEqual([]);
  });

  it('sonne la manche suivante, elle', () => {
    const first = view('reveal', { lastRound: round() });
    const second = view('reveal', { round: 2, lastRound: round({ round: 2 }) });
    expect(cuesForTransition(first, second).map((cue) => cue.type)).toEqual([
      'reveal',
      'reveal',
      'clash',
    ]);
  });

  it('sonne la victoire au vainqueur et la defaite au perdant', () => {
    const won = cuesForTransition(
      view('reveal'),
      view('ended', { ended: { winner: 'moi', spoils: null } }),
    );
    expect(won).toContainEqual({ type: 'matchEnd', outcome: 'win' });

    const lost = cuesForTransition(
      view('reveal'),
      view('ended', { ended: { winner: 'adversaire', spoils: null } }),
    );
    expect(lost).toContainEqual({ type: 'matchEnd', outcome: 'loss' });
  });

  it('reconnait un match nul', () => {
    const cues = cuesForTransition(
      view('reveal'),
      view('ended', { ended: { winner: null, spoils: null } }),
    );
    expect(cues).toContainEqual({ type: 'matchEnd', outcome: 'draw' });
  });

  it('ne sonne la fin qu une fois', () => {
    const ended = view('ended', { ended: { winner: 'moi', spoils: null } });
    expect(cuesForTransition(ended, ended)).toEqual([]);
  });
});
