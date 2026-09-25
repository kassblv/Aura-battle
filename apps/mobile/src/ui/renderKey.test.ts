import { describe, expect, it } from 'vitest';
import type { MatchView } from '../match/view.js';
import { renderKey, type KeyedView } from './renderKey.js';

const base: MatchView = {
  phase: 'choice',
  round: 1,
  phaseEndsAtMs: 15_000,
  phaseDurationMs: 15_000,
  me: { energy: 8, ultimate: 0, roundsWon: 0, shiny: null },
  opponent: { energy: null, ultimate: null, roundsWon: 0, shiny: null },
  orbs: [],
  taps: [],
  meterPeriodMs: 1_700,
  opponentLocked: false,
  lastRound: null,
  ended: null,
};

const key = (patch: Partial<KeyedView> = {}): string => renderKey({ ...base, ...patch });

describe('renderKey', () => {
  it('change quand ma case brillante arrive', () => {
    expect(key({ me: { ...base.me, shiny: { style: 'hype', tier: 2 } } })).not.toBe(key());
  });

  /**
   * Le coeur de la separation des rythmes : l heure avance sans que l arbre
   * change. Si cette assertion tombe, l ecran de match redessine trente
   * boutons pour deplacer une aiguille — c est exactement le defaut corrige.
   */
  it('ne change pas quand seule l heure avance', () => {
    expect(key()).toBe(key());
  });

  it('change a chaque phase, chaque manche et chaque fin de phase', () => {
    expect(key({ phase: 'recharge' })).not.toBe(key());
    expect(key({ round: 2 })).not.toBe(key());
    expect(key({ phaseEndsAtMs: 15_400 })).not.toBe(key());
    expect(key({ phaseDurationMs: 6_000 })).not.toBe(key());
  });

  it('change quand l ecran a quelque chose de neuf a afficher', () => {
    expect(key({ me: { energy: 7, ultimate: 0, roundsWon: 0, shiny: null } })).not.toBe(key());
    expect(key({ me: { energy: 8, ultimate: 0, roundsWon: 1, shiny: null } })).not.toBe(key());
    expect(key({ opponent: { energy: null, ultimate: null, roundsWon: 1, shiny: null } })).not.toBe(
      key(),
    );
    expect(key({ opponentLocked: true })).not.toBe(key());
    expect(key({ meterPeriodMs: 1_500 })).not.toBe(key());
  });

  /**
   * L energie de l adversaire est `null` par construction (`view.ts`), celle
   * du joueur peut valoir zero. Les deux doivent se distinguer : une cle qui
   * les confondrait laisserait un joueur a court d energie devant des paliers
   * encore affiches comme payables.
   */
  /**
   * L Ultime commande un bouton : s il n entre pas dans la cle, la
   * memoisation fige l ecran et le joueur voit son Ultime rester inerte alors
   * qu il vient de se remplir.
   */
  it('redessine quand la jauge d Ultime bouge', () => {
    expect(key({ me: { energy: 8, ultimate: 60, roundsWon: 0, shiny: null } })).not.toBe(
      key({ me: { energy: 8, ultimate: 100, roundsWon: 0, shiny: null } }),
    );
  });

  it('distingue une energie nulle d une energie absente', () => {
    expect(key({ me: { energy: 0, ultimate: 0, roundsWon: 0, shiny: null } })).not.toBe(
      key({ me: { energy: null, ultimate: 0, roundsWon: 0, shiny: null } }),
    );
  });

  /**
   * Sans rendu, la boucle continuerait de peindre l orbe deja touchee : elle
   * lit la vue par une reference que seul un rendu rafraichit.
   */
  it('change quand un tap part', () => {
    expect(key({ taps: [{ atMs: 200, orbIndex: 0 }] })).not.toBe(key());
  });

  it('change quand la sequence d orbes arrive', () => {
    const orbs = [
      { index: 0, x: 0.2, y: 0.4, kind: 'normal' as const, points: 1, lifetimeMs: 1600 },
    ];
    expect(key({ orbs })).not.toBe(key());
  });

  it('change a chaque verdict de manche, y compris a score identique', () => {
    const won = {
      round: 1,
      winner: 'moi' as const,
      myScore: 12,
      opponentScore: 9,
      myQuality: 'perfect' as const,
      myUltimate: false,
      countered: false,
      myShiny: false,
      opponentShiny: false,
      myMove: { style: 'calme' as const, tier: 2 as const },
      opponentMove: { style: 'hype' as const, tier: 2 as const },
      myPoseId: null,
    opponentPoseId: null,
      counteredBy: null,
      counterBlocked: false,
      revealFirst: 'adversaire' as const,
      opponentQuality: 'good' as const,
      opponentUltimate: false,
    };
    expect(key({ lastRound: won })).not.toBe(key());
    expect(key({ lastRound: { ...won, round: 2 } })).not.toBe(key({ lastRound: won }));
    expect(key({ lastRound: { ...won, winner: null } })).not.toBe(key({ lastRound: won }));
  });

  /**
   * Ces trois champs ne sont lus que par l arene, qui a sa propre boucle et ne
   * passe pas par React. Les mettre dans la cle ferait redessiner l ecran pour
   * une information qu il n affiche pas.
   */
  it('ignore ce que seule l arene consomme', () => {
    const one = {
      round: 1,
      winner: 'moi' as const,
      myScore: 12,
      opponentScore: 9,
      myQuality: 'perfect' as const,
      myUltimate: false,
      countered: false,
      myShiny: false,
      opponentShiny: false,
      myMove: { style: 'calme' as const, tier: 2 as const },
      opponentMove: { style: 'hype' as const, tier: 2 as const },
      myPoseId: null,
    opponentPoseId: null,
      counteredBy: null,
      counterBlocked: false,
      revealFirst: 'adversaire' as const,
      opponentQuality: 'good' as const,
      opponentUltimate: false,
    };
    expect(
      key({ lastRound: { ...one, myQuality: 'miss', myUltimate: true, countered: true } }),
    ).toBe(key({ lastRound: one }));
  });

  it('change quand le match se termine, et selon son vainqueur', () => {
    expect(key({ ended: { winner: 'moi', spoils: null } })).not.toBe(key());
    expect(key({ ended: { winner: null, spoils: null } })).not.toBe(
      key({ ended: { winner: 'moi', spoils: null } }),
    );
  });

  /**
   * La geometrie de la jauge arrive avec `choice:start`. Tant qu elle manque,
   * la jauge se rabat sur une zone centree ; son arrivee doit donc repeindre
   * les bandes, sans quoi le joueur viserait la zone du repli.
   */
  it('change quand la geometrie de la jauge arrive', () => {
    expect(key({ meterCenter: 0.42 })).not.toBe(key());
    expect(key({ meterZoneWidth: 0.22 })).not.toBe(key());
    expect(key({ meterPerfectWidth: 0.08 })).not.toBe(key());
  });
});
