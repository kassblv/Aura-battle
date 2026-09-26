import { useCallback, useState } from 'react';
import type { AdminApi } from '../api/client.js';
import type { AdminEventsResponse, AdminWeekEvent } from '../api/types.js';
import { utcDay, WEEK_MS } from '../app/format.js';
import { optionalReason, REASON_MAX } from '../app/forms.js';
import { useResource, useWrite, type Notice, type Resource } from '../app/resource.js';
import { ConfirmDialog, type ConfirmRequest } from '../ui/ConfirmDialog.js';
import { Empty, ErrorBox, Loading, NoticeBar } from '../ui/states.js';

export const NORMAL = 'normal';

type Variants = AdminEventsResponse['variants'];

/** Le nom d'une variante ; `normal` se dit « Normale », une inconnue s'affiche telle quelle. */
export function variantName(id: string, variants: Variants): string {
  if (id === NORMAL) return 'Normale';
  return variants.find((v) => v.id === id)?.name ?? id;
}

/** Les choix du formulaire : les variantes du serveur, plus « Normale » si elle n'y est pas deja. */
export function variantChoices(variants: Variants): Variants {
  return variants.some((v) => v.id === NORMAL)
    ? variants
    : [...variants, { id: NORMAL, name: 'Normale' }];
}

export function isCurrentWeek(week: AdminWeekEvent, nowMs: number): boolean {
  const start = Date.parse(week.startsAt);
  return nowMs >= start && nowMs < start + WEEK_MS;
}

/** Une override : forcer une variante (`string`) ou revenir a la rotation (`null`). */
export interface EventIntent {
  readonly week: AdminWeekEvent;
  readonly variant: string | null;
  readonly reason: string | undefined;
}

function WeekCard({
  week,
  variants,
  current,
  busy,
  onIntent,
}: {
  readonly week: AdminWeekEvent;
  readonly variants: Variants;
  readonly current: boolean;
  readonly busy: boolean;
  readonly onIntent: (intent: EventIntent) => void;
}) {
  const choices = variantChoices(variants);
  const [variant, setVariant] = useState(week.variant);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const base = `week-${week.week}`;
  const ends = new Date(Date.parse(week.startsAt) + WEEK_MS - 1).toISOString();

  const send = (target: string | null) => {
    const checked = optionalReason(reason);
    if (!checked.ok) {
      setError(checked.error);
      return;
    }
    setError(null);
    onIntent({ week, variant: target, reason: checked.value });
  };

  return (
    <article className={current ? 'week week--current' : 'week'} aria-labelledby={`${base}-title`}>
      <header className="week__head">
        <h2 className="week__title" id={`${base}-title`}>
          Semaine {week.week}
          {current ? <span className="pill pill--gold">En cours</span> : null}
        </h2>
        <p className="week__dates">
          du {utcDay(week.startsAt)} au {utcDay(ends)}
        </p>
      </header>
      <p className="week__variant">
        <span className="week__variant-name">{variantName(week.variant, variants)}</span>
        <span className={week.source === 'override' ? 'pill pill--warn' : 'pill pill--muted'}>
          {week.source === 'override' ? 'Forcée' : 'Rotation'}
        </span>
      </p>
      <div className="week__form">
        <div className="field">
          <label className="field__label" htmlFor={`${base}-variant`}>
            Variante à forcer
          </label>
          <select
            className="field__input"
            id={`${base}-variant`}
            value={variant}
            onChange={(e) => setVariant(e.target.value)}
          >
            {choices.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="field__label" htmlFor={`${base}-reason`}>
            Motif <span className="field__hint">(facultatif)</span>
          </label>
          <input
            className="field__input"
            id={`${base}-reason`}
            type="text"
            maxLength={REASON_MAX}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            autoComplete="off"
          />
        </div>
      </div>
      <div className="week__actions">
        <button
          type="button"
          className="btn btn--primary"
          disabled={busy}
          onClick={() => send(variant)}
        >
          Forcer
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          disabled={busy || week.source === 'rotation'}
          onClick={() => send(null)}
        >
          Revenir à la rotation
        </button>
      </div>
      {error === null ? null : (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}
    </article>
  );
}

export interface EventsViewProps {
  readonly state: Resource<AdminEventsResponse>;
  readonly nowMs: number;
  readonly busy: boolean;
  readonly notice: Notice;
  readonly onDismiss: () => void;
  readonly onRetry: () => void;
  readonly onIntent: (intent: EventIntent) => void;
}

export function EventsView({
  state,
  nowMs,
  busy,
  notice,
  onDismiss,
  onRetry,
  onIntent,
}: EventsViewProps) {
  return (
    <div className="page">
      <header className="page__head">
        <h1 className="page__title">Événements de la semaine</h1>
        <p className="page__sub">
          Semaine en cours et quatre suivantes (semaines UTC, du lundi). Le serveur décide à
          l’ouverture de chaque match ; le classé n’est jamais concerné.
        </p>
      </header>
      <NoticeBar notice={notice} onDismiss={onDismiss} />
      {state.status === 'loading' ? (
        <Loading />
      ) : state.status === 'error' ? (
        <ErrorBox message={state.error} onRetry={onRetry} />
      ) : state.data.weeks.length === 0 ? (
        <Empty>Le serveur n’a renvoyé aucune semaine.</Empty>
      ) : (
        <div className="weeks">
          {state.data.weeks.map((week) => (
            <WeekCard
              key={`${week.week}-${week.variant}-${week.source}`}
              week={week}
              variants={state.data.variants}
              current={isCurrentWeek(week, nowMs)}
              busy={busy}
              onIntent={onIntent}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function EventsPage({ api }: { readonly api: AdminApi }) {
  const { state, reload } = useResource(api.events, 'events');
  const write = useWrite(reload);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const cancel = useCallback(() => setConfirm(null), []);
  const variants = state.status === 'ready' ? state.data.variants : [];

  const onIntent = ({ week, variant, reason }: EventIntent) => {
    const target = variant === null ? 'la rotation' : `« ${variantName(variant, variants)} »`;
    setConfirm({
      title: variant === null ? 'Revenir à la rotation ?' : 'Forcer la variante ?',
      body: (
        <p>
          Semaine {week.week} (à partir du {utcDay(week.startsAt)}) : <strong>{target}</strong> au
          lieu de « {variantName(week.variant, variants)} ». Les matchs déjà ouverts ne changent
          pas.
        </p>
      ),
      confirmLabel: variant === null ? 'Revenir à la rotation' : 'Forcer',
      onConfirm: () => {
        void write
          .run(
            () =>
              api.overrideEvent(
                week.week,
                reason === undefined ? { variant } : { variant, reason },
              ),
            `Semaine ${week.week} : ${variant === null ? 'retour à la rotation' : `${variantName(variant, variants)} forcée`}.`,
          )
          .then(() => setConfirm(null));
      },
    });
  };

  return (
    <>
      <EventsView
        state={state}
        nowMs={Date.now()}
        busy={write.busy}
        notice={write.notice}
        onDismiss={write.dismiss}
        onRetry={reload}
        onIntent={onIntent}
      />
      <ConfirmDialog request={confirm} busy={write.busy} onCancel={cancel} />
    </>
  );
}
