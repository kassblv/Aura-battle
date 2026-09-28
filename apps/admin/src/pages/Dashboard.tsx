import type { ReactNode } from 'react';
import type { AdminApi } from '../api/client.js';
import type {
  AdminStatus,
  ExperimentGroupReading,
  ExperimentReport,
  IndicatorReport,
  Measure,
  RechargeInputReading,
  Unit,
  Verdict,
} from '../api/dashboard.js';
import {
  ago,
  duration,
  flagName,
  gap,
  measure,
  number,
  signedPercent,
  time,
} from '../app/format.js';
import { useResource, type Resource } from '../app/resource.js';
import { Empty, ErrorBox, Loading } from '../ui/states.js';

const VERDICT_LABEL: Readonly<Record<Verdict, string>> = {
  ok: 'OK',
  warn: 'À surveiller',
  down: 'En panne',
};
const INDICATOR_VERDICT: Readonly<
  Record<IndicatorReport['indicators'][number]['verdict'], string>
> = {
  met: 'atteint',
  missed: 'manqué',
  insufficient: 'échantillon insuffisant',
};

const GROUPS: readonly (readonly ['treatment' | 'control', string])[] = [
  ['treatment', 'Exposé'],
  ['control', 'Témoin'],
];
const MEASURES: readonly (readonly [
  keyof Omit<ExperimentGroupReading, 'players'>,
  string,
  Unit,
])[] = [
  ['retentionD1', 'Rétention J1', 'ratio'],
  ['retentionD7', 'Rétention J7', 'ratio'],
  ['matchesPerActiveDay', 'Matchs PvP par actif et par jour', 'perDay'],
  ['abandonRate', 'Taux d’abandon', 'ratio'],
];

const withN = (m: Measure, unit: Unit): string => `${measure(m.value, unit)} (n = ${m.n})`;

/** Meme seuil que le verdict des indicateurs (serveur, `MIN_SAMPLE`). */
const MIN_SAMPLE = 20;

const INPUT_MODES: readonly (readonly ['touch' | 'keys', string])[] = [
  ['touch', 'Tactile'],
  ['keys', 'Clavier'],
];

/**
 * Equite clavier contre tactile (docs/10) : le mode vient du client, les
 * points du serveur. Une comparaison, sans seuil ni verdict.
 */
