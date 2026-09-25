import type { CSSProperties, JSX } from 'react';
import type { PanelLayout } from './panel.js';
import type { Wallet } from './profile.js';
import { dayIndexOf } from '@aura/content';
import { buyOptions, shopSections, type ShopState } from './shop.js';
import type { Currency } from '../net/inventory.js';

/**
 * La boutique, ou l'on essaie avant d'acheter.
 *
 * Une boutique qui aligne des vignettes vend mal : un mème est un MOUVEMENT,
 * une tenue se juge sur un personnage, et une couleur d'aura ne veut rien dire
 * dans un carré de quarante pixels. Ici le personnage se tient deja au centre
 * de l'ecran — toucher un article l'enfile sur lui, sur-le-champ.
 *
 * D'ou une seule commande par article : toucher essaie. L'achat vit dans une
 * barre a part, qui prend la place de l'indication tant qu'on essaie un
 * article qu'on n'a pas : deux monnaies (pieces et jetons) rendaient ambigu le
 * « retoucher achete » — acheter avec quoi ? La barre le dit.
 *
 * La largeur et le nombre de colonnes viennent de `panel.ts`, pas du CSS : le
 * meme nombre sert a recentrer le personnage dans ce qui reste de l'ecran
 * (`arena/panelOffset.ts`), et une valeur ecrite deux fois finit par differer.
 */

export interface ShopProps {
  readonly state: ShopState;
  /** Article actuellement porte a l'essai, ou `null`. */
  readonly trying: string | null;
  readonly onTry: (id: string) => void;
  readonly onBuy: (id: string, currency: Currency) => void;
  readonly onClose: () => void;
  /** Largeur du panneau et nombre de colonnes, decides par `panelLayout`. */
  readonly layout: PanelLayout;
}

export function ShopScreen({
  state,
  trying,
  onTry,
  onBuy,
  onClose,
  layout,
}: ShopProps): JSX.Element {
  const sections = shopSections(dayIndexOf(Date.now()));
  return (
    <section
      className="shop"
      aria-label="Boutique"
      style={{ width: `${String(layout.width)}px`, '--shop-cols': layout.columns } as CSSProperties}
    >
      <header className="shop__head">
        <h2>Boutique</h2>
        <Purse wallet={state.wallet} />
        <button type="button" className="mini" onClick={onClose}>
          Fermer
        </button>
      </header>

      {(() => {
        const tried =
          trying === null
            ? undefined
            : sections.flatMap((section) => section.items).find((item) => item.id === trying);
        const options =
          tried === undefined ? null : buyOptions(tried, state.wallet, state.owned.has(tried.id));
        if (tried === undefined || options === null) {
          return <p className="shop__hint">Touche un article pour l’essayer sur ton personnage.</p>;
        }
        return (
          <div className="shop__buy" role="group" aria-label={`Acheter ${tried.name}`}>
            <span className="shop__buy-name">{tried.name}</span>
            <button
              type="button"
              className="shop__pay"
              data-currency="soft"
              disabled={!options.soft.afford}
              onClick={() => {
                onBuy(tried.id, 'soft');
              }}
            >
              ◈ {options.soft.price}
            </button>
            <button
              type="button"
              className="shop__pay"
              data-currency="hard"
              disabled={!options.hard.afford}
              onClick={() => {
                onBuy(tried.id, 'hard');
              }}
            >
              💎 {options.hard.price}
            </button>
          </div>
        );
      })()}

      <div className="shop__scroll">
        {sections.map((section) => (
          <div key={section.id} className="shop__section">
            <h3>{section.title}</h3>
            <ul className="shop__items">
              {section.items.map((item) => {
                const owned = state.owned.has(item.id);
                const afford = state.wallet.soft >= item.price || state.wallet.hard >= item.tokens;
                const essai = trying === item.id;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      className="shop__item"
                      data-trying={essai}
                      data-owned={owned}
                      aria-pressed={essai}
                      onClick={() => {
                        // Toucher essaie ; l'achat passe par la barre, qui dit
                        // avec quelle monnaie. On ne depense jamais sans avoir
                        // vu ce qu'on depense pour.
                        onTry(item.id);
                      }}
                    >
                      {item.glyph !== undefined ? (
                        <span className="shop__glyph" aria-hidden="true">
                          {item.glyph}
                        </span>
                      ) : (
                        <span
                          className="shop__swatch"
                          style={
                            item.swatchSecondary === undefined
                              ? { background: item.swatch }
                              : {
                                  backgroundImage: `linear-gradient(135deg, ${item.swatch ?? '#000'} 50%, ${item.swatchSecondary} 50%)`,
                                }
                          }
                        />
                      )}
                      <span className="shop__name">{item.name}</span>
                      {/*
                        Le prix plein barre, a cote du remise.

                        Une remise qu'on ne peut pas comparer n'est pas une
                        remise : c'est un prix. Le barre est ce qui fait la
                        difference entre « 56 ◈ » et « 56 au lieu de 80 ».
                      */}
                      {item.fullPrice !== undefined && !owned && (
                        <s className="shop__was">{item.fullPrice}</s>
                      )}
                      <small className="shop__tag" data-state={label(owned, afford, essai)}>
                        {owned
                          ? 'acquis'
                          : essai && !afford
                            ? 'trop cher'
                            : `◈ ${String(item.price)} · 💎 ${String(item.tokens)}`}
                      </small>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

/** L'etat qui colore l'etiquette, nomme une fois plutot que devine deux fois. */
function label(owned: boolean, afford: boolean, trying: boolean): string {
  if (owned) return 'owned';
  if (!trying) return 'price';
  return afford ? 'buy' : 'poor';
}

function Purse({ wallet }: { readonly wallet: Wallet }): JSX.Element {
  return (
    <span
      className="purse"
      aria-label={`${String(wallet.soft)} pièces, ${String(wallet.hard)} jetons`}
    >
      <b aria-hidden="true">◈</b>
      {wallet.soft}
      <b aria-hidden="true" className="purse__tokens">
        💎
      </b>
      {wallet.hard}
    </span>
  );
}
