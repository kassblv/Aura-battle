import { tierName } from '@aura/content';
import type { JSX } from 'react';
import type { MemeCard } from './memes.js';
import { leagueProgress, styleShares, summarize, type PlayerProfile } from './profile.js';
import type { PanelLayout } from './panel.js';
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

const STYLE_COLORS = { calme: '#4fc3f7', hype: '#ff8a3d', provoc: '#c97bff' } as const;

const percent = (value: number): string => `${(value * 100).toFixed(1).replace('.', ',')} %`;

export interface HomeProps {
  readonly profile: PlayerProfile;
  /** Mode que lancera le gros bouton. */
  readonly mode: 'ranked' | 'casual';
  readonly onToggleMode: () => void;
  /** Le meme actuellement joue par le personnage au centre. */
  readonly meme: MemeCard;
  /** Parcourt la galerie : -1 precedent, +1 suivant. */
  readonly onStepMeme: (delta: number) => void;
  /** Vrai si le joueur possede le meme montre — offert ou achete. */
  readonly memeOwned: boolean;
  /** Vrai si c est deja celui qu il jouera sur ce mouvement. */
  readonly memeEquipped: boolean;
  /** Equipe le meme montre pour son mouvement. */
  readonly onEquipMeme: () => void;
  readonly onPlay: () => void;
  readonly onProfile: () => void;
  readonly onSettings: () => void;
  readonly onLeaderboard: () => void;
  readonly onWardrobe: () => void;
  readonly onShop: () => void;
  /** Cherche un adversaire : c est le chemin normal vers un duel. */
  readonly onOnline: () => void;
  /** Jouer avec quelqu un qu on connait, par code. */
  readonly onInvite: () => void;
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
  mode,
  onToggleMode,
  meme,
  onStepMeme,
  memeOwned,
  memeEquipped,
  onEquipMeme,
  onPlay,
  onProfile,
  onSettings,
  onLeaderboard,
  onWardrobe,
  onShop,
  onOnline,
  onInvite,
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

      {/*
        Le bas de l'ecran : deux colonnes, une par pouce.

        A gauche la galerie et le rail, a droite le lancement. Les trois
        grappes ont d'abord vecu dans UNE rangee, parce qu'en absolu elles se
        recouvraient des que l'ecran retrecissait. Une rangee ne peut pas se
        chevaucher — mais elle peut ECRASER : a 844 px le rail prenait 451 px
        et le lancement 266, il restait 87 px a une galerie dont les deux
        seules fleches en font deja 92. La carte tombait a 26 px de large et
        son nom courait cent pixels sous le bouton de duel.

        Deux colonnes reglent ca a la racine : la galerie ne dispute plus sa
        largeur a personne, elle prend celle du rail qu'elle surmonte.
      */}
      <div className="home__bottom">
        <div className="home__left">
          {/*
        La galerie de memes.

        Une aura battle est un clash ou deux personnes rejouent des memes : ce
        qu'on vient voir sur l'accueil, c'est SON mème, joue par son propre
        personnage. D'ou une galerie qui pilote le personnage au centre plutot
        qu'une grille de vignettes — un mème est un mouvement, une vignette ne
        le montre pas.
      */}
          <div className="memes" aria-label="Galerie de mèmes">
            <button
              type="button"
              className="memes__arrow"
              onClick={() => {
                onStepMeme(-1);
              }}
              aria-label="Mème précédent"
            >
              ‹
            </button>
            {/*
          Une seule commande, dont le libelle dit l'etat.

          Trois boutons — equiper, acheter, « deja equipe » — demanderaient au
          joueur de lire avant d'agir. Ici le meme montre est soit le sien,
          soit a prendre, et le bouton le dit.
        */}
            <button
              type="button"
              className="memes__card"
              onClick={onEquipMeme}
              disabled={!memeOwned || memeEquipped}
              data-owned={memeOwned}
            >
              <span className="memes__name">{meme.name}</span>
              <span className="memes__meta">
                <span aria-hidden="true">{STYLE_ICONS[meme.style]}</span>
                {tierName(meme.tier).fr}
                {memeEquipped && <span className="memes__state">équipé</span>}
                {!memeEquipped && memeOwned && <span className="memes__state">équiper</span>}
                {!memeOwned && (
                  <span className="memes__price">
                    <span aria-hidden="true">◈</span>
                    {meme.price}
                  </span>
                )}
              </span>
            </button>
            <button
              type="button"
              className="memes__arrow"
              onClick={() => {
                onStepMeme(1);
              }}
              aria-label="Mème suivant"
            >
              ›
            </button>
          </div>

