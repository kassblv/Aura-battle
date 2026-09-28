import type { ReactNode } from 'react';
import type { Notice } from '../app/resource.js';

export function Loading({ label = 'Chargement…' }: { readonly label?: string }) {
  return (
    <p className="state state--loading" role="status" aria-live="polite">
      <span className="state__spinner" aria-hidden="true" />
      {label}
    </p>
  );
}

export function ErrorBox({
  message,
  onRetry,
}: {
  readonly message: string;
  readonly onRetry?: () => void;
}) {
  return (
    <div className="state state--error" role="alert">
      <p className="state__text">{message}</p>
      {onRetry === undefined ? null : (
        <button type="button" className="btn btn--ghost" onClick={onRetry}>
          Réessayer
        </button>
      )}
    </div>
  );
}

export function Empty({ children }: { readonly children: ReactNode }) {
  return <p className="state state--empty">{children}</p>;
}

/** Le resultat d'une ecriture : `role="alert"` pour une erreur, `status` pour un succes. */
export function NoticeBar({
  notice,
  onDismiss,
}: {
  readonly notice: Notice;
  readonly onDismiss: () => void;
}) {
  if (notice === null) return null;
  const error = notice.kind === 'error';
  return (
    <div
      className={error ? 'notice notice--error' : 'notice notice--success'}
      role={error ? 'alert' : 'status'}
    >
      <p className="notice__text">{notice.text}</p>
      <button
        type="button"
        className="btn btn--ghost btn--small"
        onClick={onDismiss}
        aria-label="Fermer le message"
      >
        Fermer
      </button>
    </div>
  );
}
