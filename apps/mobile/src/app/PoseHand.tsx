import { styleName, tierName, type Style, type Tier } from '@aura/content';
import { memo, type CSSProperties, type JSX } from 'react';
import type { FamilyTab, HandCard } from './hand.js';

/**
 * La main de cartes de la phase de choix (chantier n°2).
 *
 * Montee UNE fois pour tout le match, comme la bande de commandes qui la porte :
 * la monter a l'instant ou le choix s'ouvre couterait des images pleines au
 * moment precis ou la jauge apparait. Ses proprietes sont des donnees deja
 * decidees par `hand.ts` et des rappels stables ; l'animation de distribution
 * repart par la cle `dealKey`, pas par un remontage de React.
 *
 * Toute l'animation passe par `transform` et `opacity` (le compositeur), et la
 * regle globale `prefers-reduced-motion` la ramene a presque rien.
 */
export interface PoseHandProps {
  readonly tabs: readonly FamilyTab[];
  readonly family: Style;
  readonly cards: readonly HandCard[];
  /** Palier choisi dans la famille affichee, ou `null`. */
  readonly selectedTier: Tier | null;
  readonly locked: boolean;
  /** Change a chaque manche : la main se redistribue. */
  readonly dealKey: number;
  /** Palier d'une carte trop chere qu'on vient de toucher, pour la faire trembler. */
  readonly deniedTier: Tier | null;
  readonly onTab: (family: Style) => void;
  readonly onCard: (card: HandCard) => void;
}

/** Le badge d'une carte : variantes possedees et a debloquer. */
function badgeOf(card: HandCard): string | null {
  const { owned, toUnlock, index } = card.variants;
  if (owned < 2 && toUnlock === 0) return null;
  const mine = owned < 2 ? '' : `${String(index + 1)}/${String(owned)}`;
  const more = toUnlock === 0 ? '' : `+${String(toUnlock)}`;
  return [mine, more].filter((part) => part !== '').join(' · ');
}

function cardLabel(card: HandCard, family: Style): string {
  const cost = card.cost === 0 ? 'gratuit' : `coûte ${String(card.cost)} d’énergie`;
  const extras = [
    card.shiny ? 'carte brillante, ×1,2' : '',
    card.affordable ? '' : 'trop chère',
    card.variants.owned > 1 ? 'toucher encore pour changer de pose' : '',
  ].filter((part) => part !== '');
  return [
    `${card.name}, ${styleName(family).fr} ${tierName(card.tier).fr}`,
    `puissance ${String(card.power)}`,
    cost,
    ...extras,
  ].join(', ');
}

export const PoseHand = memo(function PoseHand({
  tabs,
  family,
  cards,
  selectedTier,
  locked,
  dealKey,
  deniedTier,
  onTab,
  onCard,
}: PoseHandProps): JSX.Element {
  return (
    <div className="hand" data-locked={locked}>
      <div className="hand__tabs" role="tablist" aria-label="Familles">
        {tabs.map((tab) => (
          <button
            key={tab.family}
            type="button"
            role="tab"
            className="hand__tab"
            aria-selected={tab.family === family}
            aria-label={`${styleName(tab.family).fr}, bat ${tab.beats
              .map((beaten) => styleName(beaten).fr)
              .join(' et ')}${tab.shiny ? ', ta carte brillante est ici' : ''}`}
            data-shiny={tab.shiny}
            disabled={locked}
            onClick={() => {
              onTab(tab.family);
            }}
          >
            <span className="hand__tab-icon">{tab.icon}</span>
            <small className="hand__tab-beats">
              {tab.beats.map((beaten) => tabs.find((t) => t.family === beaten)?.icon).join('')}
            </small>
          </button>
        ))}
      </div>

      {/* La cle rejoue la distribution a chaque manche et a chaque famille. */}
      <div className="hand__fan" key={`${String(dealKey)}-${family}`}>
        {cards.map((card, index) => {
          const selected = selectedTier === card.tier;
          const badge = badgeOf(card);
          const style = {
            '--i': index,
            '--o': index - 2,
            '--a': Math.abs(index - 2),
          } as CSSProperties;
          return (
            <button
              key={card.tier}
              type="button"
              className="hand__card"
              style={style}
              aria-pressed={selected}
              aria-label={cardLabel(card, family)}
              data-selected={selected}
              data-shiny={card.shiny}
              data-poor={!card.affordable}
              data-denied={deniedTier === card.tier}
              disabled={locked}
              onClick={() => {
                onCard(card);
              }}
            >
              {badge !== null && <span className="hand__badge">{badge}</span>}
              <span className="hand__tier">{tierName(card.tier).fr}</span>
              {/* La cle retourne la carte quand la variante change. */}
              <span className="hand__icon" key={card.poseId} aria-hidden="true">
                {card.icon}
              </span>
              <span className="hand__name">{card.name}</span>
              <span className="hand__stats">
                <b>{card.power}</b> · {card.cost === 0 ? 'libre' : `−${String(card.cost)}`}
              </span>
              {card.shiny && <span className="hand__sheen" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
    </div>
  );
});
