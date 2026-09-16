import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { BALANCE, runTournament, STRATEGY_IDS, type TournamentReport } from '../src/index.js';

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

function thresholdsOf(report: TournamentReport): readonly Threshold[] {
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
  ];
}

const report = runTournament({ matches, seed: values.seed ?? 'sim' });
const checks = thresholdsOf(report);
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
  writeFileSync(values.out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`\n  Rapport JSON ecrit dans ${values.out}`);
}

if (failures.length > 0) {
  console.log(`\n  ${failures.length} mesure(s) hors de la zone saine.\n`);
  process.exit(1);
}

console.log('\n  Toutes les mesures sont dans la zone saine.\n');
