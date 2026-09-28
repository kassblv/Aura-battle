import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MOVE_ANIMATIONS, SYSTEM_ANIMATIONS as SYSTEM_SLUGS } from '../src/catalogue.js';
import { loadPrototypeData, type ProtoAnimation } from './prototype-source.js';

/**
 * Portage du prototype vers `packages/content/animations`.
 *
 * A lancer une fois : `pnpm --filter @aura/content run port`. Les fichiers JSON
 * produits deviennent ensuite la source de verite ; le prototype n'est plus
 * consulte que par le test de non-regression, qui rejoue cette meme extraction
 * pour verifier qu'aucune valeur n'a derive.
 */

/** Animations systeme : jouees par la mise en scene, jamais choisies par un joueur. */
const SYSTEM_NAMES: Readonly<Record<string, string>> = {
  charge: 'Charge',
  land: 'Atterrissage',
  stagger: 'Titubement',
  victory: 'Victoire',
  defeat: 'Defaite',
};

/** Les poses figees viennent de PTS, les animees de APOSE. */
const STATIC_SLUGS: readonly string[] = ['charge', 'land', 'stagger'];

const JOINTS = ['head', 'neck', 'hip', 'le', 'lh', 're', 'rh', 'lk', 'lf', 'rk', 'rf'] as const;

const EXPRESSIONS = ['smug', 'sad', 'angry', 'hurt'] as const;

/** Duree d'une pose figee : elle ne bouge pas, mais la boucle doit exister. */
const STATIC_DURATION = 4;

function expressionOf(source: Record<string, unknown>): string {
  return EXPRESSIONS.find((flag) => source[flag] === true) ?? 'neutral';
}

function flagsOf(source: Record<string, unknown>): Record<string, unknown> {
  const flags: Record<string, unknown> = { expression: expressionOf(source) };
  if (source.armsFront === true) flags.armsFront = true;
  if (source.armsBack === true) flags.armsBack = true;
  if (source.noFace === true) flags.noFace = true;
  if (typeof source.float === 'number') flags.float = source.float;
  return flags;
}

/** Une image cle du prototype melange articulations et modificateurs : on les separe. */
function frameOf(raw: Record<string, unknown>): Record<string, unknown> {
  const joints: Record<string, unknown> = {};
  for (const joint of JOINTS) {
    joints[joint] = raw[joint];
  }
  const frame: Record<string, unknown> = { joints };
  for (const key of ['z', 'lift', 'rot', 'hy', 'pitch'] as const) {
    if (raw[key] !== undefined) frame[key] = raw[key];
  }
  return frame;
}

function rarityOf(price: number, isDefault: boolean): string {
  if (isDefault) return 'default';
  if (price < 300) return 'common';
  if (price < 700) return 'rare';
  if (price < 1_200) return 'epic';
  return 'legendary';
}

function animationFromApose(
  id: string,
  name: string,
  move: { style: string; tier: number | null },
  rarity: string,
  anim: ProtoAnimation,
): Record<string, unknown> {
  const source = anim as unknown as Record<string, unknown>;
  const document: Record<string, unknown> = {
    id,
    version: 1,
    name: { fr: name },
    move,
    rarity,
    loop: { duration: anim.dur, weights: anim.w ?? null, ease: anim.ease ?? false },
    flags: flagsOf(source),
  };
  if (anim.emit !== undefined) document.emit = anim.emit;
  return document;
}

async function main(): Promise<void> {
  const root = new URL('../', import.meta.url);
  const data = await loadPrototypeData(
    fileURLToPath(new URL('../../../prototype/aura-battle.html', import.meta.url)),
  );
  const poseById = new Map(data.POSES.map((pose) => [pose.id, pose]));
  const handsOf = (slug: string): unknown => data.POSE_HANDS[slug] ?? data.DEFAULT_HANDS;

  let written = 0;
  const write = (style: string, slug: string, document: Record<string, unknown>): void => {
    const directory = fileURLToPath(new URL(`animations/${style}/`, root));
    mkdirSync(directory, { recursive: true });
    writeFileSync(`${directory}${slug}.json`, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
    written += 1;
  };

  // --- Mouvements de jeu ---
  for (const [style, tiers] of Object.entries(MOVE_ANIMATIONS)) {
    for (const [tier, slugs] of Object.entries(tiers)) {
      slugs.forEach((slug, index) => {
        const pose = poseById.get(slug);
        const anim = data.APOSE[slug];
        if (pose === undefined || anim === undefined) {
          throw new Error(`Pose absente du prototype : ${slug}`);
        }
        const document = animationFromApose(
          `anim.${style}.t${tier}.${slug}`,
          pose.name,
          { style, tier: Number(tier) },
          rarityOf(pose.price, index === 0),
          anim,
        );
        document.hands = handsOf(slug);
        document.frames = anim.frames.map((frame) => frameOf(frame as Record<string, unknown>));
        write(style, slug, document);
      });
    }
  }

  // --- Animations systeme ---
  for (const slug of SYSTEM_SLUGS) {
    const name = SYSTEM_NAMES[slug] ?? slug;
    const id = `anim.system.none.${slug}`;
    const move = { style: 'system', tier: null };
    let document: Record<string, unknown>;

    if (!STATIC_SLUGS.includes(slug)) {
      const anim = data.APOSE[slug];
      if (anim === undefined) throw new Error(`Animation systeme absente : ${slug}`);
      document = animationFromApose(id, name, move, 'default', anim);
      document.hands = handsOf(slug);
      document.frames = anim.frames.map((frame) => frameOf(frame as Record<string, unknown>));
    } else {
      const pts = data.PTS[slug];
      if (pts === undefined) throw new Error(`Pose systeme absente : ${slug}`);
      const raw = pts as unknown as Record<string, unknown>;
      document = {
        id,
        version: 1,
        name: { fr: name },
        move,
        rarity: 'default',
        // Une pose figee reste une boucle d'une seule image : le lecteur
        // d'animation n'a ainsi qu'un seul cas a traiter.
        loop: { duration: STATIC_DURATION, weights: null, ease: false },
        flags: flagsOf(raw),
        hands: handsOf(slug),
        frames: [frameOf(raw)],
      };
    }
    write('system', slug, document);
  }

  console.log(`${written} animations ecrites dans packages/content/animations`);
}

void main();
