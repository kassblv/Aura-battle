import { describe, expect, it } from 'vitest';
import { defaultLook } from '../app/wardrobe.js';
import { animationFor } from '../content/animations.js';
import { animationIdsFor } from '@aura/content';
import { present } from './presentation.js';
import { createSoloMatch, type SoloMatch } from './solo.js';

const looks = { a: defaultLook(), b: { ...defaultLook(), outfit: 'outfit.rouge' } };
const solo = (seed = 'scene'): SoloMatch =>
  createSoloMatch({ seed, opponent: 'calm', startedAtMs: 0 });

function runTo(match: SoloMatch, phase: string, limit = 40): void {
  for (let i = 0; i < limit && match.state.phase !== phase; i++) {
    match.advanceTo(match.state.phaseEndsAtMs);
  }
}

describe('present', () => {
  it('met les deux combattants en garde pendant la recharge', () => {
    const match = solo();
    runTo(match, 'recharge');
    const scene = present(match.state, looks);
    expect(scene.fighters.a.animationId).toBe('anim.system.none.charge');
    expect(scene.fighters.b.animationId).toBe('anim.system.none.charge');
  });

  /**
   * Regle d or n°4, cote mise en scene.
   *
   * Le moteur ne divulgue rien, mais c est ici que la fuite se produirait : il
   * suffirait de lire `pending` pour « preparer » l animation adverse, et
   * l adversaire jouerait son mouvement une fraction de seconde trop tot. Un
   * joueur attentif y lirait le choix avant la revelation.
   */
  it('ne montre pas le mouvement adverse avant la revelation', () => {
    const match = solo('fuite');
    runTo(match, 'choice');
    // L adversaire a deja verrouille a ce stade : c est precisement le moment
    // ou la fuite serait possible.
    expect(match.state.pending.b.locked).not.toBeNull();
    expect(present(match.state, looks).fighters.b.animationId).toBe('anim.system.none.charge');
  });

  /**
   * Personne n est montre tant que la phase est « choix » — pas meme soi.
   *
   * L adversaire a deja verrouille ici, le joueur non : c est l etat ou une
   * lecture de `pending` trahirait un siege et pas l autre.
   */
  it('garde les deux en garde tant que la phase de choix dure', () => {
    const match = solo('fuite');
    runTo(match, 'choice');
    expect(match.state.pending.a.locked).toBeNull();
    const scene = present(match.state, looks);
    expect(scene.fighters.a.animationId).toBe('anim.system.none.charge');
    expect(scene.fighters.b.animationId).toBe('anim.system.none.charge');
  });

  /**
   * Quand les deux sieges ont verrouille, le moteur resout la manche sans
   * attendre l echeance — verrouiller en dernier declenche donc la revelation.
   * La mise en scene suit la phase, jamais l intention.
   */
  it('revele des que le second verrouillage resout la manche', () => {
    const match = solo('fuite');
    runTo(match, 'choice');
    match.lock({ move: { style: 'hype', tier: 4 }, amplifier: 0, useUltimate: false }, 400, 10);
    expect(match.state.phase).toBe('reveal');
    expect(present(match.state, looks).fighters.a.animationId).toBe('anim.hype.t4.boat');
  });

  it('joue les deux mouvements a la revelation', () => {
    const match = solo('reveal');
    runTo(match, 'reveal');
    const scene = present(match.state, looks);
    const played = match.state.seats.a.moves.at(-1);
    if (played === undefined) throw new Error('aucun mouvement joue');
    expect(scene.fighters.a.animationId).toContain(`.${played.style}.t${played.tier}.`);
    expect(scene.fighters.b.animationId).not.toBe('anim.system.none.charge');
  });

  it('montre la joie et l encaissement une fois la manche gagnee', () => {
    const match = solo('verdict');
    runTo(match, 'reveal');
    const winner = match.state.history.at(-1)?.winner;
    if (winner === null || winner === undefined) return; // manche nulle : rien a affirmer
    const scene = present(match.state, looks, { showOutcome: true });
    const loser = winner === 'a' ? 'b' : 'a';
    expect(scene.fighters[winner].animationId).toBe('anim.system.none.victory');
    expect(scene.fighters[loser].animationId).toBe('anim.system.none.stagger');
  });

  it('habille chaque siege de son apparence', () => {
    const scene = present(solo().state, looks);
    expect(scene.fighters.a.look.outfit).toBe(looks.a.outfit);
    expect(scene.fighters.b.look.outfit).toBe('outfit.rouge');
  });
});

/**
 * L effet d aura, hors ligne.
 *
 * En ligne c est le serveur qui le resout et l envoie avec le resultat. En
 * solo il n y a personne : le client le calcule a partir du palier joue — que
 * le moteur retient depuis peu — et de ce que le joueur possede.
 *
 * Meme garde que l animation, pour la meme raison : l amplificateur s affiche
 * sous le nom de son effet, donc montrer l effet avant la revelation dirait le
 * choix secret de l adversaire.
 */