function RechargeInput({
  reading,
}: {
  readonly reading: Readonly<Record<'touch' | 'keys', RechargeInputReading>>;
}) {
  const spread = gap(reading.keys.avgPointsPerRecharge, reading.touch.avgPointsPerRecharge);
  const thin = Math.min(reading.touch.playerMatches, reading.keys.playerMatches) < MIN_SAMPLE;
  return (
    <>
      <h3 className="recharge-input__title">Recharge : clavier contre tactile</h3>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Mode</th>
              <th scope="col" className="table__num">
                Joueurs-matchs
              </th>
              <th scope="col" className="table__num">
                Points par recharge
              </th>
            </tr>
          </thead>
          <tbody>
            {INPUT_MODES.map(([id, label]) => (
              <tr key={id}>
                <th scope="row">{label}</th>
                <td className="table__num table__muted">{reading[id].playerMatches}</td>
                <td className="table__num table__strong">
                  {reading[id].avgPointsPerRecharge === null
                    ? '—'
                    : number(reading[id].avgPointsPerRecharge, 1)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="note">
        Écart clavier / tactile : <strong>{signedPercent(spread)}</strong>
        {thin ? ' · Recharge : échantillon insuffisant (moins de 20 joueurs-matchs d’un côté)' : ''}
        . Matchs PvP terminés sur 7 jours ; points calculés par le serveur, mode déclaré par
        l’appareil.
      </p>
    </>
  );
}

function Stat({ label, value }: { readonly label: string; readonly value: string | number }) {
  return (
    <div className="stat">
      <dt className="stat__label">{label}</dt>
      <dd className="stat__value">{value}</dd>
    </div>
  );
}

function StatusCards({ status, nowMs }: { readonly status: AdminStatus; readonly nowMs: number }) {
  const db = status.database;
  return (
    <>
      <div className="grid">
        <section className="card" aria-labelledby="dash-health">
          <h2 className="card__title" id="dash-health">
            Santé
            <span className={`pill pill--${status.overall}`}>{VERDICT_LABEL[status.overall]}</span>
          </h2>
          <ul className="health">
            {status.components.map((c) => (
              <li className="health__line" key={c.name}>
                <span className={`dot dot--${c.verdict}`} aria-hidden="true" />
                <span className="health__name">{c.name}</span>
                <span className="sr-only">{VERDICT_LABEL[c.verdict]}</span>
                <span className="health__detail">{c.detail}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="card" aria-labelledby="dash-numbers">
          <h2 className="card__title" id="dash-numbers">
            Chiffres
          </h2>
          <dl className="stats">
            <Stat label="Joueurs" value={db?.players ?? '—'} />
            <Stat label="Classés" value={db?.rankedPlayers ?? '—'} />
            <Stat label="Matchs (24 h)" value={db?.matchesLastDay ?? '—'} />
            <Stat label="Matchs au total" value={db?.matchesTotal ?? '—'} />
          </dl>
        </section>
        <section className="card" aria-labelledby="dash-server">
          <h2 className="card__title" id="dash-server">
            Serveur
          </h2>
          <dl className="stats">
            <Stat label="Debout depuis" value={duration(status.uptimeSeconds)} />
            <Stat label="Commit" value={status.commit} />
            <Stat
              label="Image construite"
              value={status.builtAt === null ? 'inconnue' : ago(status.builtAt, nowMs)}
            />
            <Stat label="Erreurs (24 h)" value={status.errors.total} />
          </dl>
        </section>
      </div>
      <section className="card" aria-labelledby="dash-errors">
        <h2 className="card__title" id="dash-errors">
          Erreurs (24 h)
        </h2>
        {status.errors.recent.length === 0 ? (
          <Empty>Aucune erreur.</Empty>
        ) : (
          <ul className="errors">
            {status.errors.recent.map((e, i) => (
              <li className="errors__line" key={`${e.at}-${i}`}>
                <time className="errors__at" dateTime={e.at}>
                  {time(e.at)}
                </time>
                {e.message}
              </li>
            ))}
          </ul>
        )}
        <p className="note">
          Le compteur d’erreurs vit en mémoire : il repart de zéro à chaque redémarrage. Il se lit à
          côté de la durée de fonctionnement.
        </p>
      </section>
    </>
  );
}

function Indicators({ report }: { readonly report: IndicatorReport }) {
  if (report.indicators.length === 0) return <Empty>Aucun indicateur calculé.</Empty>;
  return (
    <>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Indicateur</th>
              <th scope="col" className="table__num">
                Valeur
              </th>
              <th scope="col" className="table__num">
                Effectif
              </th>
              <th scope="col" className="table__num">
                Seuil
              </th>
              <th scope="col" className="table__num">
                Verdict
              </th>
            </tr>
          </thead>
          <tbody>
            {report.indicators.map((i) => (
              <tr key={i.id}>
                <th scope="row">{i.label}</th>
                <td className="table__num table__strong">{measure(i.value, i.unit)}</td>
                <td className="table__num table__muted">n = {i.n}</td>
                <td className="table__num table__muted">
                  {i.comparison === 'gte' ? '≥ ' : '≤ '}
                  {measure(i.threshold, i.unit)}
                </td>
                <td className="table__num">
                  <span className={`verdict verdict--${i.verdict}`}>
                    {INDICATOR_VERDICT[i.verdict]}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="note">
        Matchs contre un fantôme (7 jours) : {withN(report.ghostShare, 'ratio')} · calculé{' '}
        {time(report.at)}. Jours UTC, jour en cours exclu. Seuils de docs/00-vision.md. Sous 20
        observations, aucun verdict.
      </p>
      <RechargeInput reading={report.rechargeInput} />
    </>
  );
}

function Experiments({ report }: { readonly report: ExperimentReport }) {
  if (report.experiments.length === 0) return <Empty>Aucune expérience en cours.</Empty>;
  return (
    <>
      {report.experiments.map((x) => (
        <div className="experiment" key={x.flag}>
          <h3 className="experiment__title">
            {flagName(x.flag)}{' '}
            <span className="experiment__meta">· part exposée {x.rollout} %</span>
          </h3>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Mesure</th>
                  {GROUPS.map(([id, label]) => (
                    <th scope="col" className="table__num" key={id}>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Joueurs affectés</th>
                  {GROUPS.map(([id]) => (
                    <td className="table__num table__strong" key={id}>
                      {x.groups[id].players}
                    </td>
                  ))}
                </tr>
                {MEASURES.map(([key, label, unit]) => (
                  <tr key={key}>
                    <th scope="row">{label}</th>
                    {GROUPS.map(([id]) => (
                      <td className="table__num" key={id}>
                        {withN(x.groups[id][key], unit)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      <p className="note">
        Mesure en cours de chaque drapeau. Mêmes définitions que les indicateurs, restreintes aux
        joueurs du groupe. Calculé {time(report.at)}.
      </p>
    </>
  );
}

function Section<T>({
  id,
  title,
  state,
  onRetry,
  children,
}: {
  readonly id: string;
  readonly title: string;
  readonly state: Resource<T>;
  readonly onRetry: () => void;
  readonly children: (data: T) => ReactNode;
}) {
  return (
    <section className="card" aria-labelledby={id}>
      <h2 className="card__title" id={id}>
        {title}
      </h2>
      {state.status === 'loading' ? (
        <Loading />
      ) : state.status === 'error' ? (
        <ErrorBox message={state.error} onRetry={onRetry} />
      ) : (
        children(state.data)
      )}
    </section>
  );
}

export interface DashboardViewProps {
  readonly status: Resource<AdminStatus>;
  readonly indicators: Resource<IndicatorReport>;
  readonly experiments: Resource<ExperimentReport>;
  readonly nowMs: number;
  readonly onRetry: () => void;
}

export function DashboardView({
  status,
  indicators,
  experiments,
  nowMs,
  onRetry,
}: DashboardViewProps) {
  return (
    <div className="page">
      <header className="page__head">
        <h1 className="page__title">Tableau de bord</h1>
        <p className="page__sub">
          {status.status === 'ready'
            ? `Santé rafraîchie toutes les 15 s · ${time(new Date(nowMs).toISOString())}`
            : ' '}
        </p>
      </header>
      {status.status === 'loading' ? (
        <Loading label="Lecture de l’état du serveur…" />
      ) : status.status === 'error' ? (
        <ErrorBox message={status.error} onRetry={onRetry} />
      ) : (
        <StatusCards status={status.data} nowMs={nowMs} />
      )}
      <Section
        id="dash-indicators"
        title="Indicateurs produit"
        state={indicators}
        onRetry={onRetry}
      >
        {(data) => <Indicators report={data} />}
      </Section>
      <Section id="dash-experiments" title="Expériences" state={experiments} onRetry={onRetry}>
        {(data) => <Experiments report={data} />}
      </Section>
    </div>
  );
}

export function DashboardPage({ api }: { readonly api: AdminApi }) {
  // Quinze secondes pour la sante ; cinq minutes pour les agregats, qui
  // bougent a l'echelle du jour et pesent sur toute la base.
  const status = useResource(api.status, 'status', 15_000);
  const indicators = useResource(api.indicators, 'indicators', 300_000);
  const experiments = useResource(api.experiments, 'experiments', 300_000);
  const retry = () => {
    status.reload();
    indicators.reload();
    experiments.reload();
  };
  return (
    <DashboardView
      status={status.state}
      indicators={indicators.state}
      experiments={experiments.state}
      nowMs={Date.now()}
      onRetry={retry}
    />
  );
}
