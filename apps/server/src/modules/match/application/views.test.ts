import { BALANCE, createMatch, reduce, type MatchState, type Seat } from '@aura/rules';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { choiceStartFor, matchStateFor, roundIntroFor } from './views.js';

const MATCH_ID = 'm_01';
const START_AT = 1_700_000_000_000;

/** Amene un match jusqu'a une phase donnee. */
function advanceTo(phase: MatchState['phase'], seed = 'graine'): MatchState {
  let step = createMatch(seed, { startedAtMs: START_AT });
  while (step.state.phase !== phase && step.state.phase !== 'ended') {
    step = reduce(step.state, { type: 'PHASE_TIMEOUT', atMs: step.state.phaseEndsAtMs });
  }
  return step.state;
}

/** Donne aux deux sieges des valeurs volontairement differentes. */
function withDistinctSeats(state: MatchState): MatchState {
  return {
    ...state,
    seats: {
      a: { ...state.seats.a, energy: 11, ultimateGauge: 30, roundsWon: 1, totalScore: 61 },
      b: { ...state.seats.b, energy: 7, ultimateGauge: 95, roundsWon: 0, totalScore: 38 },
    },
  };
}

describe('roundIntroFor — chacun ne voit que son energie et sa jauge', () => {
  const state = withDistinctSeats(advanceTo('intro'));

  it('donne au siege a ses propres valeurs', () => {
    const view = roundIntroFor('a', state, MATCH_ID);
    expect(view.energy).toBe(11);
    expect(view.ult).toBe(30);
  });

  it('donne au siege b ses propres valeurs', () => {
    const view = roundIntroFor('b', state, MATCH_ID);
    expect(view.energy).toBe(7);
    expect(view.ult).toBe(95);
  });

  it('rend le score de manches, qui est public', () => {
    expect(roundIntroFor('a', state, MATCH_ID).roundsWon).toEqual({ a: 1, b: 0 });
  });

  it('exprime l echeance en heure serveur', () => {
    expect(roundIntroFor('a', state, MATCH_ID).endsAt).toBe(state.phaseEndsAtMs);
  });
});

describe('choiceStartFor — la jauge est commune, l energie ne l est pas', () => {
  const state = withDistinctSeats(advanceTo('choice'));

  it('envoie a chacun sa propre energie', () => {
    expect(choiceStartFor('a', state, MATCH_ID).energy).toBe(11);
    expect(choiceStartFor('b', state, MATCH_ID).energy).toBe(7);
  });

  /*
    La carte brillante est un secret de siege : chacun recoit la sienne, et
    rien dans le message de l'un ne permet de deduire celle de l'autre
    (regle d'or n°4). On cherche une graine ou les deux cases different.
  */
  it('envoie a chacun SA case brillante, jamais celle de l autre', () => {
    let seed = 0;
    let found = advanceTo('choice', 'brillante-0');
    const differ = (st: MatchState): boolean => {
      const shiny = st.roundContext!.shiny;
      return shiny.a.style !== shiny.b.style || shiny.a.tier !== shiny.b.tier;
    };
    while (!differ(found)) {
      seed += 1;
      found = advanceTo('choice', `brillante-${String(seed)}`);
    }
    const forA = choiceStartFor('a', found, MATCH_ID);
    const forB = choiceStartFor('b', found, MATCH_ID);
    expect(forA.shiny).toEqual(found.roundContext!.shiny.a);
    expect(forB.shiny).toEqual(found.roundContext!.shiny.b);
    expect(JSON.stringify(forA)).not.toContain(JSON.stringify(found.roundContext!.shiny.b));
  });

  it('envoie aux deux la meme jauge de timing', () => {
    // La jauge est tiree une fois par manche : les deux joueurs affrontent
    // exactement la meme, sinon la manche n'est pas equitable.
    expect(choiceStartFor('a', state, MATCH_ID).meter).toEqual(
      choiceStartFor('b', state, MATCH_ID).meter,
    );
  });
});

