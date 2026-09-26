import { describe, expect, it } from 'vitest';
import { createOrbitControl, type OrbitControl } from './orbit.js';

/**
 * Faire tourner son personnage au doigt.
 *
 * Tout se teste sans navigateur : le module ne recoit que des positions et des
 * durees. L ecoute des evenements de pointeur, elle, vit dans `useArena` et
 * n est pas couverte — c est la meme frontiere que `renderer.ts`.
 */

const VIEWPORT = { width: 844, height: 390 };

function control(): OrbitControl {
  const orbit = createOrbitControl();
  orbit.setViewport(VIEWPORT.width, VIEWPORT.height);
  return orbit;
}

/** Glisse en `steps` images, en avancant l horloge entre chaque. */
function drag(
  orbit: OrbitControl,
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps = 6,
  step = 1 / 60,
): void {
  orbit.start({ id: 1, ...from });
  for (let i = 1; i <= steps; i++) {
    const u = i / steps;
    orbit.move({ id: 1, x: from.x + (to.x - from.x) * u, y: from.y + (to.y - from.y) * u });
    orbit.update(step);
  }
}

function coast(orbit: OrbitControl, seconds: number, step = 1 / 60): void {
  for (let t = 0; t < seconds; t += step) orbit.update(step);
}

describe('createOrbitControl', () => {
  it('part de face, sans inertie', () => {
    const orbit = control();
    expect(orbit.yaw).toBe(0);
    expect(orbit.tilt).toBe(0);
    expect(orbit.dragging).toBe(false);
  });

  /**
   * Manipulation directe : le doigt entraine le personnage.
   *
   * Glisser vers la droite fait tourner le personnage vers la droite, donc la
   * camera part du cote oppose — un angle d orbite qui diminue.
   */
  it('fait tourner le personnage dans le sens du doigt', () => {
    const right = control();
    drag(right, { x: 200, y: 200 }, { x: 500, y: 200 });
    expect(right.yaw).toBeLessThan(0);

    const left = control();
    drag(left, { x: 500, y: 200 }, { x: 200, y: 200 });
    expect(left.yaw).toBeGreaterThan(0);
  });

  it('bascule la camera vers le haut quand le doigt descend', () => {
    const orbit = control();
    drag(orbit, { x: 400, y: 100 }, { x: 400, y: 300 });
    expect(orbit.tilt).toBeGreaterThan(0);
  });

  it('fait un demi-tour et demi sur toute la largeur', () => {
    const orbit = control();
    drag(orbit, { x: 0, y: 200 }, { x: VIEWPORT.width, y: 200 }, 24);
    // 2,8 rad par largeur : assez pour voir le dos d un coup de pouce, pas
    // assez pour perdre le fil de l orientation.
    expect(Math.abs(orbit.yaw)).toBeGreaterThan(2.5);
    expect(Math.abs(orbit.yaw)).toBeLessThan(3.1);
  });

  it('tourne plus vite pour le meme geste sur un ecran plus etroit', () => {
    const wide = createOrbitControl();
    wide.setViewport(1200, 390);
    drag(wide, { x: 0, y: 0 }, { x: 300, y: 0 });

    const narrow = createOrbitControl();
    narrow.setViewport(400, 390);
    drag(narrow, { x: 0, y: 0 }, { x: 300, y: 0 });

    expect(Math.abs(narrow.yaw)).toBeGreaterThan(Math.abs(wide.yaw));
  });

  it('survit a une fenetre repliee sans partir en NaN', () => {
    const orbit = createOrbitControl();
    orbit.setViewport(0, 0);
    drag(orbit, { x: 0, y: 0 }, { x: 40, y: 40 });
    expect(Number.isFinite(orbit.yaw)).toBe(true);
    expect(Number.isFinite(orbit.tilt)).toBe(true);
  });
});

