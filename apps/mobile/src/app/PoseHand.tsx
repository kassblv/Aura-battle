import { styleName, tierName, type Style, type Tier } from '@aura/content';
import { memo, useEffect, useRef, type CSSProperties, type JSX } from 'react';
import type { FamilyTab, HandCard } from './hand.js';

/**
 * La main de cartes de la phase de choix (chantier n°2).
 *
 * Montee UNE fois pour tout le match, comme la bande de commandes qui la porte :
 * la monter a l'instant ou le choix s'ouvre couterait des images pleines au
 * moment precis ou la jauge apparait. Ses proprietes sont des donnees deja
 * decidees par `hand.ts` et des rappels stables.
 *
 * Toute l'animation passe par le compositeur (proprietes de transformation et
 * `opacity`), et la regle globale `prefers-reduced-motion` la ramene a presque
 * rien.
 */
export interface PoseHandProps {
  readonly tabs: readonly FamilyTab[];
  /** Famille dont la main est ouverte. */
  readonly family: Style;
  /** Famille de la carte choisie, ou `null` : son onglet le rappelle. */
  readonly chosenFamily: Style | null;
  readonly cards: readonly HandCard[];
  /** Palier choisi dans la famille affichee, ou `null`. */
  readonly selectedTier: Tier | null;
  readonly locked: boolean;
  /** La phase de choix est ouverte : c'est l'instant de distribuer. */
  readonly dealing: boolean;
  /** Compte les refus : un second appui refait trembler la meme carte. */
  readonly denyTick: number;
  /** Palier d'une carte trop chere qu'on vient de toucher. */
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

/**
 * Rejoue la distribution des cartes.
 *
 * Les cartes restent montees tout le match : leur animation d'entree s'est
 * jouee une fois, bande cachee. On la relance a l'ouverture du choix et a
 * chaque famille ouverte — sans remonter un seul element, ce qui couterait une
 * disposition complete a l'instant ou le joueur commence a viser.
 */
function replayDeal(fan: HTMLElement | null): void {
  if (fan === null || typeof fan.getAnimations !== 'function') return;
  for (const animation of fan.getAnimations({ subtree: true })) {
    if ((animation as CSSAnimation).animationName !== 'hand-deal') continue;
    animation.cancel();
    animation.play();
  }
}

export const PoseHand = memo(function PoseHand({
  tabs,
  family,
  chosenFamily,
  cards,
  selectedTier,
  locked,
  dealing,
  denyTick,
  deniedTier,
  onTab,
  onCard,
}: PoseHandProps): JSX.Element {
  const fanRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (dealing) replayDeal(fanRef.current);
  }, [dealing, family]);

  return (
    <div className="hand" data-locked={locked}>
      <div className="hand__tabs" role="group" aria-label="Familles">
        {tabs.map((tab) => (
          <button
            key={tab.family}
            type="button"
            className="hand__tab"
            aria-pressed={tab.family === family}
            aria-label={`${styleName(tab.family).fr}, bat ${tab.beats
              .map((beaten) => styleName(beaten).fr)
              .join(' et ')}${tab.shiny ? ', ta carte brillante est ici' : ''}${
              tab.family === chosenFamily ? ', ta carte choisie est ici' : ''
            }`}
            data-shiny={tab.shiny}
            data-chosen={tab.family === chosenFamily}
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

      <div className="hand__fan" ref={fanRef}>
        {cards.map((card, index) => {
          const selected = selectedTier === card.tier;
          const denied = deniedTier === card.tier;
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
              data-denied={denied}
              disabled={locked}
              onClick={() => {
                onCard(card);
              }}
            >
              {/*
                L'enveloppe porte le tremblement du refus : sur la carte, il
                remplacerait l'animation de distribution et la rejouerait a sa
                fin. Sa cle change a chaque refus, pour trembler encore.
              */}
              <span className="hand__face" key={denied ? `refus-${String(denyTick)}` : 'face'}>
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
              </span>
              {card.shiny && <span className="hand__sheen" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
    </div>
  );
});
