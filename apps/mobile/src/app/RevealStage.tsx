import { styleIcon, styleName, tierName } from '@aura/content';
import { memo, useEffect, useRef, useState, type CSSProperties, type JSX } from 'react';
import type { AudioCue } from '../audio/cues.js';
import { multiplierLabel } from '../match/rules.js';
import type { RevealCallout, RevealCard, RevealScene } from './reveal.js';

/**
 * La mise en scene de la revelation (chantier n°3).
 *
 * Montee par manche pendant la phase `reveal`. Les instants passent par des
 * delais CSS (`--at`) diminues du temps deja ecoule dans la phase au montage :
 * montee en retard (onglet revenu, rendu tardif), un delai negatif avance
 * l'animation jusqu'au bon instant au lieu de la rejouer depuis le debut.
 *
 * Apres une reconnexion en pleine revelation, elle ne se monte pas : `match:state`
 * ne porte pas le dernier `round:result`, et la vue n'a donc pas de manche a
 * raconter. On reprend a la manche suivante.
 *
 * Rien n'y est interactif : `aria-hidden` sur les cartes, et un seul bandeau
 * annonce par `role="status"`.
 */
export interface RevealStageProps {
  readonly scene: RevealScene;
  /** Temps deja ecoule dans la phase de revelation au montage. */
  readonly elapsedMs: number;
  readonly opponentName: string;
  readonly onCue?: ((cue: AudioCue) => void) | undefined;
}

const mult = multiplierLabel;

const at = (ms: number, elapsedMs: number): CSSProperties =>
  ({ '--at': `${String(Math.round(ms - elapsedMs))}ms` }) as CSSProperties;

function Card({
  card,
  side,
  elapsedMs,
}: {
  readonly card: RevealCard;
  readonly side: 'moi' | 'adversaire';
  readonly elapsedMs: number;
}): JSX.Element {
  return (
    <div
      className="reveal__card"
      data-side={side}
      data-face-down={card.faceDown}
      data-shiny={card.shiny}
      style={at(card.atMs, elapsedMs)}
    >
      <div className="reveal__flip">
        <div className="reveal__front">
          <span className="reveal__tier">{tierName(card.tier).fr}</span>
          <span className="reveal__icon">{card.icon}</span>
          <span className="reveal__name">{card.name}</span>
          <span className="reveal__family">
            {styleIcon(card.family)} {styleName(card.family).fr}
          </span>
        </div>
        {card.faceDown && <div className="reveal__back">?</div>}
      </div>
      {card.shiny && <span className="reveal__burst">✨ {mult(card.shinyMultiplier)}</span>}
    </div>
  );
}

function Callout({
  callout,
  opponentName,
}: {
  readonly callout: RevealCallout;
  readonly opponentName: string;
}): JSX.Element {
  switch (callout.kind) {
    case 'counter':
      return (
        <>
          <small className="reveal__who">
            {callout.by === 'moi' ? 'Ton contre !' : `Contré par ${opponentName} !`}
          </small>
          <span className="reveal__line">
            <span className="reveal__fam">{styleIcon(callout.winner)}</span>
            <b className="reveal__verb">BAT</b>
            <span className="reveal__fam">{styleIcon(callout.loser)}</span>
            <span className="reveal__mult">{mult(callout.multiplier)}</span>
          </span>
        </>
      );
    case 'mirror':
      return (
        <>
          <small className="reveal__who">Même famille</small>
          <span className="reveal__line">
            <span className="reveal__fam">{styleIcon(callout.family)}</span>
            <b className="reveal__verb">MIROIR</b>
            <span className="reveal__fam">{styleIcon(callout.family)}</span>
          </span>
        </>
      );
    case 'blocked':
      return (
        <>
          <small className="reveal__who">
            {callout.by === 'moi' ? 'Ton Ultime' : `L’Ultime de ${opponentName}`}
          </small>
          <span className="reveal__line">
            <b className="reveal__verb">🛡️ CONTRE BLOQUÉ</b>
          </span>
        </>
      );
  }
}

export const RevealStage = memo(function RevealStage({
  scene,
  elapsedMs: elapsedAtMount,
  opponentName,
  onCue,
}: RevealStageProps): JSX.Element {
  // Fige au montage : un `--at` qui change en cours de route recalerait les
  // animations deja lancees.
  const [elapsedMs] = useState(elapsedAtMount);
  // Les sons se calent sur les memes instants que les cartes. Le choc a deja
  // le sien, joue par l'arene : on ne le double pas.
  const cueRef = useRef(onCue);
  cueRef.current = onCue;
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const schedule = (ms: number, cue: AudioCue): void => {
      const delay = ms - elapsedMs;
      if (delay < 0) return;
      timers.push(setTimeout(() => cueRef.current?.(cue), delay));
    };
    schedule(scene.theirs.atMs, { type: 'card', action: 'flip' });
    for (const card of [scene.mine, scene.theirs]) {
      if (card.shiny) schedule(card.atMs + 120, { type: 'card', action: 'shiny' });
    }
    return () => {
      for (const timer of timers) clearTimeout(timer);
    };
    // Une scene par manche : le composant est remonte a chaque manche.
  }, []);

  const { callout } = scene;
  return (
    <div className="reveal">
      <Card card={scene.mine} side="moi" elapsedMs={elapsedMs} />
      <Card card={scene.theirs} side="adversaire" elapsedMs={elapsedMs} />
      {callout !== null && (
        <div
          className="reveal__callout"
          role="status"
          data-kind={callout.kind}
          data-by={callout.kind === 'mirror' ? undefined : callout.by}
          style={at(scene.calloutAtMs, elapsedMs)}
        >
          <Callout callout={callout} opponentName={opponentName} />
        </div>
      )}
    </div>
  );
});
