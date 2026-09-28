import type { JSX } from 'react';
import type { ConnectionStatus } from '../net/connection.js';

/**
 * L attente d un adversaire.
 *
 * Un ecran d attente doit dire **ou on en est**, pas tourner. Le temps ecoule
 * et la fourchette de recherche viennent du serveur : montrer une fourchette
 * qui s elargit explique pourquoi l attente dure sans avoir a s en excuser.
 */

export interface QueueProps {
  readonly status: ConnectionStatus;
  readonly elapsedMs: number;
  /** Largeur de la fenetre de recherche, en points de classement. */
  readonly searchRange: number;
  readonly onCancel: () => void;
}

const LINK_LABEL: Readonly<Record<ConnectionStatus, string>> = {
  offline: 'Hors ligne',
  connecting: 'Connexion…',
  reconnecting: 'Reconnexion…',
  online: 'En ligne',
};

export function QueueScreen({ status, elapsedMs, searchRange, onCancel }: QueueProps): JSX.Element {
  const seconds = Math.floor(elapsedMs / 1000);
  return (
    <section className="queue" aria-label="Recherche d’un adversaire">
      <div className="queue__panel">
        <p className="queue__link" data-status={status}>
          {LINK_LABEL[status]}
        </p>
        <h2 className="queue__title">Recherche d’un adversaire</h2>
        <p className="queue__timer">
          {String(Math.floor(seconds / 60)).padStart(2, '0')}:
          {String(seconds % 60).padStart(2, '0')}
        </p>
        <p className="queue__range">
          {searchRange > 0
            ? `Fenêtre élargie à ±${String(searchRange)} points`
            : 'À ton niveau exact'}
        </p>
        <button type="button" className="queue__cancel" onClick={onCancel}>
          Annuler
        </button>
      </div>
    </section>
  );
}
