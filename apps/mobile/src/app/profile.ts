import { STYLES, type Style } from '@aura/content';

/**
 * Le profil du joueur, et ce qu on en deduit.
 *
 * Rien de derive n est stocke : ni taux de victoire, ni nombre de defaites, ni
 * part par style. Un chiffre stocke a cote de ses compteurs finit toujours par
 * les contredire — apres une correction de match, une migration, ou un simple
 * oubli de mise a jour — et c est alors l ecran de profil qui ment au joueur
 * sur sa propre partie.
 */

export interface PlayerProfile {
  readonly name: string;
  /** Identifiant affichable, unique : deux joueurs peuvent porter le meme nom. */
  readonly tag: string;
  readonly league: string;
  readonly lp: number;
  /** Seuil de la ligue suivante. Zero en derniere ligue. */
  readonly lpForNextLeague: number;
  readonly matches: number;
  readonly wins: number;
  readonly currentStreak: number;
  readonly bestStreak: number;
  readonly roundsByStyle: Readonly<Record<Style, number>>;
  readonly wallet: Wallet;
}

/**
 * Les deux monnaies.
 *
 * `soft` se gagne en jouant, `hard` s achete. Aucune des deux ne touche un
 * score : elles n ouvrent que la boutique, qui ne vend que de l apparence
 * (regle d or n°3).
 */
export interface Wallet {
  readonly soft: number;
  readonly hard: number;
}

/** Peut-on payer ce prix ? Un objet offert reste accessible a zero. */
export function canAfford(profile: PlayerProfile, price: number): boolean {
  if (price < 0) return false;
  return profile.wallet.soft >= price;
}

export interface ProfileStats {
  readonly matches: number;
  readonly wins: number;
  readonly losses: number;
  /** Entre 0 et 1. Zero pour un joueur qui n a pas encore joue. */
  readonly winRate: number;
  readonly currentStreak: number;
  readonly bestStreak: number;
}

export function summarize(profile: PlayerProfile): ProfileStats {
  const { matches, wins } = profile;
  return {
    matches,
    wins,
    losses: Math.max(0, matches - wins),
    winRate: matches > 0 ? wins / matches : 0,
    currentStreak: profile.currentStreak,
    bestStreak: profile.bestStreak,
  };
}

/**
 * Part parcourue vers la ligue suivante, entre 0 et 1.
 *
 * Bornee : depasser le seuil sans etre encore promu est un etat normal entre
 * deux calculs de classement, et une barre qui deborde de son cadre se lit
 * comme un defaut d affichage.
 */
export function leagueProgress(profile: PlayerProfile): number {
  if (profile.lpForNextLeague <= 0) return 0;
  return Math.min(1, Math.max(0, profile.lp / profile.lpForNextLeague));
}

export interface StyleShare {
  readonly style: Style;
  readonly rounds: number;
  /** Part du total, entre 0 et 1. */
  readonly share: number;
}

/** Repartition des manches par style, dans l ordre du cycle de contres. */
export function styleShares(profile: PlayerProfile): readonly StyleShare[] {
  const total = STYLES.reduce((sum, style) => sum + profile.roundsByStyle[style], 0);
  return STYLES.map((style) => {
    const rounds = profile.roundsByStyle[style];
    return { style, rounds, share: total > 0 ? rounds / total : 0 };
  });
}

/**
 * Le profil d'un joueur qui vient d'arriver.
 *
 * Tout a zero, sans exception. Montrer des chiffres inventes a quelqu'un qui
 * n'a pas encore joue n'est pas une coquetterie d'affichage : c'est une valeur
 * fausse presentee comme la sienne, et la premiere chose que le jeu lui
 * apprendrait serait de ne pas croire ce qu'il affiche.
 */
export function newProfile(name: string, playerId: string): PlayerProfile {
  return {
    name,
    tag: playerTag(name, playerId),
    league: 'Non classé',
    lp: 0,
    // Le premier palier de classement : il donne une cible des la premiere partie.
    lpForNextLeague: 100,
    matches: 0,
    wins: 0,
    currentStreak: 0,
    bestStreak: 0,
    roundsByStyle: { calme: 0, hype: 0, provoc: 0 },
    wallet: { soft: 0, hard: 0 },
  };
}

/**
 * Le tag affichable d'un joueur, du type `KAS#4417`.
 *
 * Les noms ne sont pas uniques — c'est un choix, pas un oubli (voir
 * `ProfileService.rename`). Le tag est ce qui distingue deux Kassim, et il est
 * derive de l'identifiant : stable d'une session a l'autre, et different pour
 * deux joueurs de meme nom.
 */
export function playerTag(name: string, playerId: string): string {
  const letters =
    name
      .toUpperCase()
      .replace(/[^A-Z]/g, '')
      .slice(0, 3) || 'AUR';

  // Somme de controle simple : on ne cherche ni unicite ni resistance, juste
  // un nombre stable que le serveur pourra remplacer par le vrai au jalon M5.
  let hash = 0;
  for (const character of playerId) {
    hash = (hash * 31 + character.charCodeAt(0)) % 10_000;
  }
  return `${letters}#${String(hash).padStart(4, '0')}`;
}