describe('effet d aura hors ligne', () => {
  it('ne montre rien avant la revelation', () => {
    const match = solo('fuite');
    runTo(match, 'choice');
    const scene = present(match.state, looks);
    expect(scene.fighters.a.auraEffectId).toBeUndefined();
    expect(scene.fighters.b.auraEffectId).toBeUndefined();
  });

  it('montre l effet offert du palier joue', () => {
    const match = solo('fuite');
    runTo(match, 'choice');
    match.lock({ move: { style: 'hype', tier: 4 }, amplifier: 2, useUltimate: false }, 400, 10);
    expect(present(match.state, looks).fighters.a.auraEffectId).toBe('fx.lightning');
  });

  /*
    Le skin achete habille UN palier. C est la meme regle qu en ligne, et elle
    doit l etre : un joueur qui achete les Flammes en solo puis les retrouve
    ailleurs ne doit pas avoir a reapprendre ce qu il a paye.
  */
  it('montre le skin possede, au palier qu il habille', () => {
    const match = solo('fuite');
    runTo(match, 'choice');
    match.lock({ move: { style: 'hype', tier: 4 }, amplifier: 2, useUltimate: false }, 400, 10);
    const scene = present(match.state, looks, { ownedEffects: { a: ['fx.shock'] } });
    expect(scene.fighters.a.auraEffectId).toBe('fx.shock');
  });

  it('ne fait pas deborder le skin sur un autre palier', () => {
    const match = solo('fuite');
    runTo(match, 'choice');
    match.lock({ move: { style: 'hype', tier: 4 }, amplifier: 4, useUltimate: false }, 400, 10);
    const scene = present(match.state, looks, { ownedEffects: { a: ['fx.shock'] } });
    expect(scene.fighters.a.auraEffectId).toBe('fx.galaxy');
  });

  /*
    L IA ne possede rien : elle porte l effet offert de son palier. Lui preter
    l inventaire du joueur donnerait au joueur l impression que son achat est
    distribue a tout le monde.
  */
  it('ne prete pas l inventaire du joueur a l adversaire', () => {
    const match = solo('fuite');
    runTo(match, 'choice');
    match.lock({ move: { style: 'hype', tier: 4 }, amplifier: 2, useUltimate: false }, 400, 10);
    const scene = present(match.state, looks, { ownedEffects: { a: ['fx.shock'] } });
    expect(scene.fighters.b.auraEffectId).not.toBe('fx.shock');
  });
});

describe('ferveur du public', () => {
  it('reste calme avant le debut', () => {
    expect(present(solo().state, looks).hype).toBeLessThan(0.3);
  });

  it('monte a la recharge et explose a la revelation', () => {
    const match = solo('ferveur');
    runTo(match, 'recharge');
    const recharge = present(match.state, looks).hype;
    runTo(match, 'reveal');
    const reveal = present(match.state, looks).hype;
    expect(recharge).toBeGreaterThan(0.3);
    expect(reveal).toBeGreaterThan(recharge);
  });

  it('reste bornee entre zero et un', () => {
    const match = solo('bornes');
    for (let i = 0; i < 60 && match.state.phase !== 'ended'; i++) {
      const hype = present(match.state, looks).hype;
      expect(hype).toBeGreaterThanOrEqual(0);
      expect(hype).toBeLessThanOrEqual(1);
      match.advanceTo(match.state.phaseEndsAtMs);
    }
  });
});

describe('danse equipee', () => {
  /**
   * Ce qu on achete doit se voir.
   *
   * `present` recoit deja un skin par siege ; ce test verrouille le bout de
   * chaine que personne ne parcourait : une danse equipee pour le mouvement
   * joue remplace bien l animation offerte.
   */
  it('joue la danse equipee du mouvement revele', () => {
    const match = solo('skin');
    runTo(match, 'reveal');
    const move = match.state.seats.a.moves.at(-1);
    expect(move).toBeDefined();
    const alternative = animationIdsFor(move!).find((id) => id !== animationFor(move!).id);
    if (alternative === undefined) return; // ce mouvement n a qu une animation
    const scene = present(match.state, looks, { skins: { a: alternative } });
    expect(scene.fighters.a.animationId).toBe(alternative);
  });

  /**
   * Un skin qui appartient a un AUTRE mouvement est ignore.
   *
   * Sans ce garde-fou, une danse equipee pour un calme palier 3 s afficherait
   * sur un hype palier 0 : l adversaire lirait un mouvement qui n a pas ete
   * joue, et donc une depense d energie qui n a pas eu lieu.
   */
  it('ignore une danse qui appartient a un autre mouvement', () => {
    const match = solo('skin');
    runTo(match, 'reveal');
    const move = match.state.seats.a.moves.at(-1)!;
    const etranger = move.style === 'calme' ? 'anim.hype.t4.boat' : 'anim.calme.t4.backflip';
    const scene = present(match.state, looks, { skins: { a: etranger } });
    expect(scene.fighters.a.animationId).toBe(animationFor(move).id);
  });
});
