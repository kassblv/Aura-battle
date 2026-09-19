import { EMOTES, EMOTE_SLOTS } from '@aura/content';
import type { JSX } from 'react';
import type { EmoteLoadout } from './emotes.js';
import type { Wallet } from './profile.js';
import { shopSections, type ShopState } from './shop.js';

/**
 * La boutique, et la roue d emotes.
 *
 * Les deux vivent ensemble a dessein : on achete une emote pour la mettre dans
 * sa roue, et separer les deux ecrans forcerait un aller-retour entre l achat
 * et son seul usage.
 */

export interface ShopProps {
  readonly state: ShopState;
  readonly emotes: EmoteLoadout;
  readonly onBuy: (id: string) => void;
  readonly onEquipEmote: (slot: number, id: string) => void;
  readonly onClose: () => void;
}

const glyphOf = (id: string): string => EMOTES.find((emote) => emote.id === id)?.glyph ?? '·';

export function ShopScreen({
  state,
  emotes,
  onBuy,
  onEquipEmote,
  onClose,
}: ShopProps): JSX.Element {
  return (
    <section className="sheet" aria-label="Boutique">
      <header className="sheet__head">
        <h2>Boutique</h2>
        <Purse wallet={state.wallet} />
        <button type="button" className="mini" onClick={onClose}>
          Fermer
        </button>
      </header>

      <h3>Ta roue d’émotes</h3>
      <p className="sheet__note">
        Quatre emplacements : une roue se vise au pouce, et une émote qui arrive trois secondes trop
        tard ne dit plus rien.
      </p>
      <ol className="wheel">
        {Array.from({ length: EMOTE_SLOTS }, (_, slot) => (
          <li key={slot} className="wheel__slot">
            <span aria-hidden="true">{glyphOf(emotes.slots[slot] ?? '')}</span>
          </li>
        ))}
      </ol>

      <h3>Émotes possédées</h3>
      <ul className="ward__items">
        {EMOTES.filter((emote) => emote.price === 0 || state.owned.has(emote.id)).map((emote) => {
          const slot = emotes.slots.indexOf(emote.id);
          return (
            <li key={emote.id}>
              <button
                type="button"
                className="ward__item"
                aria-pressed={slot >= 0}
                onClick={() => {
                  // Toujours poser dans le premier emplacement : `equipEmote`
                  // echange avec l ancienne place plutot que de dupliquer.
                  onEquipEmote(slot >= 0 ? slot : 0, emote.id);
                }}
              >
                <span className="ward__glyph" aria-hidden="true">
                  {emote.glyph}
                </span>
                <span>{emote.name.fr}</span>
              </button>
            </li>
          );
        })}
      </ul>

      {shopSections().map((section) => (
        <div key={section.id} className="ward">
          <h3>{section.title}</h3>
          <ul className="ward__items">
            {section.items.map((item) => {
              const owned = state.owned.has(item.id);
              const afford = state.wallet.soft >= item.price;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    className="ward__item"
                    disabled={owned || !afford}
                    onClick={() => {
                      onBuy(item.id);
                    }}
                  >
                    {item.glyph !== undefined ? (
                      <span className="ward__glyph" aria-hidden="true">
                        {item.glyph}
                      </span>
                    ) : (
                      <span
                        className="ward__swatch"
                        style={
                          item.swatchSecondary === undefined
                            ? { background: item.swatch }
                            : {
                                backgroundImage: `linear-gradient(135deg, ${item.swatch ?? '#000'} 50%, ${item.swatchSecondary} 50%)`,
                              }
                        }
                      />
                    )}
                    <span>{item.name}</span>
                    <small>{owned ? 'acquis' : `${item.price} ◈`}</small>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}

function Purse({ wallet }: { readonly wallet: Wallet }): JSX.Element {
  return (
    <span className="purse">
      <b aria-hidden="true">◈</b>
      {wallet.soft}
    </span>
  );
}
