import { useCallback, useState } from 'react';
import type { AdminApi } from '../api/client.js';
import type { AdminFlagState, AdminFlagUpdateRequest, AdminFlagsResponse } from '../api/types.js';
import { dateTime, flagName } from '../app/format.js';
import { optionalReason, parseRollout, REASON_MAX } from '../app/forms.js';
import { useResource, useWrite, type Notice, type Resource } from '../app/resource.js';
import { ConfirmDialog, type ConfirmRequest } from '../ui/ConfirmDialog.js';
import { Empty, ErrorBox, Loading, NoticeBar } from '../ui/states.js';

function FlagCard({
  flag,
  busy,
  onAction,
}: {
  readonly flag: AdminFlagState;
  readonly busy: boolean;
  readonly onAction: (flag: AdminFlagState, request: AdminFlagUpdateRequest) => void;
}) {
  const [reason, setReason] = useState('');
  const [measureOpen, setMeasureOpen] = useState(false);
  const [rollout, setRollout] = useState(String(flag.measureRollout));
  const [error, setError] = useState<string | null>(null);
  const paused = flag.rollout === 0;
  const base = `flag-${flag.flag}`;

  const submit = (build: (reason: string | undefined) => AdminFlagUpdateRequest | string) => {
    const checkedReason = optionalReason(reason);
    if (!checkedReason.ok) {
      setError(checkedReason.error);
      return;
    }
    const request = build(checkedReason.value);
    if (typeof request === 'string') {
      setError(request);
      return;
    }
    setError(null);
    onAction(flag, request);
  };

  const withReason = <T extends object>(
    body: T,
    r: string | undefined,
  ): T | (T & { reason: string }) => (r === undefined ? body : { ...body, reason: r });

  return (
    <article className="flag" aria-labelledby={`${base}-name`}>
      <header className="flag__head">
        <h2 className="flag__name" id={`${base}-name`}>
          {flagName(flag.flag)}
          <code className="flag__id">{flag.flag}</code>
        </h2>
        <span className={paused ? 'pill pill--down' : 'pill pill--ok'}>
          {paused ? 'Coupé' : 'Actif'}
        </span>
      </header>
      <dl className="stats stats--row">
        <div className="stat">
          <dt className="stat__label">Part en vigueur</dt>
          <dd className="stat__value">{flag.rollout} %</dd>
        </div>
        <div className="stat">
          <dt className="stat__label">Mesure en cours</dt>
          <dd className="stat__value">
            n°{flag.epoch} · {flag.measureRollout} %
          </dd>
        </div>
        <div className="stat">
          <dt className="stat__label">Début de la mesure</dt>
          <dd className="stat__value">{dateTime(flag.measureStartedAt)}</dd>
        </div>
      </dl>

      <div className="field">
        <label className="field__label" htmlFor={`${base}-reason`}>
          Motif <span className="field__hint">(facultatif, journalisé)</span>
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

      <div className="flag__actions">
        <button
          type="button"
          className="btn btn--danger"
          disabled={busy || paused}
          onClick={() => submit((r) => withReason({ action: 'pause' as const }, r))}
        >
          Couper
        </button>
        <button
          type="button"
          className="btn btn--primary"
          disabled={busy || !paused}
          onClick={() => submit((r) => withReason({ action: 'resume' as const }, r))}
        >
          Rallumer à {flag.measureRollout} %
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          aria-expanded={measureOpen}
          aria-controls={`${base}-measure`}
          onClick={() => setMeasureOpen((open) => !open)}
        >
          Nouvelle mesure…
        </button>
      </div>

      {measureOpen ? (
        <div className="flag__measure" id={`${base}-measure`}>
          <div className="field field--narrow">
            <label className="field__label" htmlFor={`${base}-rollout`}>
              Part exposée de la nouvelle mesure (1 à 100 %)
            </label>
            <input
              className="field__input"
              id={`${base}-rollout`}
              type="number"
              inputMode="numeric"
              min={1}
              max={100}
              step={1}
              value={rollout}
              onChange={(e) => setRollout(e.target.value)}
            />
          </div>
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy}
            onClick={() =>
              submit((r) => {
                const checked = parseRollout(rollout);
                if (!checked.ok) return checked.error;
                return withReason({ action: 'new-measure' as const, rollout: checked.value }, r);
              })
            }
          >
            Ouvrir la mesure n°{flag.epoch + 1}
          </button>
        </div>
      ) : null}

      {error === null ? null : (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}
    </article>
  );
}

