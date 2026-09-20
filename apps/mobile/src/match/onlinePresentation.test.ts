import type { ServerMessage } from '@aura/protocol';
import { describe, expect, it } from 'vitest';
import { defaultLook } from '../app/wardrobe.js';
import type { OnlinePhase, OnlineState } from './online.js';
import { presentOnline } from './onlinePresentation.js';

const looks = { a: defaultLook(), b: { ...defaultLook(), outfit: 'outfit.rouge' } };

function side(
  style: 'calme' | 'hype' | 'provoc',
  tier: 0 | 1 | 2 | 3 | 4,
  animationId: string,
): ServerMessage<'round:result'>['sides']['a'] {
  return {
    move: { style, tier },
    amp: 0,
    ult: false,
    cosmetic: { animationId, effectId: 'effect.none' },
    recharge: { points: 0, bestCombo: 0, boostPct: 0, ultGain: 0, energyGain: 0 },
    timing: { quality: 'good', error: 0.1 },
    repeat: false,
    counter: false,
    countered: false,
    counterBlocked: false,
    base: 50,
    final: 50,
    energyAfter: 4,
    ultAfter: 0,
  };
}

const ROUND: ServerMessage<'round:result'> = {
  matchId: 'm_1',
  round: 1,
  sides: {
    a: side('hype', 4, 'anim.hype.t4.boat'),
    b: side('calme', 3, 'anim.calme.t3.meditate'),
  },
  winner: 'a',
  roundsWon: { a: 1, b: 0 },
  timeline: { revealFirst: 'a' },
};

function state(phase: OnlinePhase, over: Partial<OnlineState> = {}): OnlineState {
  return {
    matchId: 'm_1',
    seat: 'a',
    opponentName: 'Nova',
    opponentIsGhost: false,
    phase,
    round: 1,
    phaseEndsAtMs: 0,
    roundsWon: { a: 0, b: 0 },
    energy: 8,
    ultimate: 0,
    opponentLocked: false,
    orbs: [],
    sentTaps: [],
    meter: null,
    lastRound: null,
    result: null,
    ...over,
  };
}

