import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';

/**
 * Validation d'une animation (docs/07-content-pipeline.md).
 *
 * Deux niveaux. Le schema JSON verifie la **forme** : identifiant, articulations
 * presentes, bornes des champs. Les controles de coherence verifient la
 * **plausibilite** : un squelette dont l'avant-bras change de longueur d'une
 * image a l'autre passe le schema sans probleme, mais produira un personnage
 * elastique a l'ecran.
 *
 * Aucune I/O ici : le schema et l'animation arrivent deja analyses, ce qui rend
 * la validation utilisable aussi bien par le CLI que par le serveur.
 */

/**
 * Gravite d'un signalement.
 *
 * `error` bloque la publication. `warning` merite un coup d'oeil sans rien
 * empecher : certaines verifications detectent une odeur, pas une faute.
 */
export type Severity = 'error' | 'warning';

export interface ValidationIssue {
  readonly path: string;
  readonly severity: Severity;
  readonly message: string;
}

export interface ValidationResult {
  /** Vrai s'il ne reste aucune erreur. Les avertissements ne l'invalident pas. */
  readonly valid: boolean;
  readonly issues: readonly ValidationIssue[];
  readonly errors: readonly ValidationIssue[];
  readonly warnings: readonly ValidationIssue[];
}

/** Segments du squelette dont la longueur doit rester stable. */
const SEGMENTS: readonly (readonly [string, string])[] = [
  ['head', 'neck'],
  ['neck', 'hip'],
  ['neck', 'le'],
  ['le', 'lh'],
  ['neck', 're'],
  ['re', 'rh'],
  ['hip', 'lk'],
  ['lk', 'lf'],
  ['hip', 'rk'],
  ['rk', 'rf'],
];

/**
 * Tolerance sur la longueur d'un membre, autour de sa mediane (docs/07).
 *
 * Au-dela : avertissement. Les poses sont dessinees en 2D, et un bras qui
 * pointe vers la camera se raccourcit a l'ecran sans que sa longueur reelle
 * change. Les animations du prototype, qui font office de reference de qualite,
 * depassent regulierement ce seuil pour cette raison : le salto arriere atteint
 * 47 %, le dab et la danse du bateau environ 34 %. Traiter cet ecart comme une
 * faute reviendrait a rejeter le contenu de reference.
 */
const LENGTH_TOLERANCE = 0.25;

/**
 * Au-dela de ce seuil, ce n'est plus un raccourci de perspective mais un
 * squelette elastique : c'est une erreur. Pose au-dessus du pire cas legitime
 * mesure (47 %, le salto arriere).
 */
const LENGTH_HARD_LIMIT = 0.6;

/** Un membre plus court que cela est trop ecrase pour qu'un ratio ait un sens. */
const MIN_SEGMENT_LENGTH = 4;

/** Rotation du corps : au-dela d'un tour complet, c'est une faute de saisie. */
const MAX_BODY_ROTATION = Math.PI * 2;

/** Salto : deux tours suffisent largement. */
const MAX_PITCH = Math.PI * 4;

/**
 * Deplacement moyen maximal des articulations entre deux images cles, bouclage
 * compris.
 *
 * Calibre sur les animations du prototype, qui font office de reference de
 * qualite : la plus extreme d'entre elles, le salto arriere, atteint 63,5 cm en
 * deplacant tout le corps. On borne a 90 cm, soit plus de la moitie de la
 * hauteur d'un personnage — au-dela, ce n'est plus un mouvement, c'est une
 * teleportation, et l'interpolation produira un glissement visible.
 *
 * Volontairement une borne absolue et non un ratio : un ratio calcule sur la
 * mediane des transitions est structurellement aveugle au cas ou une seule
 * image est loin des autres, puisque cette image tire la mediane avec elle.
 */
const MAX_TRANSITION = 90;

interface Frame {
  readonly joints: Record<string, readonly [number, number]>;
  readonly z?: Record<string, number>;
  readonly rot?: number;
  readonly pitch?: number;
}

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
};

/** Longueur d'un segment, profondeur comprise : une main devant le corps se raccourcit en 2D. */
function segmentLength(frame: Frame, from: string, to: string): number {
  const a = frame.joints[from];
  const b = frame.joints[to];
  if (a === undefined || b === undefined) return 0;
  const dz = (frame.z?.[to] ?? 0) - (frame.z?.[from] ?? 0);
  return Math.hypot(b[0] - a[0], b[1] - a[1], dz);
}

