import { useState, type JSX } from 'react';
import {
  isExclusive,
  type Style,
  styleIcon,
  styleName,
  STYLES,
  type Tier,
  tierName,
  TIERS,
} from '@aura/content';
import type { PanelLayout } from './panel.js';
import { memeGallery } from './memes.js';
import {
  danceOptions,
  effectItems,
  isOwned,
  isWorn,
  itemInfo,
  ownsItem,
  wardrobeSections,
  type LookSlot,
  type Wardrobe,
} from './wardrobe.js';

/**
 * Le vestiaire : ce qu on porte, et ce qu on pourrait porter.
 *
 * **Trois onglets, parce que trois sujets.** L apparence, l aura, les danses :
 * empiles, ils faisaient defiler un panneau deja plus haut que l ecran, et les
 * danses — le coeur d une aura battle — n y avaient aucune place.
 *
 * **Toucher, c est voir.** Ce qu on possede s equipe ; ce qu on ne possede pas
 * s ESSAIE sur le personnage, a gauche, avec un lien vers la boutique. Un
 * article grise qu on ne peut meme pas regarder ne se vend pas : c est
 * exactement ce que le joueur reprochait aux auras.
 *
 * Rien n est donne : essayer ne touche ni au loadout ni au serveur, et le
 * serveur refuse de toute facon d equiper ce qu on ne possede pas.
 */

export type WardrobeTab = 'look' | 'aura' | 'dances';

const TABS: readonly { readonly id: WardrobeTab; readonly title: string }[] = [
  { id: 'look', title: 'Style' },
  { id: 'aura', title: 'Aura' },
  { id: 'dances', title: 'Danses' },
];

/** Les rayons de chaque onglet. L aura a en plus ses effets, a part. */
const SLOTS_OF: Readonly<Record<WardrobeTab, readonly LookSlot[]>> = {
  look: ['outfit', 'hair', 'skin'],
  aura: ['aura'],
  dances: [],
};

export interface WardrobeProps {
  readonly wardrobe: Wardrobe;
  readonly onEquip: (slot: LookSlot, id: string) => void;
  /** Equipe une danse pour SON mouvement. */
  readonly onEquipDance: (animationId: string) => void;
  /** Article porte a l essai, ou `null`. */
  readonly trying: string | null;
  /** Essaie un article — ou repose l essai, avec `null`. */
  readonly onTry: (id: string | null) => void;
  /** Ouvre la boutique sur l article essaye. */
  readonly onShop: (id: string) => void;
  /** Ouvre le passe de saison : la ou se gagne un exclusif essaye. */
  readonly onSeason: () => void;
  readonly onClose: () => void;
  /**
   * Meme largeur que la boutique, et pour la meme raison : ici aussi le
   * personnage a gauche porte ce qu'on touche a droite.
   */
  readonly layout: PanelLayout;
}