describe('presentOnline', () => {
  it('met les deux combattants en garde pendant la recharge', () => {
    const scene = presentOnline(state('recharge'), looks);
    expect(scene.fighters.a.animationId).toBe('anim.system.none.charge');
    expect(scene.fighters.b.animationId).toBe('anim.system.none.charge');
  });

  /**
   * Regle d or n°4, cote mise en scene en ligne.
   *
   * Le serveur ne livre `round:result` qu a la revelation, mais le client garde
   * le resultat de la manche PRECEDENTE dans `lastRound`. Le rejouer pendant la
   * recharge suivante rendrait le mouvement de l adversaire lisible une manche
   * en avance — une fuite que le reseau n a pas commise et que l ecran
   * commettrait tout seul.
   */
  it('ne rejoue pas la manche precedente pendant la manche suivante', () => {
    const scene = presentOnline(state('recharge', { lastRound: ROUND, round: 2 }), looks);
    expect(scene.fighters.a.animationId).toBe('anim.system.none.charge');
    expect(scene.fighters.b.animationId).toBe('anim.system.none.charge');
  });

  it('garde le choix secret des deux cotes pendant la phase de choix', () => {
    const scene = presentOnline(state('choice', { opponentLocked: true }), looks);
    expect(scene.fighters.a.animationId).toBe('anim.system.none.charge');
    expect(scene.fighters.b.animationId).toBe('anim.system.none.charge');
  });

  it('joue les deux mouvements a la revelation', () => {
    const scene = presentOnline(state('reveal', { lastRound: ROUND }), looks);
    expect(scene.fighters.a.animationId).toBe('anim.hype.t4.boat');
    expect(scene.fighters.b.animationId).toBe('anim.calme.t3.meditate');
  });

  /**
   * Le cosmetique adverse arrive avec `round:result` : l honorer est legitime,
   * et c est la seule facon de voir la danse que l adversaire a payee.
   */
  it('honore le cosmetique annonce pour chaque siege', () => {
    const custom: ServerMessage<'round:result'> = {
      ...ROUND,
      sides: {
        a: side('hype', 4, 'anim.hype.t4.boat'),
        b: side('calme', 3, 'anim.calme.t3.moonwalk'),
      },
    };
    const scene = presentOnline(state('reveal', { lastRound: custom }), looks);
    expect(scene.fighters.b.animationId).toBe('anim.calme.t3.moonwalk');
  });

  it('joue la joie et l encaissement quand la mise en scene le demande', () => {
    const scene = presentOnline(state('reveal', { lastRound: ROUND }), looks, {
      showOutcome: true,
    });
    expect(scene.fighters.a.animationId).toBe('anim.system.none.victory');
    expect(scene.fighters.b.animationId).toBe('anim.system.none.stagger');
  });

  it('laisse les deux debout quand la manche est nulle', () => {
    const draw: ServerMessage<'round:result'> = { ...ROUND, winner: null };
    const scene = presentOnline(state('reveal', { lastRound: draw }), looks, {
      showOutcome: true,
    });
    expect(scene.fighters.a.animationId).toBe('anim.hype.t4.boat');
    expect(scene.fighters.b.animationId).toBe('anim.calme.t3.meditate');
  });

  /**
   * La phase passe a `reveal` des que le serveur l annonce ; `round:result`
   * arrive dans un message distinct, donc une image au moins s affiche sans
   * lui. Elle doit montrer la garde, pas planter.
   */
  it('tient la garde si la revelation arrive avant son resultat', () => {
    const scene = presentOnline(state('reveal'), looks);
    expect(scene.fighters.a.animationId).toBe('anim.system.none.charge');
    expect(scene.fighters.b.animationId).toBe('anim.system.none.charge');
  });

  /**
   * Le joueur local occupe toujours le rig de gauche, quel que soit son siege.
   *
   * L ecran l a deja decide ailleurs : le bandeau dit « Toi » a gauche, et
   * `looks.a` porte la tenue du vestiaire. Mapper les animations sur le siege
   * SERVEUR laissait donc la moitie des joueurs — ceux que le serveur assoit
   * en B — regarder leur propre tenue danser le mouvement de l adversaire.
   */
  it('joue le mouvement du joueur local sur le rig de gauche, meme assis en B', () => {
    const scene = presentOnline(state('reveal', { seat: 'b', lastRound: ROUND }), looks);
    expect(scene.fighters.a.animationId).toBe('anim.calme.t3.meditate');
    expect(scene.fighters.b.animationId).toBe('anim.hype.t4.boat');
  });

  it('donne la victoire au bon rig quand le joueur local est assis en B', () => {
    const scene = presentOnline(state('reveal', { seat: 'b', lastRound: ROUND }), looks, {
      showOutcome: true,
    });
    // ROUND est gagne par le siege A, c est-a-dire l adversaire de ce joueur.
    expect(scene.fighters.a.animationId).toBe('anim.system.none.stagger');
    expect(scene.fighters.b.animationId).toBe('anim.system.none.victory');
  });

  it('habille chaque siege de son apparence', () => {
    const scene = presentOnline(state('recharge'), looks);
    expect(scene.fighters.a.look.outfit).toBe(looks.a.outfit);
    expect(scene.fighters.b.look.outfit).toBe('outfit.rouge');
  });

  it('fait monter la foule avec l enjeu', () => {
    const calm = presentOnline(state('intro'), looks).hype;
    const charging = presentOnline(state('recharge'), looks).hype;
    const revealing = presentOnline(state('reveal', { lastRound: ROUND }), looks).hype;
    expect(calm).toBeLessThan(charging);
    expect(charging).toBeLessThan(revealing);
  });

  it('reste affichable hors match', () => {
    const scene = presentOnline(state('idle', { seat: null, matchId: null }), looks);
    expect(scene.fighters.a.animationId).toBe('anim.system.none.charge');
    expect(scene.hype).toBeGreaterThanOrEqual(0);
  });
});