/** Deplacement moyen des articulations entre deux images. */
function transitionDistance(from: Frame, to: Frame): number {
  const names = Object.keys(from.joints);
  if (names.length === 0) return 0;
  const total = names.reduce((sum, name) => {
    const a = from.joints[name];
    const b = to.joints[name];
    return a === undefined || b === undefined ? sum : sum + Math.hypot(b[0] - a[0], b[1] - a[1]);
  }, 0);
  return total / names.length;
}

function checkSkeleton(frames: readonly Frame[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const [from, to] of SEGMENTS) {
    const lengths = frames.map((frame) => segmentLength(frame, from, to));
    const reference = median(lengths);
    if (reference < MIN_SEGMENT_LENGTH) continue;

    lengths.forEach((length, index) => {
      const deviation = Math.abs(length - reference) / reference;
      if (deviation > LENGTH_TOLERANCE) {
        issues.push({
          path: `frames[${index}]`,
          severity: deviation > LENGTH_HARD_LIMIT ? 'error' : 'warning',
          message:
            `longueur du segment ${from}-${to} : ${length.toFixed(1)} contre ${reference.toFixed(1)} attendu ` +
            `(${(deviation * 100).toFixed(0)} % d'ecart, tolerance ${LENGTH_TOLERANCE * 100} %)`,
        });
      }
    });
  }

  frames.forEach((frame, index) => {
    if (frame.rot !== undefined && Math.abs(frame.rot) > MAX_BODY_ROTATION) {
      issues.push({
        path: `frames[${index}].rot`,
        severity: 'error',
        message: `rotation du corps hors du plausible : ${frame.rot}`,
      });
    }
    if (frame.pitch !== undefined && Math.abs(frame.pitch) > MAX_PITCH) {
      issues.push({
        path: `frames[${index}].pitch`,
        severity: 'error',
        message: `rotation de salto hors du plausible : ${frame.pitch}`,
      });
    }
  });

  return issues;
}

function checkContinuity(frames: readonly Frame[]): ValidationIssue[] {
  if (frames.length < 2) return [];

  const issues: ValidationIssue[] = [];
  const report = (from: number, to: number, distance: number): void => {
    issues.push({
      path: `frames[${from}]`,
      severity: 'error',
      message:
        `la boucle saute de ${distance.toFixed(1)} cm entre les images ${from} et ${to} ` +
        `(maximum ${MAX_TRANSITION} cm)`,
    });
  };

  for (let index = 1; index < frames.length; index += 1) {
    const distance = transitionDistance(frames[index - 1]!, frames[index]!);
    if (distance > MAX_TRANSITION) report(index - 1, index, distance);
  }

  // Le retour de la derniere image a la premiere est une transition comme une
  // autre : c'est celle qu'on oublie, et celle qui se voit le plus en boucle.
  const closing = transitionDistance(frames[frames.length - 1]!, frames[0]!);
  if (closing > MAX_TRANSITION) report(frames.length - 1, 0, closing);

  return issues;
}

const toIssue = (error: ErrorObject): ValidationIssue => ({
  path: error.instancePath || '(racine)',
  severity: 'error',
  message: `${error.message ?? 'invalide'}${
    typeof error.params.additionalProperty === 'string'
      ? ` : ${error.params.additionalProperty}`
      : ''
  }${
    Array.isArray(error.params.missingProperty) || typeof error.params.missingProperty === 'string'
      ? ` : ${String(error.params.missingProperty)}`
      : ''
  }`,
});

/**
 * Compile le schema une fois et renvoie un validateur reutilisable.
 * Compiler a chaque appel couterait plus cher que la validation elle-meme.
 */
export function createAnimationValidator(schema: object): (data: unknown) => ValidationResult {
  const AjvClass = (Ajv2020 as unknown as { default?: typeof Ajv2020 }).default ?? Ajv2020;
  const ajv = new AjvClass({ allErrors: true, strict: false });
  const validateSchema: ValidateFunction = ajv.compile(schema);

  return (data: unknown): ValidationResult => {
    const summarize = (issues: readonly ValidationIssue[]): ValidationResult => {
      const errors = issues.filter((issue) => issue.severity === 'error');
      return {
        valid: errors.length === 0,
        issues,
        errors,
        warnings: issues.filter((issue) => issue.severity === 'warning'),
      };
    };

    // Une forme invalide rend les controles de coherence inexploitables : on
    // s'arrete la plutot que de deverser des erreurs derivees.
    if (!validateSchema(data)) {
      return summarize((validateSchema.errors ?? []).map(toIssue));
    }

    const frames = (data as { frames: readonly Frame[] }).frames;
    return summarize([...checkSkeleton(frames), ...checkContinuity(frames)]);
  };
}
