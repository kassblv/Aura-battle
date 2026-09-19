import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Extraction des donnees du prototype.
 *
 * Le prototype est un fichier HTML unique et ne doit jamais etre modifie. Plutot
 * que de recopier a la main 21 poses et leurs images cles — ce qui garantirait
 * des fautes de frappe silencieuses — on decoupe ses blocs de donnees et on les
 * **execute**. Le portage devient mecanique, et le test de non-regression peut
 * rejouer la meme extraction pour comparer.
 */

export type ProtoJoints = Readonly<
  Record<string, readonly [number, number] | number | boolean | undefined>
>;

export type ProtoFrame = Readonly<Record<string, unknown>>;

export interface ProtoAnimation {
  readonly dur: number;
  readonly frames: readonly ProtoFrame[];
  readonly w?: readonly number[];
  readonly ease?: boolean;
  readonly armsFront?: boolean;
  readonly armsBack?: boolean;
  readonly noFace?: boolean;
  readonly float?: number;
  readonly smug?: boolean;
  readonly sad?: boolean;
  readonly angry?: boolean;
  readonly hurt?: boolean;
  readonly emit?: readonly string[];
}

export interface ProtoPose {
  readonly id: string;
  readonly name: string;
  readonly style: 'calme' | 'hype' | 'provoc';
  readonly power: number;
  readonly price: number;
  readonly cost: number;
  readonly animated?: boolean;
}

export interface PrototypeData {
  readonly POSES: readonly ProtoPose[];
  readonly PTS: Readonly<Record<string, ProtoJoints>>;
  readonly APOSE: Readonly<Record<string, ProtoAnimation>>;
  readonly POSE_HANDS: Readonly<Record<string, readonly [readonly string[], readonly string[]]>>;
  readonly DEFAULT_HANDS: readonly [readonly string[], readonly string[]];
  readonly ANIMS: readonly {
    readonly id: string;
    readonly name: string;
    readonly mult: number;
    readonly price: number;
    readonly cost: number;
  }[];
}

/** Decoupe la declaration `const <name> = ...;` en partant de sa ligne d'ouverture. */
function sliceDeclaration(lines: readonly string[], name: string): string {
  const start = lines.findIndex(
    (line) => line.startsWith(`const ${name} `) || line.startsWith(`const ${name}=`),
  );
  if (start === -1) {
    throw new Error(`Declaration introuvable dans le prototype : ${name}`);
  }
  // Une declaration se termine sur la premiere ligne qui referme au niveau 0.
  let depth = 0;
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index]!;
    for (const char of line) {
      if (char === '{' || char === '[' || char === '(') depth += 1;
      if (char === '}' || char === ']' || char === ')') depth -= 1;
    }
    if (depth === 0 && line.trimEnd().endsWith(';')) {
      return lines.slice(start, index + 1).join('\n');
    }
  }
  throw new Error(`Declaration non refermee dans le prototype : ${name}`);
}

/**
 * Charge les donnees du prototype en les evaluant dans un module temporaire.
 * Aucune dependance au DOM : on n'extrait que des litteraux et une fonction pure.
 */
export async function loadPrototypeData(prototypePath: string): Promise<PrototypeData> {
  const lines = readFileSync(prototypePath, 'utf8').split('\n');
  const names = ['POSES', 'ANIMS', 'PTS', 'S0', 'K', 'TAU', 'APOSE', 'DEFAULT_HANDS', 'POSE_HANDS'];
  const source = `${names.map((name) => sliceDeclaration(lines, name)).join('\n')}
export default { POSES, ANIMS, PTS, APOSE, DEFAULT_HANDS, POSE_HANDS };
`;

  const directory = mkdtempSync(join(tmpdir(), 'aura-proto-'));
  const file = join(directory, 'prototype-data.mjs');
  writeFileSync(file, source, 'utf8');
  const loaded = (await import(pathToFileURL(file).href)) as { default: PrototypeData };
  return loaded.default;
}
