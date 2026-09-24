import { loadAnimation, type Animation } from '@aura/content';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Box3, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { samplePose } from '../animation/sample.js';
import {
  BAND_LEFT_WIDTH,
  bandHeight,
  CARD_ARC,
  CARD_HEIGHT,
  CARD_LIFT,
  GAP,
  GAUGE_HEIGHT,
  GAUGE_MIN_WIDTH,
  TOUCH,
} from '../ui/layout.js';

/**
 * Part haute du combattant qui doit rester degagee.
 *
 * La tete, le torse et les bras portent l'expression, l'aura et la pose : ce
 * sont eux qu'on lit. La bande vit dans les arcs de pouce et au centre-bas, et
 * y effleure les jambes — ADR 0008 ne laisse pas d'autre place. Cette moitie
 * haute, elle, ne se negocie pas.
 */
const CLEAR_FRACTION = 0.5;
import {
  ArenaCameraRig,
  choiceFraming,
  createArenaCamera,
  wideFraming,
  type CameraFraming,
} from './camera.js';
import { createFighterRig } from './rig.js';
import { createToonGradientMap } from './toonGradient.js';

/**
 * Ou tombent les combattants a l'ecran, et ou le HUD a donc le droit de vivre.
 *
 * « La barre ne doit pas cacher les joueurs » est une contrainte de produit ;
 * pour qu'elle tienne dans six mois, il faut qu'elle soit une **mesure**. Ce
 * test projette les vrais rigs a travers la vraie camera de match et confronte
 * le resultat aux metriques de `ui/layout.ts`. Deplacer la camera, changer la
 * pose de garde ou epaissir la jauge le fait tomber — ce qui est exactement ce
 * qu'on veut, puisque chacun de ces trois gestes peut recouvrir un personnage.
 */

/** Les combattants se tiennent la, et le cadrage de match ne bouge pas (`useArena`). */
const FIGHTER_X = 1.45;

/**
 * La phase de choix, et elle seule.
 *
 * C'est la seule ou la bande de commandes existe, et `match/presentation.ts`
 * y met les deux combattants en garde : avant la revelation, tout le monde
 * joue `charge`. Mesurer l'enveloppe des vingt-six animations donnerait une
 * borne vraie mais sans rapport — les saltos se jouent quand le HUD a disparu.
 */
function chargeAnimation(): Animation {
  const path = fileURLToPath(
    new URL('../../../../packages/content/animations/system/charge.json', import.meta.url),
  );
  return loadAnimation(JSON.parse(readFileSync(path, 'utf8')));
}

/** Boite englobant les deux combattants sur un cycle complet de garde. */
function fightersEnvelope(): Box3 {
  const gradientMap = createToonGradientMap();
  const animation = chargeAnimation();
  const box = new Box3().makeEmpty();

  for (const [x, placement] of [
    [-FIGHTER_X, { turn: -0.5, facing: 1 as const }],
    [FIGHTER_X, { turn: Math.PI + 0.5, facing: -1 as const }],
  ] as const) {
    const rig = createFighterRig({ gradientMap }, placement);
    rig.root.position.x = x;
    for (let step = 0; step < 24; step += 1) {
      const t = (step / 24) * animation.loop.duration;
      rig.pose(samplePose(animation, t), animation, t, 1 / 60);
      rig.root.updateMatrixWorld(true);
      box.union(new Box3().setFromObject(rig.root));
    }
    rig.dispose();
  }

  gradientMap.dispose();
  return box;
}

interface ScreenBand {
  /** Ordonnee du sommet des combattants, en pixels depuis le haut. */
  readonly top: number;
  /** Ordonnee de leurs pieds. */
  readonly bottom: number;
}

/**
 * Bande verticale occupee par les combattants, oscillation d'ambiance comprise.
 *
 * La camera respire (`sin(elapsed * 0.13)`, periode ~48 s) : une mesure prise
 * a un instant donne raterait les extremes.
 */
function fightersBand(
  box: Box3,
  width: number,
  height: number,
  framing: CameraFraming = wideFraming(),
): ScreenBand {
  const camera = createArenaCamera(width / height);
  const rig = new ArenaCameraRig(camera);
  for (let frame = 0; frame < 600; frame += 1) {
    rig.update({ framing, elapsed: frame / 60, delta: 1 / 60, shake: 0, reducedMotion: true });
  }

  let top = Number.POSITIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  const point = new Vector3();
  for (let step = 0; step < 120; step += 1) {
    rig.update({
      framing,
      elapsed: 10 + (step * 48) / 120,
      delta: 1 / 60,
      shake: 0,
      reducedMotion: false,
    });
    for (const x of [box.min.x, box.max.x]) {
      for (const y of [box.min.y, box.max.y]) {
        for (const z of [box.min.z, box.max.z]) {
          const projected = point.set(x, y, z).project(camera);
          const screenY = (-projected.y * 0.5 + 0.5) * height;
          top = Math.min(top, screenY);
          bottom = Math.max(bottom, screenY);
        }
      }
    }
  }
  return { top, bottom };
}

