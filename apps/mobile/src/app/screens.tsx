import { styleIcon, tierName } from '@aura/content';
import { NameEditor, type NameEditorProps } from './NameEditor.js';
import { levelFor } from '@aura/rules';
import type { JSX } from 'react';
import type { MemeCard } from './memes.js';
import { leagueProgress, styleShares, summarize, type PlayerProfile } from './profile.js';
import type { HomeClusters } from '../ui/layout.js';
import type { MatchEvent } from '../match/rules.js';

/**
 * Les ecrans hors match.
 *
 * Volontairement sans etat : tout ce qui se decide vit dans `navigation.ts`,
 * `wardrobe.ts` et `profile.ts`, qui se testent sans navigateur. Ce fichier ne
 * fait que mettre en forme. Son seul test (`screens.test.tsx`) verifie ce qui
 * s'affiche ou non selon le mode — l'evenement de la semaine.
 */

const STYLE_COLORS = {
  calme: '#4fc3f7',
  hype: '#ff8a3d',
  provoc: '#c97bff',
  acrobatie: '#7cf29a',
  prouesse: '#ffd54f',
} as const;

const percent = (value: number): string => `${(value * 100).toFixed(1).replace('.', ',')} %`;

export interface HomeProps {
  readonly profile: PlayerProfile;
  /** Mode que lancera le gros bouton. */
  readonly mode: 'ranked' | 'casual';
  /**
   * L'evenement de la semaine en partie rapide, ou `null`. Une annonce : la
   * variante du match, c'est le serveur qui la choisit.
   */
  readonly weekEvent?: MatchEvent | null;
  readonly onToggleMode: () => void;
  /** Le meme actuellement joue par le personnage au centre. */
  readonly meme: MemeCard;
  /** Parcourt la galerie : -1 precedent, +1 suivant. */
  readonly onStepMeme: (delta: number) => void;
  /** Vrai si le joueur possede le meme montre — offert ou achete. */
  readonly memeOwned: boolean;
  /** Vrai si c est deja sa danse signature. */
  readonly memeEquipped: boolean;
  /**
   * En fait sa danse signature — jouee a chaque victoire, vue par
   * l adversaire — et la danse de son mouvement.
   */
  readonly onEquipMeme: () => void;
  readonly onPlay: () => void;
  readonly onProfile: () => void;
  readonly onSettings: () => void;
  readonly onLeaderboard: () => void;
  /**
   * Largeur des deux grappes, de part et d'autre du personnage.
   *
   * Calculee par `homeClusters`, parce que la contrainte n'est pas la largeur
   * de l'ecran mais la CLAIRIERE que la silhouette laisse au milieu — et cette
   * clairiere se mesure, elle ne se devine pas depuis une feuille de style.
   */
  readonly clusters: HomeClusters;
  /** Recompenses qui attendent : la pastille du rail. */
  readonly questsReady: number;
  readonly onChallenges: () => void;
  /** Recompenses du passe de saison a recuperer : sa pastille. */
  readonly seasonReady: number;
  /** La saison finit bientot et des recompenses attendent : la pastille presse. */
  readonly seasonUrgent?: boolean;
  readonly onSeason: () => void;
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
  weekEvent = null,
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
  clusters,
  questsReady,
  onChallenges,
  seasonReady,
  seasonUrgent = false,
  onSeason,
}: HomeProps): JSX.Element {
  return (
    <div className="home">
      <button type="button" className="tag" onClick={onProfile}>
        {/*
          Le niveau sur l'avatar, en ecusson.

          Il lui fallait une place permanente : jusqu'ici il n'existait qu'une
          seconde, sur l'ecran de fin de match. Un compteur qu'on ne voit qu'au
          moment ou il bouge ne donne envie de rien — c'est entre deux parties
          qu'on regarde ou on en est.

          Sur l'avatar plutot qu'en ligne de plus : le bandeau porte deja le
          nom, la ligue et les points, et une quatrieme ligne en ferait un
          tableau.
        */}
        <span className="tag__avatar" aria-hidden="true">
          {profile.name.slice(0, 1)}
          <i className="tag__level">{levelFor(profile.xp).level}</i>
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

      {/*
        Les deux bourses, toujours : les jetons se gagnent en jouant (dix par
        niveau) et s'achetent (ADR 0015 et 0016). Un « 💎 0 » dit qu'ils
        existent, et le prochain niveau dit comment en avoir.
      */}
      <div className="wallet">
        <span className="coin">
          <b aria-hidden="true">◈</b>
          {profile.wallet.soft}
        </span>
        <span className="coin coin--hard">
          <b aria-hidden="true">💎</b>
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
        <div className="home__left" style={{ width: `${String(clusters.left)}px` }}>
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
              aria-label={
                memeEquipped
                  ? `${meme.name} : ta danse signature, jouée à chaque victoire`
                  : memeOwned
                    ? `Faire de ${meme.name} ta danse signature, jouée à chaque victoire`
                    : `${meme.name} : ${String(meme.price)} pièces en boutique`
              }
            >
              <span className="memes__name">{meme.name}</span>
              <span className="memes__meta">
                <span aria-hidden="true">{styleIcon(meme.style)}</span>
                {tierName(meme.tier).fr}
                {memeEquipped && <span className="memes__state">signature</span>}
                {!memeEquipped && memeOwned && <span className="memes__state">choisir</span>}
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

            {/*
              La sixieme case du pave, restee vide depuis qu'il est passe sur
              deux rangees. La pastille dit ce que le rail ne peut pas dire :
              qu'il y a quelque chose a encaisser, sans obliger a ouvrir pour
              le savoir.
            */}
            <button
              type="button"
              className="rail__btn"
              onClick={onChallenges}
              aria-label={
                questsReady > 0
                  ? `Défis du jour, ${String(questsReady)} récompense${questsReady > 1 ? 's' : ''} à encaisser`
                  : 'Défis du jour'
              }
            >
              <span className="rail__icon" aria-hidden="true">
                🎯
              </span>
              <span className="rail__label" aria-hidden="true">
                Défis
              </span>
              {questsReady > 0 && (
                <span className="rail__badge" aria-hidden="true">
                  {questsReady}
                </span>
              )}
            </button>

            {/*
              Le passe de saison, a cote des defis : les deux repondent a
              « qu'est-ce que j'ai a prendre ? », l'un pour aujourd'hui,
              l'autre pour la saison.
            */}
            <button
              type="button"
              className="rail__btn"
              onClick={onSeason}
              aria-label={
                seasonReady > 0
                  ? `Passe de saison, ${String(seasonReady)} récompense${seasonReady > 1 ? 's' : ''} à récupérer${seasonUrgent ? ', la saison se termine bientôt' : ''}`
                  : 'Passe de saison'
              }
            >
              <span className="rail__icon" aria-hidden="true">
                🎖️
              </span>
              <span className="rail__label" aria-hidden="true">
                Saison
              </span>
              {seasonReady > 0 && (
                <span className="rail__badge" aria-hidden="true" data-urgent={seasonUrgent}>
                  {seasonReady}
                </span>
              )}
            </button>
          </nav>
        </div>

        <div className="launch" style={{ width: `${String(clusters.right)}px` }}>
          {/*
            L'evenement de la semaine, en tete de la grappe de lancement.

            DANS la grappe, pas a cote : il herite de sa largeur, celle que
            `homeClusters` laisse a droite du personnage, et ne peut donc pas
            deborder sur lui. Au-dessus du mode parce que la hauteur libre est
            la : entre la bourse, en haut, et le lancement il reste environ
            150 px a 844x390, le bandeau en prend une cinquantaine.

            En partie rapide seulement : le classe joue les regles normales, et
            annoncer un evenement sur un mode qui ne le joue pas serait faux.
          */}
          {mode === 'casual' && weekEvent !== null && (
            <p className="launch__event">
              <b>⚡ Cette semaine : {weekEvent.name}</b>
              <small>{weekEvent.pitch}</small>
            </p>
          )}
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
            aria-label={
              mode === 'casual' && weekEvent !== null
                ? `Partie rapide, événement de la semaine : ${weekEvent.name}. Rien à perdre`
                : undefined
            }
          >
            {mode === 'casual' && weekEvent !== null && (
              <span className="launch__badge" aria-hidden="true">
                ⚡
              </span>
            )}
            <b>{mode === 'ranked' ? 'Classé' : 'Partie rapide'}</b>
            <small>{mode === 'ranked' ? 'Ta ligue bouge' : 'Rien à perdre'}</small>
          </button>
          {/*
            Un seul gros bouton, et il cherche un adversaire.

            C'est le mode que le jeu existe pour offrir, et il ne doit rien
            demander : un joueur seul devant son telephone appuie et joue.

            Il prend TOUTE la largeur de la grappe, et les deux detours passent
            dessous. Cote a cote, « Code » et « Solo » lui prenaient 72 px de
            large et autant d'importance visuelle qu'ils en meritent peu : deux
            cibles empilees a cote du bouton principal se lisent comme un choix
            a trois branches, alors qu'il y a un chemin et deux detours.
          */}
          <button type="button" className="launch__btn" onClick={onOnline}>
            Duel
          </button>
          <div className="launch__alts">
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
  );
}

export interface ProfileProps {
  readonly profile: PlayerProfile;
  readonly onClose: () => void;
  /** Absent hors ligne : sans serveur, le nom ne peut pas changer. */
  readonly rename?: Omit<NameEditorProps, 'name'>;
}

export function ProfileScreen({ profile, onClose, rename }: ProfileProps): JSX.Element {
  const stats = summarize(profile);
  const level = levelFor(profile.xp);
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
      {rename !== undefined && <NameEditor name={profile.name} {...rename} />}

      {/*
        Le niveau et sa barre.

        Juste sous l'identite, avant les statistiques : c'est le seul compteur
        qui monte meme quand on perd, donc celui qu'on vient verifier apres une
        mauvaise soiree.
      */}
      <p className="sheet__level">
        <b>Niveau {level.level}</b>
        <span className="sheet__levelbar">
          <i style={{ width: `${((level.into / level.needed) * 100).toFixed(1)}%` }} />
        </span>
        <small>
          {level.into} / {level.needed} XP
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
              {styleIcon(style)} {style}
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