export interface ExperimentsViewProps {
  readonly state: Resource<AdminFlagsResponse>;
  readonly busy: boolean;
  readonly notice: Notice;
  readonly onDismiss: () => void;
  readonly onRetry: () => void;
  readonly onAction: (flag: AdminFlagState, request: AdminFlagUpdateRequest) => void;
}

export function ExperimentsView({
  state,
  busy,
  notice,
  onDismiss,
  onRetry,
  onAction,
}: ExperimentsViewProps) {
  return (
    <div className="page">
      <header className="page__head">
        <h1 className="page__title">Expériences</h1>
        <p className="page__sub">
          Couper, rallumer, ou ouvrir une nouvelle mesure. On ne change jamais la part d’une mesure
          en cours : cela mélangerait les groupes.
        </p>
      </header>
      <NoticeBar notice={notice} onDismiss={onDismiss} />
      {state.status === 'loading' ? (
        <Loading />
      ) : state.status === 'error' ? (
        <ErrorBox message={state.error} onRetry={onRetry} />
      ) : state.data.flags.length === 0 ? (
        <Empty>Aucun drapeau déclaré par le serveur.</Empty>
      ) : (
        <div className="stack">
          {state.data.flags.map((flag) => (
            <FlagCard
              key={`${flag.flag}-${flag.epoch}-${flag.rollout}`}
              flag={flag}
              busy={busy}
              onAction={onAction}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Le texte de confirmation d'un geste sur un drapeau. */
export function describeFlagAction(
  flag: AdminFlagState,
  request: AdminFlagUpdateRequest,
): ConfirmRequest['body'] {
  const name = flagName(flag.flag);
  switch (request.action) {
    case 'pause':
      return (
        <p>
          <strong>{name}</strong> passe à 0 % : plus personne n’est exposé. La mesure n°{flag.epoch}{' '}
          reste ouverte ; « Rallumer » la reprendra à {flag.measureRollout} %.
        </p>
      );
    case 'resume':
      return (
        <p>
          <strong>{name}</strong> repart à {flag.measureRollout} %, la part de la mesure n°
          {flag.epoch}.
        </p>
      );
    case 'new-measure':
      return (
        <>
          <p>
            <strong>{name}</strong> ouvre la mesure n°{flag.epoch + 1} à {request.rollout} %.
          </p>
          <p className="confirm__warn">
            La nouvelle mesure repart de zéro : les joueurs sont réaffectés, les inscriptions et les
            chiffres de la mesure n°{flag.epoch} ne s’y mélangent pas. Ce geste ne se défait pas.
          </p>
        </>
      );
  }
}

const TITLES: Readonly<Record<AdminFlagUpdateRequest['action'], string>> = {
  pause: 'Couper l’expérience ?',
  resume: 'Rallumer l’expérience ?',
  'new-measure': 'Ouvrir une nouvelle mesure ?',
};
const LABELS: Readonly<Record<AdminFlagUpdateRequest['action'], string>> = {
  pause: 'Couper',
  resume: 'Rallumer',
  'new-measure': 'Ouvrir la mesure',
};
const DONE: Readonly<Record<AdminFlagUpdateRequest['action'], string>> = {
  pause: 'coupée',
  resume: 'rallumée',
  'new-measure': 'nouvelle mesure ouverte',
};

export function ExperimentsPage({ api }: { readonly api: AdminApi }) {
  const { state, reload } = useResource(api.flags, 'flags');
  const write = useWrite(reload);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const cancel = useCallback(() => setConfirm(null), []);

  const onAction = (flag: AdminFlagState, request: AdminFlagUpdateRequest) =>
    setConfirm({
      title: TITLES[request.action],
      body: describeFlagAction(flag, request),
      confirmLabel: LABELS[request.action],
      tone: request.action === 'resume' ? 'normal' : 'danger',
      onConfirm: () => {
        void write
          .run(
            () => api.updateFlag(flag.flag, request),
            `${flagName(flag.flag)} : ${DONE[request.action]}.`,
          )
          .then(() => setConfirm(null));
      },
    });

  return (
    <>
      <ExperimentsView
        state={state}
        busy={write.busy}
        notice={write.notice}
        onDismiss={write.dismiss}
        onRetry={reload}
        onAction={onAction}
      />
      <ConfirmDialog request={confirm} busy={write.busy} onCancel={cancel} />
    </>
  );
}
