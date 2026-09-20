import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JOINT_NAMES, loadAnimation, type Animation } from '@aura/content';
import { describe, expect, it } from 'vitest';
import { samplePose } from './sample.js';

/**
 * Une danse doit accelerer quelque part.
 *
 * Une aura battle se gagne en rejouant un meme de facon reconnaissable, et un
 * meme se reconnait a son ACCENT : le griddy claque, le dab tombe, la danse du
 * bateau tire puis relache. Un mouvement qui parcourt sa boucle a vitesse
 * constante n'est pas une danse, c'est un metronome — et c'est exactement ce
 * qui se voyait a l'ecran.
 *
 * Le catalogue portait les deux : sept animations declaraient des parts de
 * boucle inegales et un adoucissement, quatorze n'avaient ni l'un ni l'autre.
 * Les premieres mesuraient un rapport pic/moyenne de 4 a 6, les secondes
 * etaient toutes agglutinees autour de **1,5** — la signature d'une sinusoide,
 * ce que produit fatalement un Catmull-Rom sur des images de duree egale.
 *
 * Ce test mesure la chose plutot que de verifier la presence des champs : une
 * animation peut trouver son accent par ses parts, par son adoucissement ou en
 * ajoutant des images cles, et c'est le resultat qui compte.
 */

const ANIMATIONS_DIR = fileURLToPath(
  new URL('../../../../packages/content/animations/', import.meta.url),
);

function shippedAnimations(): readonly Animation[] {
  const all: Animation[] = [];
  for (const style of readdirSync(ANIMATIONS_DIR)) {
    for (const file of readdirSync(`${ANIMATIONS_DIR}${style}`)) {
      all.push(
        loadAnimation(JSON.parse(readFileSync(`${ANIMATIONS_DIR}${style}/${file}`, 'utf8'))),
      );
    }
  }
  return all.sort((a, b) => a.id.localeCompare(b.id));
}

/** Nombre d'instants echantillonnes sur une boucle. */
const STEPS = 64;

/**
 * Rapport entre la vitesse de pointe et la vitesse moyenne du squelette.
 *
 * 1 signifie « vitesse rigoureusement constante ». Une sinusoide pure tourne
 * autour de 1,5. Au-dela de 2, le mouvement a un temps fort.
 */
function accent(animation: Animation): number {
  const speeds: number[] = [];
  let previous = samplePose(animation, 0);
  for (let step = 1; step <= STEPS; step++) {
    const pose = samplePose(animation, (animation.loop.duration * step) / STEPS);
    let travelled = 0;
    for (const joint of JOINT_NAMES) {
      const from = previous.joints[joint];
      const to = pose.joints[joint];
      travelled += Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
    }
    speeds.push(travelled);
    previous = pose;
  }
  const mean = speeds.reduce((sum, value) => sum + value, 0) / speeds.length;
  return mean > 0 ? Math.max(...speeds) / mean : 0;
}

/**
 * Le seuil.
 *
 * Il est pose au-dessus du plateau des sinusoides (1,92 au plus haut) et en
 * dessous de la plus sobre des animations rythmees. Il ne recompense pas
 * l'agitation : une danse peut le franchir avec un seul temps fort par boucle.
 */
const MIN_ACCENT = 2.2;

/**
 * Les poses systeme en sont exemptees, et elles seules.
 *
 * `charge`, `land` et `stagger` sont des poses tenues d'une seule image : leur
 * demander un accent reviendrait a leur demander de bouger, alors que leur
 * travail est precisement de ne pas le faire.
 */
const isDance = (animation: Animation): boolean => !animation.id.startsWith('anim.system.');

describe('rythme des animations', () => {
  const animations = shippedAnimations();

  it('mesure bien une vitesse constante comme une absence d accent', () => {
    // Garde-fou sur la mesure elle-meme : une pose tenue ne bouge pas, donc
    // elle n'a pas d'accent — si ce test passait a 3, la mesure serait fausse.
    const held = animations.find((animation) => animation.id === 'anim.system.none.charge');
    expect(held).toBeDefined();
    expect(accent(held!)).toBeLessThan(MIN_ACCENT);
  });

  it('donne un temps fort a chaque danse', () => {
    const plates = animations
      .filter(isDance)
      .map((animation) => ({ id: animation.id, accent: Number(accent(animation).toFixed(2)) }))
      .filter((mesure) => mesure.accent < MIN_ACCENT);
    expect(plates).toEqual([]);
  });

  /**
   * L'accent ne doit pas devenir un tic : au-dela, le mouvement se resume a un
   * sursaut suivi d'une longue immobilite, ce qui se lit comme une saccade.
   */
  it('ne transforme pas le temps fort en saccade', () => {
    const saccades = animations
      .filter(isDance)
      .map((animation) => ({ id: animation.id, accent: Number(accent(animation).toFixed(2)) }))
      .filter((mesure) => mesure.accent > 9);
    expect(saccades).toEqual([]);
  });
});