describe('matchStateFor — reprise apres reconnexion', () => {
  const state = withDistinctSeats(advanceTo('choice'));

  it('dit seulement si l adversaire a verrouille', () => {
    const view = matchStateFor('a', state, MATCH_ID);
    expect(typeof view.opponentLocked).toBe('boolean');
  });

  it('ne contient pas le choix de l adversaire', () => {
    const view = matchStateFor('a', state, MATCH_ID) as Record<string, unknown>;
    expect(view.opponentChoice).toBeUndefined();
    expect(view.opponentEnergy).toBeUndefined();
  });

  it('ne revele que les manches deja revelees', () => {
    const view = matchStateFor('a', state, MATCH_ID);
    expect(view.history).toHaveLength(state.history.length);
  });

  // Une reprise en pleine phase de choix rend SA case, et jamais celle de l'autre.
  it('rend au siege sa case brillante, et seulement la sienne', () => {
    const shiny = state.roundContext!.shiny;
    expect(matchStateFor('a', state, MATCH_ID).shiny).toEqual(shiny.a);
    expect(matchStateFor('b', state, MATCH_ID).shiny).toEqual(shiny.b);
    if (shiny.a.style !== shiny.b.style || shiny.a.tier !== shiny.b.tier) {
      expect(JSON.stringify(matchStateFor('a', state, MATCH_ID))).not.toContain(
        JSON.stringify(shiny.b),
      );
    }
  });

  it('ne rend aucune case hors de la phase de choix', () => {
    expect(matchStateFor('a', advanceTo('recharge'), MATCH_ID).shiny).toBeUndefined();
  });
});

describe('aucune fuite d information (regle d or n°4)', () => {
  /**
   * Le test que la relecture de securite du jalon M2 avait demande, sous sa
   * forme exacte : **changer les donnees privees d'un siege ne doit rien
   * changer a la vue de l'autre**.
   *
   * C'est la definition meme de l'absence de fuite, et elle est plus forte que
   * de chercher une valeur dans la sortie : une valeur peut apparaitre par
   * coincidence (zero est partout), alors qu'une difference de vue prouve
   * qu'une information a traverse.
   */
  const noLeak = (
    build: (seat: Seat, state: MatchState, matchId: string) => unknown,
    phase: MatchState['phase'],
  ): void => {
    const base = advanceTo(phase);
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: BALANCE.match.startingEnergy }),
        fc.integer({ min: 0, max: BALANCE.ultimate.gaugeMax }),
        fc.integer({ min: 0, max: BALANCE.match.startingEnergy }),
        fc.integer({ min: 0, max: BALANCE.ultimate.gaugeMax }),
        (energyB1, gaugeB1, energyB2, gaugeB2) => {
          const withB = (energy: number, ultimateGauge: number): MatchState => ({
            ...base,
            seats: {
              a: { ...base.seats.a, energy: 9, ultimateGauge: 42 },
              b: { ...base.seats.b, energy, ultimateGauge },
            },
          });

          expect(build('a', withB(energyB1, gaugeB1), MATCH_ID)).toEqual(
            build('a', withB(energyB2, gaugeB2), MATCH_ID),
          );
        },
      ),
    );
  };

  it('round:intro ne bouge pas quand l energie adverse change', () => {
    noLeak(roundIntroFor, 'intro');
  });

  it('choice:start ne bouge pas quand la jauge adverse change', () => {
    noLeak(choiceStartFor, 'choice');
  });

  it('match:state ne bouge pas quand le siege adverse change', () => {
    noLeak(matchStateFor, 'choice');
  });

  it('mais la vue depend bien du siege destinataire', () => {
    // Contre-epreuve : si les deux vues etaient identiques, le test ci-dessus
    // passerait pour une mauvaise raison.
    const state = withDistinctSeats(advanceTo('choice'));
    expect(choiceStartFor('a', state, MATCH_ID)).not.toEqual(choiceStartFor('b', state, MATCH_ID));
  });
});
