import { useEffect, useRef, type ReactNode } from 'react';

export interface ConfirmRequest {
  readonly title: string;
  readonly body: ReactNode;
  readonly confirmLabel: string;
  /** `danger` : bannir, couper. Le bouton de confirmation se colore. */
  readonly tone?: 'danger' | 'normal';
  readonly onConfirm: () => void;
}

/**
 * Une confirmation explicite avant toute ecriture.
 *
 * Le focus part sur « Annuler » : une touche Entree reflexe ne doit pas
 * bannir quelqu'un. Echap ferme.
 */
export function ConfirmDialog({
  request,
  busy,
  onCancel,
}: {
  readonly request: ConfirmRequest | null;
  readonly busy: boolean;
  readonly onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (request === null) return undefined;
    cancelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [request, onCancel]);

  if (request === null) return null;
  return (
    <div className="confirm">
      <div
        className="confirm__panel"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-body"
      >
        <h2 className="confirm__title" id="confirm-title">
          {request.title}
        </h2>
        <div className="confirm__body" id="confirm-body">
          {request.body}
        </div>
        <div className="confirm__actions">
          <button
            type="button"
            className="btn btn--ghost"
            ref={cancelRef}
            onClick={onCancel}
            disabled={busy}
          >
            Annuler
          </button>
          <button
            type="button"
            className={request.tone === 'danger' ? 'btn btn--danger' : 'btn btn--primary'}
            onClick={request.onConfirm}
            disabled={busy}
          >
            {busy ? 'Envoi…' : request.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
