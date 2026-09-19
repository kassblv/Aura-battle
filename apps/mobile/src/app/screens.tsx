import { EMOTES } from '@aura/content';
import type { JSX } from 'react';
import { leagueProgress, styleShares, summarize, type PlayerProfile } from './profile.js';
import { isOwned, wardrobeSections, type LookSlot, type Wardrobe } from './wardrobe.js';

/**
 * Les ecrans hors match.
 *
 * Volontairement sans etat : tout ce qui se decide vit dans `navigation.ts`,
 * `wardrobe.ts` et `profile.ts`, qui se testent sans navigateur. Ce fichier ne
 * fait que mettre en forme — c est pour cela qu il n a pas de test a lui, au
 * meme titre que `renderer.ts`.
 */

const STYLE_ICONS = { calme: '🧊', hype: '🔥', provoc: '😏' } as const;

const glyphOfEmote = (id: string): string => EMOTES.find((emote) => emote.id === id)?.glyph ?? '·';
const STYLE_COLORS = { calme: '#4fc3f7', hype: '#ff8a3d', provoc: '#c97bff' } as const;

const percent = (value: number): string => `${(value * 100).toFixed(1).replace('.', ',')} %`;

export interface HomeProps {
  readonly profile: PlayerProfile;
  readonly seasonLabel: string;
  /** Roue d emotes equipee, montree a l accueil comme un rappel. */
  readonly emotes: readonly string[];
  readonly onPlay: () => void;
  readonly onProfile: () => void;
  readonly onWardrobe: () => void;
  readonly onShop: () => void;
}

/**
 * L accueil.
 *
 * La disposition suit celle des jeux mobiles en paysage, pour une raison
 * d ergonomie et non de mode : chaque zone tombe sous un pouce. La fiche du
 * joueur est en haut a gauche et **elle-meme cliquable** — on n ouvre pas son
 * profil depuis une liste de boutons, on touche sa propre tete. Le rail des
 * menus occupe l arc du pouce gauche, le bouton d action celui du droit, et il
 * est le plus gros element de l ecran parce qu il est celui qu on cherche.
 *
 * Le centre reste vide : c est la que se tient le personnage, et c est aussi la
 * zone morte entre les deux pouces (ADR 0008).
 */
export function HomeScreen({
  profile,
  seasonLabel,
  emotes,
  onPlay,
  onProfile,
  onWardrobe,
  onShop,
}: HomeProps): JSX.Element {
  return (
    <div className="home">
      <button type="button" className="tag" onClick={onProfile}>
        <span className="tag__avatar" aria-hidden="true">
          {profile.name.slice(0, 1)}
        </span>
        <span className="tag__who">
          <b>{profile.name}</b>
          <small>{profile.league}</small>
          <span className="tag__bar">
            <i style={{ width: `${(leagueProgress(profile) * 100).toFixed(1)}%` }} />
          </span>
        </span>
        <span className="tag__lp">{profile.lp}</span>
      </button>

      <div className="wallet">
        <span className="coin">
          <b aria-hidden="true">◈</b>
          {profile.wallet.soft}
        </span>
        <span className="coin coin--hard">
          <b aria-hidden="true">◆</b>
          {profile.wallet.hard}
        </span>
      </div>

      <nav className="rail" aria-label="Menus">
        <button type="button" className="rail__btn" onClick={onWardrobe}>
          <span aria-hidden="true">👕</span>
          Vestiaire
        </button>
        <button type="button" className="rail__btn" onClick={onProfile}>
          <span aria-hidden="true">📊</span>
          Profil
        </button>
        <button type="button" className="rail__btn" onClick={onShop}>
          <span aria-hidden="true">🛒</span>
          Boutique
        </button>
      </nav>

      {/* La roue equipee, visible sans ouvrir un menu : on doit savoir ce
          qu'on a sous le pouce avant d'entrer en match. */}
      <ul className="home__emotes" aria-label="Émotes équipées">
        {emotes.map((id) => (
          <li key={id}>{glyphOfEmote(id)}</li>
        ))}
      </ul>

      <div className="launch">
        <p className="launch__mode">
          Solo · contre Nova
          <small>{seasonLabel}</small>
        </p>
        <button type="button" className="launch__btn" onClick={onPlay}>
          Jouer
        </button>
      </div>
    </div>
  );
}

export interface ProfileProps {
  readonly profile: PlayerProfile;
  readonly onClose: () => void;
}

export function ProfileScreen({ profile, onClose }: ProfileProps): JSX.Element {
  const stats = summarize(profile);
  return (
    <section className="sheet" aria-label="Profil">
      <header className="sheet__head">
        <h2>Profil</h2>
        <button type="button" className="mini" onClick={onClose}>
          Fermer
        </button>
      </header>

      <p className="sheet__ident">
        <b>
          {profile.name} · {profile.tag}
        </b>
        <small>
          {profile.league} — {profile.lp} / {profile.lpForNextLeague} PL
        </small>
      </p>

      <dl className="stats">
        {[
          { label: 'matchs', value: String(stats.matches) },
          { label: 'victoires', value: String(stats.wins) },
          { label: 'taux', value: percent(stats.winRate) },
          { label: 'série max', value: String(stats.bestStreak) },
        ].map((stat) => (
          <div key={stat.label} className="stat">
            <dt>{stat.label}</dt>
            <dd>{stat.value}</dd>
          </div>
        ))}
      </dl>

      <h3>Styles joués</h3>
      <ul className="split">
        {styleShares(profile).map(({ style, share }) => (
          <li key={style} className="split__row">
            <span>
              {STYLE_ICONS[style]} {style}
            </span>
            <span className="split__track">
              <i
                style={{ width: `${(share * 100).toFixed(1)}%`, background: STYLE_COLORS[style] }}
              />
            </span>
            <span className="split__pct">{Math.round(share * 100)} %</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export interface WardrobeProps {
  readonly wardrobe: Wardrobe;
  readonly onEquip: (slot: LookSlot, id: string) => void;
  readonly onClose: () => void;
}

export function WardrobeScreen({ wardrobe, onEquip, onClose }: WardrobeProps): JSX.Element {
  return (
    <section className="sheet" aria-label="Vestiaire">
      <header className="sheet__head">
        <h2>Vestiaire</h2>
        <button type="button" className="mini" onClick={onClose}>
          Fermer
        </button>
      </header>

      <p className="sheet__note">
        Aucun de ces objets ne touche un score. La boutique ne vend que de l’apparence.
      </p>

      {wardrobeSections().map((section) => (
        <div key={section.id} className="ward">
          <h3>{section.title}</h3>
          <ul className="ward__items">
            {section.items.map((item) => {
              const owned = isOwned(wardrobe, item.id);
              const worn = wardrobe.look[section.id] === item.id;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    className="ward__item"
                    aria-pressed={worn}
                    disabled={!owned}
                    onClick={() => {
                      onEquip(section.id, item.id);
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
                    {item.price > 0 && <small>{owned ? 'acquis' : `${item.price} ◈`}</small>}
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
