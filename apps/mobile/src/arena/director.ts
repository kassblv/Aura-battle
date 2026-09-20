import type { Seat } from '@aura/rules';
import { impactBurst, knockbackDistance, revealBurst } from './burst.js';
import {
  createClash,
  type Clash,
  type ClashColors,
  type ClashEnds,
  type ClashSpec,
} from './clash.js';
import {
  applyImpulse,
  decayImpulse,
  impulseFor,
  type ArenaEvent,
  type ArenaFocusRequest,
} from './events.js';
import { createFxPool, type FxPool, type Vec3 } from './fx.js';
import { damp } from './math.js';
import type { ParticleSink } from './particles.js';
import { roundChoreography, type RoundStory, type ScheduledArenaEvent } from './round.js';

/**
 * Le realisateur de l arene.
 *
 * Il ne decide de rien du match : il recoit une manche deja tranchee, la
 * deroule dans le temps (`round.ts`), et pour chaque evenement joue ce que
 * `events.ts` prescrit — secousse, voile, ferveur, cadrage — plus ce que
 * `burst.ts` fait naitre.
 *
 * Aucun noeud Three.js ici : tout se decide en nombres et se pose dans un
 * `ParticleSink`. C est ce qui rend la mise en scene testable image par image,
 * sans navigateur. Le montage des noeuds vit dans `scene.ts` et `useArena.ts`.
 */

export interface ArenaDirectorOptions {
  /** Injecte pour que les gerbes d etincelles soient reproductibles. */
  readonly rng?: () => number;
  readonly reducedMotion?: boolean;
}

export interface DirectorFrame {
  /** Duree de l image, en millisecondes, en temps reel. */
  readonly deltaMs: number;
  /**
   * Poitrine de chaque combattant, en metres.
   *
   * C est de la que partent les faisceaux, et c est entre ces deux points que
   * se place le contact.
   */
  readonly ends: ClashEnds;
  /** Couleur d aura de chacun. Un cosmetique, jamais une information de jeu. */
  readonly colors: ClashColors;
}

export interface ArenaDirector {
  readonly shake: number;
  readonly flash: number;
  readonly hype: number;
  /** Ralenti applique a l animation des combattants. 1 = vitesse normale. */
  readonly timeScale: number;
  /** Cadrage demande, ou `null` si la camera reprend son plan large. */
  readonly focus: ArenaFocusRequest | null;
  readonly clashing: boolean;
  /** Effets vivants : sert au budget et aux tests. */
  readonly fxCount: number;
  /** Manche en cours de mise en scene, ou `null`. */
  readonly round: number | null;
  /** Recul du combattant, en metres, a ajouter a sa position de repos. */
  knockback(seat: Seat): number;
  /** Met en scene une manche. Rejouer la meme ne fait rien. */
  play(story: RoundStory): void;
  /** Coupe tout : changement d ecran, fin de match, demontage. */
  cancel(): void;
  setReducedMotion(reduced: boolean): void;
  update(frame: DirectorFrame): void;
  /** Pose les faisceaux et les effets. `elapsedMs` ne sert qu au tremblement. */
  draw(sink: ParticleSink, elapsedMs: number): void;
}

/** Vitesse de retour du combattant recule a sa place, par seconde. */
const KNOCKBACK_RECOVERY = 2.2;

/**
 * Le recul se joue en un dixieme de seconde.
 *
 * Plus lent, le perdant a l air de reculer de lui-meme ; plus rapide, on ne
 * voit pas le deplacement, seulement un personnage qui a change de place.
 */
const KNOCKBACK_IMPACT_MS = 100;