export function WardrobeScreen({
  wardrobe,
  onEquip,
  onEquipDance,
  trying,
  onTry,
  onShop,
  onSeason,
  onClose,
  layout,
}: WardrobeProps): JSX.Element {
  const [tab, setTab] = useState<WardrobeTab>('look');
  const [style, setStyle] = useState<Style>('calme');
  const [tier, setTier] = useState<Tier>(0);

  /** Toucher un article : l equiper si on l a, l essayer sinon. */
  const touch = (slot: LookSlot, id: string): void => {
    if (isOwned(wardrobe, id)) {
      onTry(null);
      onEquip(slot, id);
    } else {
      onTry(trying === id ? null : id);
    }
  };

  const tried = trying === null ? null : itemInfo(trying);
  const triedOwned = trying !== null && ownsItem(wardrobe, trying);

  const move = { style, tier };
  const dances = danceOptions(wardrobe, move);
  const all = memeGallery().filter((card) => card.style === style && card.tier === tier);

  return (
    <section
      className="sheet"
      aria-label="Vestiaire"
      style={{ width: `${String(layout.width)}px` }}
    >
      <header className="sheet__head">
        <h2>Vestiaire</h2>
        <button type="button" className="mini" onClick={onClose}>
          Fermer
        </button>
      </header>

      <div className="ward__tabs" role="tablist" aria-label="Rayons du vestiaire">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            className="ward__tab"
            aria-selected={tab === entry.id}
            onClick={() => {
              setTab(entry.id);
              onTry(null);
            }}
          >
            {entry.title}
          </button>
        ))}
      </div>

      {wardrobeSections()
        .filter((section) => SLOTS_OF[tab].includes(section.id))
        .map((section) => (
          <div key={section.id} className="ward">
            <h3>{section.title}</h3>
            <ul className="ward__items">
              {section.items.map((item) => {
                const owned = isOwned(wardrobe, item.id);
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      className="ward__item"
                      aria-pressed={isWorn(wardrobe.look, section.id, item.id)}
                      data-owned={owned}
                      data-trying={trying === item.id}
                      onClick={() => {
                        touch(section.id, item.id);
                      }}
                    >
                      <span
                        className="ward__swatch"
                        style={
                          item.swatchSecondary === undefined
                            ? { background: item.swatch }
                            : {
                                backgroundImage: `linear-gradient(135deg, ${item.swatch} 50%, ${item.swatchSecondary} 50%)`,
                              }
                        }
                      />
                      <span>{item.name}</span>
                      {/* Un objet gratuit n affiche pas « 0 » : ce serait un prix. */}
                      {item.exclusive !== undefined ? (
                        <small>{owned ? '🎖️ exclusif' : `🎖️ ${item.exclusive}`}</small>
                      ) : (
                        item.price > 0 && <small>{owned ? 'acquis' : `${item.price} ◈`}</small>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}

      {tab === 'aura' && (
        <div className="ward">
          <h3>Effets d’aura</h3>
          <p className="sheet__note">
            Un effet habille son amplificateur : il apparaît quand tu le joues, chez toi et chez
            l’adversaire.
          </p>
          <ul className="ward__items">
            {effectItems(wardrobe).map((effect) => (
              <li key={effect.id}>
                <button
                  type="button"
                  className="ward__item"
                  aria-pressed={trying === effect.id}
                  data-owned={effect.owned}
                  data-trying={trying === effect.id}
                  onClick={() => {
                    onTry(trying === effect.id ? null : effect.id);
                  }}
                >
                  <span className="ward__level">A{effect.level}</span>
                  <span>{effect.name}</span>
                  {effect.price > 0 && (
                    <small>{effect.owned ? 'acquis' : `${effect.price} ◈`}</small>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {tab === 'dances' && (
        <div className="ward">
          <p className="sheet__note">
            Choisis la danse de chaque mouvement : c’est elle que l’adversaire voit à la révélation.
          </p>
          <ul className="ward__items" aria-label="Style">
            {STYLES.map((id) => (
              <li key={id}>
                <button
                  type="button"
                  className="ward__item"
                  aria-pressed={style === id}
                  onClick={() => {
                    setStyle(id);
                    onTry(danceOptions(wardrobe, { style: id, tier }).current);
                  }}
                >
                  <span aria-hidden="true">{styleIcon(id)}</span>
                  <span>{styleName(id).fr}</span>
                </button>
              </li>
            ))}
          </ul>
          <ul className="ward__items" aria-label="Palier">
            {TIERS.map((t) => (
              <li key={t}>
                <button
                  type="button"
                  className="ward__item"
                  aria-pressed={tier === t}
                  onClick={() => {
                    setTier(t);
                    onTry(danceOptions(wardrobe, { style, tier: t }).current);
                  }}
                >
                  <span>{tierName(t).fr}</span>
                </button>
              </li>
            ))}
          </ul>
          <ul className="ward__items" aria-label="Danses du mouvement">
            {all.map((card) => {
              const owned = ownsItem(wardrobe, card.animationId);
              return (
                <li key={card.animationId}>
                  <button
                    type="button"
                    className="ward__item"
                    aria-pressed={dances.current === card.animationId}
                    data-owned={owned}
                    data-trying={trying === card.animationId}
                    onClick={() => {
                      onTry(card.animationId);
                      if (owned) onEquipDance(card.animationId);
                    }}
                  >
                    <span>{card.name}</span>
                    {wardrobe.look.signature === card.animationId && (
                      <small aria-label="danse signature">★</small>
                    )}
                    {!owned && <small>{card.price} ◈</small>}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/*
        La barre d essai : ce qu on porte sans l avoir, et ou l acheter.

        Collee au bas du panneau pour rester sous le pouce quel que soit
        l onglet. Rien a acheter ici : la boutique fait foi pour le prix du
        jour, remise comprise.
      */}
      {tried !== null && trying !== null && !triedOwned && (
        <div className="ward__try" role="status">
          <span>
            Essai : <b>{tried.name}</b>
          </span>
          {/* Un exclusif ne se vend pas : il se gagne sur le passe. */}
          {isExclusive(trying) ? (
            <button
              type="button"
              className="ward__buy"
              onClick={() => {
                onSeason();
              }}
            >
              🎖️ Au passe de saison
            </button>
          ) : (
            <button
              type="button"
              className="ward__buy"
              onClick={() => {
                onShop(trying);
              }}
            >
              En boutique · {tried.price} ◈
            </button>
          )}
        </div>
      )}
    </section>
  );
}