const DEVICES = [
  { name: 'iPhone SE', width: 667, height: 375, safeBottom: 10 },
  { name: 'Android compact', width: 740, height: 360, safeBottom: 10 },
  { name: 'iPhone 13 mini', width: 812, height: 375, safeBottom: 21 },
  { name: 'iPhone 14', width: 844, height: 390, safeBottom: 21 },
  { name: 'iPhone 15 Pro Max', width: 932, height: 430, safeBottom: 21 },
  { name: 'Pixel 7', width: 915, height: 412, safeBottom: 21 },
] as const;

const envelope = fightersEnvelope();

describe('la bande de commandes ne couvre pas les combattants', () => {
  /**
   * Le cadrage large ne depend que du champ **vertical** de la camera : les
   * combattants tombent donc aux memes proportions de hauteur sur tous les
   * rapports d'ecran. C'est ce qui rend la regle enoncable en pourcentage.
   */
  it('pose les combattants aux memes proportions quel que soit le format', () => {
    const ratios = DEVICES.map((device) => {
      const band = fightersBand(envelope, device.width, device.height);
      return [band.top / device.height, band.bottom / device.height] as const;
    });
    const [reference] = ratios;
    expect(reference).toBeDefined();
    for (const [top, bottom] of ratios) {
      expect(top).toBeCloseTo(reference?.[0] ?? 0, 2);
      expect(bottom).toBeCloseTo(reference?.[1] ?? 0, 2);
    }
    // Un cinquieme de hauteur libre sous les pieds : c'est tout le budget.
    expect(reference?.[1] ?? 0).toBeLessThan(0.8);
  });

  /**
   * L'exigence du client, telle quelle : la jauge ne doit rien cacher. Elle
   * etait posee a `safe + 142 px`, c'est-a-dire en travers de la poitrine des
   * deux combattants.
   */
  it('garde toute la jauge sous les pieds des combattants', () => {
    for (const device of DEVICES) {
      const band = fightersBand(envelope, device.width, device.height);
      const gaugeTop = device.height - device.safeBottom - GAUGE_HEIGHT;
      expect(gaugeTop, `${device.name} : haut de la jauge`).toBeGreaterThan(band.bottom);
    }
  });

  /**
   * Les grappes, elles, ne peuvent pas tenir sous les pieds : deux rangees de
   * 46 px valent trois fois le budget disponible, et ADR 0008 les cloue dans
   * les arcs de pouce. Elles effleurent donc les jambes — mais la tete, le
   * torse et les bras, qui portent l'expression et l'aura, restent degages.
   */
  it('laisse degagee la moitie haute des combattants', () => {
    // La bande n'est visible qu'a la phase de choix : c'est son cadrage qui compte.
    const tallest = bandHeight();
    for (const device of DEVICES) {
      const band = fightersBand(envelope, device.width, device.height, choiceFraming());
      const clear = band.top + (band.bottom - band.top) * CLEAR_FRACTION;
      const controlsTop = device.height - device.safeBottom - tallest;
      expect(controlsTop, `${device.name} : haut des grappes`).toBeGreaterThan(clear);
    }
  });

  /*
    La main de cartes (chantier n°2) vit au centre-bas, ENTRE les combattants :
    c'est elle qui monte le plus pres de leur silhouette. Elle ne doit pas
    depasser la ligne de la moitie haute, cartes soulevees et onglets compris.
  */
  it('laisse degagee la moitie haute des combattants, main de cartes comprise', () => {
    const hand = TOUCH + GAP + CARD_HEIGHT + CARD_LIFT + CARD_ARC;
    for (const device of DEVICES) {
      const band = fightersBand(envelope, device.width, device.height, choiceFraming());
      const clear = band.top + (band.bottom - band.top) * CLEAR_FRACTION;
      const handTop = device.height - device.safeBottom - hand;
      // Une vraie marge, pas un pixel : un combattant qui se penche en avant
      // ne doit pas plonger la tete dans les cartes.
      expect(handTop - clear, `${device.name} : marge au-dessus de la main`).toBeGreaterThan(8);
    }
  });

  it('laisse a la jauge une largeur exploitable dans sa colonne', () => {
    expect(BAND_LEFT_WIDTH - 14).toBeGreaterThanOrEqual(GAUGE_MIN_WIDTH);
  });
});

describe('cadrage de la phase de choix', () => {
  it('remonte les combattants sans couper leurs tetes', () => {
    for (const device of DEVICES) {
      const wide = fightersBand(envelope, device.width, device.height);
      const choice = fightersBand(envelope, device.width, device.height, choiceFraming());
      expect(choice.bottom, device.name).toBeLessThan(wide.bottom);
      // Le sommet reste sous le bandeau du haut (30 px).
      expect(choice.top, device.name).toBeGreaterThan(30);
    }
  });
});