export function createArenaDirector(options: ArenaDirectorOptions = {}): ArenaDirector {
  const fx: FxPool = createFxPool(options.rng === undefined ? {} : { rng: options.rng });
  const clash: Clash = createClash();

  let reducedMotion = options.reducedMotion ?? false;
  clash.setReducedMotion(reducedMotion);

  let state = { shake: 0, flash: 0, hype: 0, timeScale: 1 };
  let focus: ArenaFocusRequest | null = null;
  let focusLeftMs = 0;

  let schedule: readonly ScheduledArenaEvent[] = [];
  let next = 0;
  let sinceRevealMs = 0;
  let round: number | null = null;

  /** Recul courant et recul vise, en metres, par siege. */
  const push: Record<Seat, number> = { a: 0, b: 0 };
  const pushTarget: Record<Seat, number> = { a: 0, b: 0 };

  const fire = (event: ArenaEvent, frame: DirectorFrame): void => {
    const impulse = impulseFor(event, { reducedMotion });
    state = applyImpulse(state, impulse);

    if (impulse.focus !== null) {
      focus = impulse.focus;
      focusLeftMs = impulse.focus.durationMs;
    } else if (event.type === 'clash') {
      /*
        Le choc relache le cadrage pose par la revelation precedente.

        Sans cela, la camera resterait collee au second combattant pendant que
        les auras se percutent entre les deux : le moment que tout l ecran
        prepare se jouerait hors champ.
      */
      focus = null;
      focusLeftMs = 0;
    }

    switch (event.type) {
      case 'reveal': {
        const end = frame.ends[event.seat];
        const script = revealBurst({ color: frame.colors[event.seat], ultimate: event.ultimate });
        fx.spark(end, script.sparks);
        for (const ring of script.rings) {
          // Les anneaux au sol partent des pieds, les autres de la poitrine.
          fx.ring(ring.plane === 'ground' ? { x: end.x, y: 0.02, z: end.z } : end, ring);
        }
        break;
      }
      case 'clash':
        clash.start({ winner: event.winner, counter: event.counter, ultimate: event.ultimate });
        break;
      case 'victory':
        break;
    }
  };

  const onHit = (spec: ClashSpec, point: Vec3 | null, frame: DirectorFrame): void => {
    const where = point ?? {
      x: (frame.ends.a.x + frame.ends.b.x) / 2,
      y: (frame.ends.a.y + frame.ends.b.y) / 2,
      z: (frame.ends.a.z + frame.ends.b.z) / 2,
    };
    const script = impactBurst(spec, frame.colors);
    fx.spark(where, script.sparks);
    for (const ring of script.rings) {
      fx.ring(ring.plane === 'ground' ? { x: where.x, y: 0.02, z: where.z } : where, ring);
    }

    if (spec.winner !== null) {
      const loser: Seat = spec.winner === 'a' ? 'b' : 'a';
      // Le perdant part a l oppose du vainqueur : `a` est a gauche.
      pushTarget[loser] = knockbackDistance(spec) * (loser === 'a' ? -1 : 1);
    }
  };

  let spec: ClashSpec | null = null;
  /**
   * Dernieres couleurs d aura vues.
   *
   * `draw` ne les reprend pas en parametre : elles appartiennent a la meme
   * image que `update`, et les redemander ouvrirait la porte a un appelant qui
   * dessine avec les couleurs d une autre image.
   */
  let colors: ClashColors = { a: '#ffffff', b: '#ffffff' };

  return {
    get shake() {
      return state.shake;
    },
    get flash() {
      return state.flash;
    },
    get hype() {
      return state.hype;
    },
    get timeScale() {
      return state.timeScale;
    },
    /**
     * Le choc garde la camera, meme quand le verdict est deja tombe.
     *
     * Les poses de victoire et d encaissement arrivent a l instant du contact
     * — c est voulu, le perdant chancelle parce qu il vient d etre touche. Mais
     * si la camera partait AUSSI a cet instant, elle quitterait le centre
     * pendant que la gerbe explose : on verrait le vainqueur lever les bras et
     * jamais le coup qui l a fait gagner. Le cadrage sur le vainqueur est donc
     * demande a l heure et ne prend effet qu une fois les faisceaux eteints.
     */
    get focus() {
      return clash.active ? null : focus;
    },
    get clashing() {
      return clash.active;
    },
    get fxCount() {
      return fx.count;
    },
    get round() {
      return round;
    },

    knockback(seat): number {
      return push[seat];
    },

    play(story): void {
      if (round === story.round) return;
      round = story.round;
      schedule = roundChoreography(story);
      next = 0;
      sinceRevealMs = 0;
      spec = null;
      clash.stop();
    },

    cancel(): void {
      round = null;
      schedule = [];
      next = 0;
      sinceRevealMs = 0;
      spec = null;
      clash.stop();
      fx.clear();
      focus = null;
      focusLeftMs = 0;
      push.a = 0;
      push.b = 0;
      pushTarget.a = 0;
      pushTarget.b = 0;
      state = { shake: 0, flash: 0, hype: 0, timeScale: 1 };
    },

    setReducedMotion(reduced): void {
      reducedMotion = reduced;
      clash.setReducedMotion(reduced);
    },

    update(frame): void {
      const deltaMs = Math.max(0, frame.deltaMs);
      const delta = deltaMs / 1000;
      colors = frame.colors;

      if (next < schedule.length) {
        sinceRevealMs += deltaMs;
        // Une image longue peut franchir deux temps d un coup : on les joue
        // tous les deux plutot que d en perdre un.
        while (next < schedule.length && schedule[next]!.atMs <= sinceRevealMs) {
          const scheduled = schedule[next]!;
          next += 1;
          if (scheduled.event.type === 'clash') {
            spec = {
              winner: scheduled.event.winner,
              counter: scheduled.event.counter,
              ultimate: scheduled.event.ultimate,
            };
          }
          fire(scheduled.event, frame);
        }
      }

      const advanced = clash.update(deltaMs, frame.ends);
      if (advanced.hit && spec !== null) onHit(spec, advanced.point, frame);

      fx.update(delta);
      state = decayImpulse(state, delta);

      // Un cadrage suspendu par le choc ne se consume pas : sinon le vainqueur
      // perdrait une demi-seconde de son plan pour un choc qu on regardait.
      if (focus !== null && !clash.active) {
        focusLeftMs -= deltaMs;
        if (focusLeftMs <= 0) {
          focus = null;
          focusLeftMs = 0;
        }
      }

      for (const seat of ['a', 'b'] as const) {
        if (pushTarget[seat] !== 0) {
          // Depart franc vers la distance visee, puis retour lent : c est le
          // coup qui doit se voir, pas le retour a sa place.
          const step = damp(1000 / KNOCKBACK_IMPACT_MS, delta);
          push[seat] += (pushTarget[seat] - push[seat]) * step;
          if (Math.abs(pushTarget[seat] - push[seat]) < 0.01) pushTarget[seat] = 0;
        } else {
          push[seat] += (0 - push[seat]) * damp(KNOCKBACK_RECOVERY, delta);
        }
      }
    },

    draw(sink, elapsedMs): void {
      fx.draw(sink);
      clash.draw(sink, colors, elapsedMs);
    },
  };
}
