import { memo, useEffect, useState, type JSX } from 'react';
import { clipButton, type ShareFeedback } from '../clip/button.js';
import { clipLeftTheGame, shareClip } from '../clip/share.js';
import type { RevealClip } from '../clip/useRevealClip.js';

/**
 * Le bouton « Partager le clip » de l ecran de fin (ADR 0017).
 *
 * Au-dessus des deux gestes de fin, dans l arc du pouce droit, et jamais
 * dans leur rangee : trois boutons cote a cote debordaient sur l annonce des
 * defis en 667 px de large. Il ne pousse donc rien hors de l ecran.
 */
export const ClipShare = memo(function ClipShare({
  clip,
  onShared,
}: {
  readonly clip: RevealClip;
  /** Le clip a quitte le jeu (partage ou telechargement) : la mesure du duel en ligne. */
  readonly onShared?: (() => void) | undefined;
}): JSX.Element | null {
  const [feedback, setFeedback] = useState<ShareFeedback>('idle');
  // Un nouveau clip efface le verdict du precedent partage.
  useEffect(() => {
    setFeedback('idle');
  }, [clip.blob]);

  const button = clipButton(clip.status, feedback);
  if (button === null) return null;

  const share = (): void => {
    const blob = clip.blob;
    if (blob === null || button.disabled) return;
    setFeedback('sharing');
    // Appele dans le geste meme : `navigator.share` l exige.
    void shareClip(blob).then(
      (outcome) => {
        setFeedback(outcome);
        if (clipLeftTheGame(outcome)) onShared?.();
      },
      () => {
        setFeedback('failed');
      },
    );
  };

  return (
    <div className="clipshare" aria-live="polite">
      <button
        type="button"
        className="clipshare__btn"
        data-tone={button.tone}
        disabled={button.disabled}
        onClick={share}
      >
        {button.label}
      </button>
    </div>
  );
});
