import type { JSX } from 'react';
import type { Wallet } from './profile.js';
import { shopSections, type ShopState } from './shop.js';

/**
 * La boutique, ou l'on essaie avant d'acheter.
 *
 * Une boutique qui aligne des vignettes vend mal : un mème est un MOUVEMENT,
 * une tenue se juge sur un personnage, et une couleur d'aura ne veut rien dire
 * dans un carré de quarante pixels. Ici le personnage se tient deja au centre
 * de l'ecran — toucher un article l'enfile sur lui, sur-le-champ.
 *
 * D'ou une seule commande par article, dont le libelle dit l'etat : toucher
 * essaie, retoucher achete. Deux boutons par ligne obligeraient a lire avant
 * d'agir, et le geste qu'on veut rendre facile est le premier, pas le second.
 */

export interface ShopProps {
  readonly state: ShopState;
  /** Article actuellement porte a l'essai, ou `null`. */
  readonly trying: string | null;
  readonly onTry: (id: string) => void;
  readonly onBuy: (id: string) => void;
  readonly onClose: () => void;
}

export function ShopScreen({ state, trying, onTry, onBuy, onClose }: ShopProps): JSX.Element {
  return (
    <section className="shop" aria-label="Boutique">
      <header className="shop__head">
        <h2>Boutique</h2>
        <Purse wallet={state.wallet} />
        <button type="button" className="mini" onClick={onClose}>
          Fermer
        </button>
      </header>

      <p className="shop__hint">Touche un article pour l’essayer sur ton personnage.</p>

      <div className="shop__scroll">
        {shopSections().map((section) => (
          <div key={section.id} className="shop__section">
            <h3>{section.title}</h3>
            <ul className="shop__items">
              {section.items.map((item) => {
                const owned = state.owned.has(item.id);
                const afford = state.wallet.soft >= item.price;
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
                        // Le premier appui essaie, le second achete : on ne
                        // depense jamais sans avoir vu ce qu'on depense pour.
                        if (essai && !owned && afford) onBuy(item.id);
                        else onTry(item.id);
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
                      <small className="shop__tag" data-state={label(owned, afford, essai)}>
                        {owned
                          ? 'acquis'
                          : essai
                            ? afford
                              ? `acheter ◈ ${String(item.price)}`
                              : 'trop cher'
                            : `◈ ${String(item.price)}`}
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
    <span className="purse">
      <b aria-hidden="true">◈</b>
      {wallet.soft}
    </span>
  );
}
