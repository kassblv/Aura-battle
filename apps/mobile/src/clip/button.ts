import type { ShareOutcome } from './share.js';

/**
 * Ce que dit le bouton « Partager le clip », en fonction pure.
 *
 * Le bouton n apparait que s il y a un clip, ou un clip en preparation : un
 * bouton qui promet une video absente apprend a ne plus le toucher.
 */

/** Ou en est le clip de la derniere manche gagnee. */
export type ClipStatus = 'none' | 'recording' | 'encoding' | 'ready';

/** Ce que le dernier appui a donne ; `idle` avant tout appui. */
export type ShareFeedback = 'idle' | 'sharing' | ShareOutcome;

export interface ClipButton {
  readonly label: string;
  readonly disabled: boolean;
  /** Pour la feuille de style : un succes et un echec ne se peignent pas pareil. */
  readonly tone: 'idle' | 'busy' | 'done' | 'error';
}

export function clipButton(status: ClipStatus, feedback: ShareFeedback): ClipButton | null {
  if (status === 'none') return null;
  if (status !== 'ready') return { label: 'Préparation…', disabled: true, tone: 'busy' };
  switch (feedback) {
    case 'sharing':
      return { label: 'Partage…', disabled: true, tone: 'busy' };
    case 'shared':
      return { label: '✓ Clip partagé', disabled: false, tone: 'done' };
    case 'downloaded':
      // Le partage direct n a pas marche : on dit ou est passe le fichier.
      return { label: '✓ Clip téléchargé', disabled: false, tone: 'done' };
    case 'failed':
      return { label: 'Partage impossible', disabled: false, tone: 'error' };
    case 'idle':
    case 'cancelled':
      return { label: '🎬 Partager le clip', disabled: false, tone: 'idle' };
  }
}
