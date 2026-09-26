import { useState } from 'react';
import type { AdminApi } from '../api/client.js';
import type { AdminAuditResponse } from '../api/types.js';
import { dateTime, prettyJson } from '../app/format.js';
import { useDebounced, useResource, type Resource } from '../app/resource.js';
import { Empty, ErrorBox, Loading } from '../ui/states.js';

/** Les actions que le serveur journalise (contrat admin.ts) ; le filtre les propose. */
export const AUDIT_ACTIONS: readonly { readonly id: string; readonly label: string }[] = [
  { id: 'flag.pause', label: 'Expérience coupée' },
  { id: 'flag.resume', label: 'Expérience rallumée' },
  { id: 'flag.new-measure', label: 'Nouvelle mesure' },
  { id: 'event.override', label: 'Événement forcé' },
  { id: 'player.ban', label: 'Bannissement' },
  { id: 'player.unban', label: 'Levée de bannissement' },
];

export const actionLabel = (id: string): string =>
  AUDIT_ACTIONS.find((a) => a.id === id)?.label ?? id;

export interface AuditViewProps {
  readonly state: Resource<AdminAuditResponse>;
  readonly action: string;
  readonly target: string;
  readonly onAction: (action: string) => void;
  readonly onTarget: (target: string) => void;
  readonly onRetry: () => void;
}

export function AuditView({ state, action, target, onAction, onTarget, onRetry }: AuditViewProps) {
  return (
    <div className="page">
      <header className="page__head">
        <h1 className="page__title">Journal d’administration</h1>
        <p className="page__sub">
          Les 100 dernières actions. Un seul secret : le journal dit quoi, pas qui.
        </p>
      </header>
      <form className="filters" onSubmit={(e) => e.preventDefault()}>
        <div className="field">
          <label className="field__label" htmlFor="audit-action">
            Action
          </label>
          <select
            className="field__input"
            id="audit-action"
            value={action}
            onChange={(e) => onAction(e.target.value)}
          >
            <option value="">Toutes</option>
            {AUDIT_ACTIONS.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="field__label" htmlFor="audit-target">
            Cible
          </label>
          <input
            className="field__input"
            id="audit-target"
            type="search"
            maxLength={80}
            placeholder="identifiant de joueur, drapeau, semaine…"
            value={target}
            onChange={(e) => onTarget(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
      </form>
      {state.status === 'loading' ? (
        <Loading />
      ) : state.status === 'error' ? (
        <ErrorBox message={state.error} onRetry={onRetry} />
      ) : state.data.actions.length === 0 ? (
        <Empty>
          Aucune action
          {action !== '' || target.trim() !== '' ? ' pour ces filtres' : ' journalisée'}.
        </Empty>
      ) : (
        <ol className="audit">
          {state.data.actions.map((a) => (
            <li className="audit__item" key={a.id}>
              <div className="audit__head">
                <time className="audit__at" dateTime={a.at}>
                  {dateTime(a.at)}
                </time>
                <span className="audit__action">{actionLabel(a.action)}</span>
                <code className="audit__target">{a.target}</code>
              </div>
              <p className="audit__reason">
                {a.reason === null ? 'Sans motif.' : `Motif : ${a.reason}`}
              </p>
              <details className="audit__diff">
                <summary className="audit__summary">Avant / après</summary>
                <div className="audit__cols">
                  <div>
                    <p className="audit__label">Avant</p>
                    <pre className="audit__json">{prettyJson(a.before)}</pre>
                  </div>
                  <div>
                    <p className="audit__label">Après</p>
                    <pre className="audit__json">{prettyJson(a.after)}</pre>
                  </div>
                </div>
              </details>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function AuditPage({ api }: { readonly api: AdminApi }) {
  const [action, setAction] = useState('');
  const [target, setTarget] = useState('');
  const settledTarget = useDebounced(target.trim(), 300);
  const { state, reload } = useResource(
    () => api.audit({ action, target: settledTarget }),
    `audit:${action}:${settledTarget}`,
  );
  return (
    <AuditView
      state={state}
      action={action}
      target={target}
      onAction={setAction}
      onTarget={setTarget}
      onRetry={reload}
    />
  );
}