describe('multi-touch et boutons', () => {
  /**
   * Deux doigts poses sur l arene ne doivent pas tourner deux fois plus vite.
   *
   * Sans cette regle, un pincement — le geste le plus naturel pour zoomer —
   * envoie le personnage en vrille.
   */
  it('ne laisse commander qu un seul doigt', () => {
    const one = control();
    drag(one, { x: 200, y: 200 }, { x: 400, y: 200 });

    const two = control();
    two.start({ id: 1, x: 200, y: 200 });
    two.start({ id: 2, x: 600, y: 200 });
    for (let i = 1; i <= 6; i++) {
      two.move({ id: 1, x: 200 + (200 * i) / 6, y: 200 });
      two.move({ id: 2, x: 600 + (200 * i) / 6, y: 200 });
      two.update(1 / 60);
    }
    expect(two.yaw).toBeCloseTo(one.yaw, 10);
  });

  it('ignore le doigt qui se leve sans avoir commande', () => {
    const orbit = control();
    orbit.start({ id: 1, x: 200, y: 200 });
    orbit.end(2);
    expect(orbit.dragging).toBe(true);
    orbit.end(1);
    expect(orbit.dragging).toBe(false);
  });

  /**
   * Un appui n est pas un glissement.
   *
   * L accueil garde ses boutons : le seuil sert a distinguer le pouce qui
   * inspecte de celui qui effleure l arene en visant autre chose.
   */
  it('distingue l appui du glissement', () => {
    const tap = control();
    tap.start({ id: 1, x: 200, y: 200 });
    tap.move({ id: 1, x: 202, y: 201 });
    tap.end(1);
    expect(tap.moved).toBe(false);

    const swipe = control();
    drag(swipe, { x: 200, y: 200 }, { x: 260, y: 200 });
    expect(swipe.moved).toBe(true);
  });

  /**
   * `lostpointercapture` suit **chaque** `pointerup` : le navigateur relache
   * la capture tout seul. `useArena` ne doit donc annuler que si le doigt n a
   * pas deja termine proprement — sinon l inertie meurt a chaque lacher. Ce
   * que le controle expose pour que l appelant puisse trancher, c est
   * `dragging`.
   */
  it('sait dire s il tient encore le doigt, pour ne pas annuler un lacher propre', () => {
    const orbit = control();
    drag(orbit, { x: 200, y: 200 }, { x: 600, y: 200 });
    expect(orbit.dragging).toBe(true);
    orbit.end(1);
    expect(orbit.dragging).toBe(false);

    // L appelant, voyant `dragging` a faux, n annule pas : l elan survit.
    const angle = orbit.yaw;
    coast(orbit, 0.2);
    expect(orbit.yaw).not.toBe(angle);
  });

  /**
   * `pointercancel` : appel entrant, geste systeme, application en
   * arriere-plan. Le `pointerup` n arrivera jamais — sans annulation, le
   * personnage tournerait pour toujours.
   */
  it('arrete tout sur une annulation de pointeur', () => {
    const orbit = control();
    drag(orbit, { x: 200, y: 200 }, { x: 600, y: 200 });
    orbit.cancel();
    const angle = orbit.yaw;
    coast(orbit, 2);
    expect(orbit.dragging).toBe(false);
    expect(orbit.yaw).toBeCloseTo(angle, 10);
  });
});

