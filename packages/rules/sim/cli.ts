import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import {
  BALANCE,
  measureSkill,
  runTournament,
  STRATEGY_IDS,
  type SkillReport,
  type TournamentReport,
} from '../src/index.js';

/**
 * Simulateur d'equilibrage — `pnpm sim --matches 10000`.
 *
 * Ce fichier vit hors de `src/` a dessein : il a le droit de parler a Node
 * (lire des arguments, ecrire un rapport), alors que le moteur doit rester pur.
 */

const { values } = parseArgs({
  // `pnpm run sim -- --matches 10` transmet le « -- » tel quel : on tolere les
  // arguments positionnels plutot que d'exploser sur un separateur.
  allowPositionals: true,
  options: {
    matches: { type: 'string', short: 'm', default: '10000' },
    seed: { type: 'string', short: 's', default: 'sim' },
    strategy: { type: 'string', default: 'all' },
    out: { type: 'string', short: 'o' },
    // Les duels de skill coutent cinq matchs la ou le tournoi en coute un :
    // par defaut on en joue un dixieme, assez pour lire un ecart de 10 points.
    skill: { type: 'string', default: '' },
  },
});

const matches = Number.parseInt(values.matches ?? '10000', 10);
if (!Number.isInteger(matches) || matches <= 0) {
  console.error(`--matches doit etre un entier positif, recu : ${String(values.matches)}`);
  process.exit(1);
}

/** Seuils de docs/09-testing.md. Hors zone, le rapport le dit et le code sort en erreur. */
interface Threshold {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly format?: (value: number) => string;
}

const percent = (value: number): string => `${(value * 100).toFixed(1)} %`;

function thresholdsOf(report: TournamentReport, skill: SkillReport): readonly Threshold[] {
  const talent = skill.measures.find((measure) => measure.id === 'talent')?.winRate ?? 0.5;
  const styleRates = BALANCE.styles.map((style) => report.winRateByStyle[style]);
  const bestAgainstRandom = Math.max(
    ...STRATEGY_IDS.filter((id) => id !== 'random').map(
      (id) => report.winRateByPair[`${id} vs random`] ?? 0.5,
    ),
  );

  return [
    {
      label: 'Style le plus faible',
      value: Math.min(...styleRates),
      min: 0.47,
      max: 0.53,
      format: percent,
    },
    {
      label: 'Style le plus fort',
      value: Math.max(...styleRates),
      min: 0.47,
      max: 0.53,
      format: percent,
    },
    {
      label: 'Meilleure strategie contre l aleatoire',
      value: bestAgainstRandom,
      min: 0,
      max: 0.8,
      format: percent,
    },
    {
      label: 'Tout sur une manche contre econome',
      value: report.winRateByPair['allin vs thrifty'] ?? 0.5,
      min: 0.4,
      max: 0.6,
      format: percent,
    },
    { label: 'Manches nulles', value: report.drawRoundRate, min: 0, max: 0.03, format: percent },
    {
      label: 'Matchs en trois manches',
      value: (report.finishes.twoOne + report.finishes.tiebreak) / report.matches,
      min: 0.3,
      max: 0.55,
      format: percent,
    },
    {
      label: 'Avantage d un bon timeur',
      value: report.timingAdvantage,
      min: 0.6,
      max: 0.75,
      format: percent,
    },
    /**
     * Le seuil qui garde l'intention produit : « le talent et la reflexion
     * priment ». Il oppose un joueur qui lit et vise juste, avec la moitie du
     * budget, a un joueur previsible et maladroit qui depense le maximum.
     *
     * Sous 55 %, l'energie excedentaire pese plus que le jeu. Au-dessus de
     * 85 %, c'est l'inverse : le budget ne deciderait plus rien et l'un des
     * quatre piliers de docs/00 serait vide. Voir
     * docs/balance/2026-09-17-talent-contre-budget.md.
     */
    { label: 'Talent contre budget', value: talent, min: 0.55, max: 0.85, format: percent },
  ];
}

const seed = values.seed ?? 'sim';
const skillMatches =
  values.skill === undefined || values.skill === ''
    ? Math.max(200, Math.round(matches / 10))
    : Number.parseInt(values.skill, 10);
if (!Number.isInteger(skillMatches) || skillMatches <= 0) {
  console.error(`--skill doit etre un entier positif, recu : ${String(values.skill)}`);
  process.exit(1);
}

const report = runTournament({ matches, seed });
const skill = measureSkill({ matches: skillMatches, seed });
const checks = thresholdsOf(report, skill);
const failures = checks.filter((check) => check.value < check.min || check.value > check.max);

console.log(`\n  Aura Battle — simulation d'equilibrage`);
console.log(`  ${matches} matchs, graine « ${values.seed ?? 'sim'} »\n`);

console.log('  Taux de victoire par strategie');
for (const id of STRATEGY_IDS) {
  console.log(`    ${id.padEnd(22)} ${percent(report.winRateByStrategy[id])}`);
}

console.log('\n  Taux de victoire par style');
for (const style of BALANCE.styles) {
  console.log(`    ${style.padEnd(22)} ${percent(report.winRateByStyle[style])}`);
}

console.log('\n  Taux de victoire par palier');
for (const tier of [0, 1, 2, 3, 4] as const) {
  console.log(`    palier ${tier}               ${percent(report.winRateByTier[tier])}`);
}

console.log('\n  Valeur d un point d energie, par manche');
for (const [round, value] of Object.entries(report.energyValueByRound)) {
  console.log(`    manche ${round}               ${value.toFixed(2)} points de score`);
}

console.log(`\n  Mesure du skill — ${String(skillMatches)} matchs par duel`);
for (const measure of skill.measures) {
  console.log(`    ${measure.name.padEnd(22)} ${percent(measure.winRate)}   ${measure.question}`);
}
console.log(`    ${'(temoin, deux sondes identiques)'.padEnd(22)} ${percent(skill.seatBias)}`);

console.log('\n  Seuils de docs/09-testing.md');
for (const check of checks) {
  const format = check.format ?? String;
  const ok = check.value >= check.min && check.value <= check.max;
  console.log(
    `    ${ok ? 'ok  ' : 'HORS'} ${check.label.padEnd(38)} ${format(check.value).padStart(8)}` +
      `   (attendu ${format(check.min)} – ${format(check.max)})`,
  );
}

if (values.out !== undefined) {
  writeFileSync(values.out, `${JSON.stringify({ ...report, skill }, null, 2)}\n`, 'utf8');
  console.log(`\n  Rapport JSON ecrit dans ${values.out}`);
}

if (failures.length > 0) {
  console.log(`\n  ${failures.length} mesure(s) hors de la zone saine.\n`);
  process.exit(1);
}

console.log('\n  Toutes les mesures sont dans la zone saine.\n');
