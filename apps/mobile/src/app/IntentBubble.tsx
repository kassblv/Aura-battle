import { styleIcon, styleName, type Style } from '@aura/content';
import { memo, useCallback, useState, type CSSProperties, type JSX } from 'react';
import type { FamilyTab } from './hand.js';

/**
 * La bulle d'intention (2.6.0, test A/B, docs/01 §10).
 *
 * Pendant le choix, chacun peut annoncer UNE famille — vraie ou bluff. Deux
 * pieces ici :
 *
 * - le geste, pose au-dessus des onglets de la main de cartes : un bouton
 *   « Annoncer » qui ouvre une rangee des cinq familles. Il flotte au-dessus
 *   de la main plutot que dans sa rangee : a 667 px, la main n'a que 255 px et
 *   ses cinq onglets en prennent 250 — un sixieme bouton ne tient pas, et
 *   serrer les onglets sous 46 px casserait l'ADR 0008. Au-dessus, il occupe
 *   l'espace libre entre les deux combattants, sans jamais toucher une carte
 *   ni la jauge ;
 * - les bulles, au-dessus des tetes : celle de l'adversaire est tout le sujet
 *   (« il annonce Calme… ment-il ? »), la mienne rappelle ce que j'ai dit.
 *
 * Rien ne s'affiche quand le match n'a pas de bulle : c'est `MatchScreen` qui
 * decide, a partir de `view.intent`.
 */

export interface IntentPickerViewProps {
  readonly open: boolean;
  readonly tabs: readonly FamilyTab[];
  /** Gain d'Ultime d'une bulle tenue, selon les regles du match. */
  readonly bonus: number;
  readonly onToggle: () => void;
  readonly onPick: (family: Style) => void;
}

/** Le geste, sans etat : ce que les tests de rendu statique regardent. */
export function IntentPickerView({
  open,
  tabs,
  bonus,
  onToggle,
  onPick,
}: IntentPickerViewProps): JSX.Element {
  return (
    <div className="intent" data-open={open}>
      {open && (
        <div className="intent__row" role="group" aria-label="Annoncer une famille">
          {tabs.map((tab, index) => (
            <button
              key={tab.family}
              type="button"
              className="intent__pick"
              style={{ '--i': index } as CSSProperties}
              aria-label={`Annoncer ${styleName(tab.family).fr}`}
              onClick={() => {
                onPick(tab.family);
              }}
            >
              {tab.icon}
            </button>
          ))}
        </div>
      )}
      <div className="intent__bar">
        <button
          type="button"
          className="intent__toggle"
          aria-expanded={open}
          aria-label={open ? 'Fermer sans annoncer' : 'Annoncer une famille, vraie ou bluff'}
          onClick={onToggle}
        >
          <span className="intent__toggle-icon" aria-hidden="true">
            {open ? '✕' : '💭'}
          </span>
          {!open && <span className="intent__toggle-text">Annoncer</span>}
        </button>
        {open && (
          <p className="intent__hint">
            <b>Vrai ou bluff ?</b> Gagne avec elle : +{bonus} Ultime
          </p>
        )}
      </div>
    </div>
  );
}

export interface IntentPickerProps {
  readonly tabs: readonly FamilyTab[];
  readonly bonus: number;
  readonly onAnnounce: (family: Style) => void;
}

/**
 * Le geste, avec son etat : ouvert ou ferme. Un appui sur une famille annonce
 * et referme ; le composant disparait ensuite, puisque l'annonce est faite.
 */
export const IntentPicker = memo(function IntentPicker({
  tabs,
  bonus,
  onAnnounce,
}: IntentPickerProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => {
    setOpen((current) => !current);
  }, []);
  const pick = useCallback(
    (family: Style) => {
      setOpen(false);
      onAnnounce(family);
    },
    [onAnnounce],
  );
  return <IntentPickerView open={open} tabs={tabs} bonus={bonus} onToggle={toggle} onPick={pick} />;
});

export interface IntentBubblesProps {
  readonly mine: Style | null;
  readonly theirs: Style | null;
  readonly opponentName: string;
}

function Bubble({
  side,
  family,
  label,
}: {
  readonly side: 'moi' | 'adversaire';
  readonly family: Style;
  readonly label: string;
}): JSX.Element {
  return (
    <div className="intent-bubble" data-side={side} role="status" aria-label={label}>
      {/* La cle rejoue l'entree si l'annonce change (reprise). */}
      <span className="intent-bubble__cloud" key={family} aria-hidden="true">
        <span className="intent-bubble__icon">{styleIcon(family)}</span>
        <span className="intent-bubble__name">{styleName(family).fr}</span>
      </span>
      <i className="intent-bubble__dot intent-bubble__dot--big" aria-hidden="true" />
      <i className="intent-bubble__dot intent-bubble__dot--small" aria-hidden="true" />
    </div>
  );
}

/** Les bulles de pensee au-dessus des combattants : moi a gauche, l'adversaire a droite. */
export const IntentBubbles = memo(function IntentBubbles({
  mine,
  theirs,
  opponentName,
}: IntentBubblesProps): JSX.Element | null {
  if (mine === null && theirs === null) return null;
  return (
    <>
      {mine !== null && (
        <Bubble side="moi" family={mine} label={`Tu annonces ${styleName(mine).fr}`} />
      )}
      {theirs !== null && (
        <Bubble
          side="adversaire"
          family={theirs}
          label={`${opponentName} annonce ${styleName(theirs).fr}`}
        />
      )}
    </>
  );
});