describe('inertie', () => {
  it('continue de tourner apres le lacher, puis s arrete', () => {
    const orbit = control();
    drag(orbit, { x: 200, y: 200 }, { x: 500, y: 200 });
    const atRelease = orbit.yaw;
    orbit.end(1);

    coast(orbit, 0.2);
    // La roue libre prolonge le geste dans le meme sens.
    expect(orbit.yaw).toBeLessThan(atRelease);

    coast(orbit, 4);
    const settled = orbit.yaw;
    coast(orbit, 2);
    // Puis elle s arrete franchement, au lieu de ramper indefiniment.
    expect(orbit.yaw).toBe(settled);
  });

  it('ne lance jamais une toupie plus rapide que la camera ne suit', () => {
    const orbit = control();
    // Un coup de pouce absurde : toute la largeur en une image.
    orbit.start({ id: 1, x: 0, y: 200 });
    for (let i = 0; i < 10; i++) {
      orbit.move({ id: 1, x: i * 2000, y: 200 });
      orbit.update(1 / 60);
    }
    orbit.end(1);
    const before = orbit.yaw;
    orbit.update(1 / 60);
    // 3,2 rad/s de plafond : au-dela, la camera ne tient plus l arc.
    expect(Math.abs(orbit.yaw - before)).toBeLessThanOrEqual(3.2 / 60 + 1e-9);
  });

  it('arrete la rotation des qu on repose le doigt', () => {
    const orbit = control();
    drag(orbit, { x: 200, y: 200 }, { x: 600, y: 200 });
    orbit.end(1);
    coast(orbit, 0.1);

    orbit.start({ id: 1, x: 400, y: 200 });
    const grabbed = orbit.yaw;
    orbit.update(1 / 60);
    // Comme on pose la main sur un disque qui tourne.
    expect(orbit.yaw).toBe(grabbed);
  });

  it('ne bouge pas sur une image de duree nulle ou negative', () => {
    // `requestAnimationFrame` peut livrer deux fois le meme instant.
    const orbit = control();
    drag(orbit, { x: 200, y: 200 }, { x: 500, y: 200 });
    orbit.end(1);
    const angle = orbit.yaw;
    orbit.update(0);
    orbit.update(-1);
    expect(orbit.yaw).toBe(angle);
  });

  it('reste dans le tour, sans accumuler les radians', () => {
    const orbit = control();
    for (let turn = 0; turn < 5; turn++) {
      drag(orbit, { x: 0, y: 200 }, { x: VIEWPORT.width, y: 200 }, 12);
      orbit.end(1);
    }
    expect(orbit.yaw).toBeGreaterThanOrEqual(-Math.PI);
    expect(orbit.yaw).toBeLessThanOrEqual(Math.PI);
  });
});

describe('bornes verticales', () => {
  it('ne descend pas sous la plateforme et ne survole pas la scene', () => {
    const down = control();
    drag(down, { x: 400, y: 0 }, { x: 400, y: 4000 }, 40);
    down.end(1);
    coast(down, 3);
    expect(down.tilt).toBeLessThanOrEqual(0.9);

    const up = control();
    drag(up, { x: 400, y: 4000 }, { x: 400, y: 0 }, 40);
    up.end(1);
    coast(up, 3);
    expect(up.tilt).toBeGreaterThanOrEqual(-0.5);
  });

  /**
   * Arrive en butee, l elevation cesse.
   *
   * Laisser vivre la vitesse ferait repartir la camera a la seconde ou le
   * joueur reprend le doigt — un ressaut qu on ne s explique pas.
   */
  it('ne rebondit pas sur la butee quand on lache', () => {
    const orbit = control();
    drag(orbit, { x: 400, y: 0 }, { x: 400, y: 4000 }, 40);
    orbit.end(1);
    coast(orbit, 1);
    const stuck = orbit.tilt;

    orbit.start({ id: 1, x: 400, y: 200 });
    orbit.update(1 / 60);
    expect(orbit.tilt).toBe(stuck);
  });

  it('laisse redescendre apres avoir touche la butee haute', () => {
    const orbit = control();
    drag(orbit, { x: 400, y: 0 }, { x: 400, y: 4000 }, 40);
    orbit.end(1);
    const high = orbit.tilt;
    drag(orbit, { x: 400, y: 300 }, { x: 400, y: 100 }, 10);
    expect(orbit.tilt).toBeLessThan(high);
  });
});

describe('reset', () => {
  it('ramene le personnage de face, sans inertie residuelle', () => {
    const orbit = control();
    drag(orbit, { x: 200, y: 100 }, { x: 700, y: 350 });
    orbit.end(1);
    expect(orbit.yaw).not.toBe(0);

    orbit.reset();
    expect(orbit.yaw).toBe(0);
    expect(orbit.tilt).toBe(0);
    expect(orbit.dragging).toBe(false);

    coast(orbit, 2);
    expect(orbit.yaw).toBe(0);
    expect(orbit.tilt).toBe(0);
  });

  it('libere le doigt en cours : un reset pendant un glissement ne laisse rien de coince', () => {
    const orbit = control();
    orbit.start({ id: 1, x: 200, y: 200 });
    orbit.reset();
    expect(orbit.dragging).toBe(false);
    // Le meme identifiant doit pouvoir reprendre la main tout de suite.
    orbit.start({ id: 1, x: 200, y: 200 });
    expect(orbit.dragging).toBe(true);
  });
});