          <nav className="rail" aria-label="Menus">
            <button type="button" className="rail__btn" onClick={onWardrobe} aria-label="Vestiaire">
              <span className="rail__icon" aria-hidden="true">
                👕
              </span>
              <span className="rail__label" aria-hidden="true">
                Vestiaire
              </span>
            </button>
            {/*
            Le classement juste apres le profil : les deux repondent a la meme
            question — ou j'en suis — l'un pour soi, l'autre par rapport aux
            autres.
          */}
            <button
              type="button"
              className="rail__btn"
              onClick={onLeaderboard}
              aria-label="Classement"
            >
              <span className="rail__icon" aria-hidden="true">
                🏆
              </span>
              <span className="rail__label" aria-hidden="true">
                Classement
              </span>
            </button>
            <button type="button" className="rail__btn" onClick={onProfile} aria-label="Profil">
              <span className="rail__icon" aria-hidden="true">
                📊
              </span>
              <span className="rail__label" aria-hidden="true">
                Profil
              </span>
            </button>
            <button type="button" className="rail__btn" onClick={onShop} aria-label="Boutique">
              <span className="rail__icon" aria-hidden="true">
                🛒
              </span>
              <span className="rail__label" aria-hidden="true">
                Boutique
              </span>
            </button>
            {/*
            Dernier du rail, et c'est voulu : on vient ici quand quelque chose
            ne va pas, pas a chaque partie. Sous 780 px le libelle disparait
            comme celui des autres et il ne reste que l'icone — la rangee du
            bas ne gagne alors que 54 px.
          */}
            <button type="button" className="rail__btn" onClick={onSettings} aria-label="Réglages">
              <span className="rail__icon" aria-hidden="true">
                ⚙️
              </span>
              <span className="rail__label" aria-hidden="true">
                Réglages
              </span>
            </button>
          </nav>
        </div>

        <div className="launch">
          {/*
          Le mode se choisit ici, pas dans un menu.

          Classé et rapide se jouent exactement pareil — seul compte ce qu'on
          risque. Enterrer ce choix dans un ecran d'options ferait jouer la
          moitie des gens dans le mode qu'ils n'ont pas choisi.
        */}
          <button
            type="button"
            className="launch__mode"
            onClick={onToggleMode}
            aria-pressed={mode === 'ranked'}
          >
            <b>{mode === 'ranked' ? 'Classé' : 'Partie rapide'}</b>
            <small>{mode === 'ranked' ? 'Ta ligue bouge' : 'Rien à perdre'}</small>
          </button>
          <div className="launch__row">
            {/*
            Un seul gros bouton, et il cherche un adversaire.

            C'est le mode que le jeu existe pour offrir, et il ne doit rien
            demander : un joueur seul devant son telephone appuie et joue. Le
            code d'invitation et le solo restent accessibles, mais en second —
            ce sont des detours, pas le chemin.
          */}
            <button type="button" className="launch__btn" onClick={onOnline}>
              Duel
            </button>
            <div className="launch__side">
              <button type="button" className="launch__alt" onClick={onInvite}>
                Code
              </button>
              <button type="button" className="launch__alt" onClick={onPlay}>
                Solo
              </button>
            </div>
          </div>
        </div>
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
  /**
   * Meme largeur que la boutique, et pour la meme raison : ici aussi le
   * personnage a gauche porte ce qu'on touche a droite. Les pastilles se
   * rangent en ligne, donc la largeur suffit — pas besoin de colonnes.
   */
  readonly layout: PanelLayout;
}

export function WardrobeScreen({ wardrobe, onEquip, onClose, layout }: WardrobeProps): JSX.Element {
  return (
    <section
      className="sheet sheet--veiled"
      aria-label="Vestiaire"
      style={{ width: `${String(layout.width)}px` }}
    >
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
