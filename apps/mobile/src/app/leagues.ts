/**
 * Les ligues, du serveur a l'ecran.
 *
 * Le serveur envoie une CLE (`sans_aura`, `naissante`, …), jamais un libelle.
 * C'est ce qui lui evite de figer du texte francais dans le protocole, et ce
 * qui permettra de traduire le jeu sans toucher a une ligne de serveur.
 *
 * La contrepartie est ici : le client doit connaitre toutes les cles, et une
 * cle inconnue ne doit **jamais** s'afficher telle quelle. Un joueur qui lit
 * « sans_aura » au-dessus de son avatar voit un bug ; un repli honnete ne dit
 * rien de faux.
 */

/** Les six ligues, de la plus basse a la plus haute (`docs/05`). */
export const LEAGUE_KEYS = [
  'sans_aura',
  'naissante',
  'stable',
  'rayonnante',
  'legendaire',
  'infinie',
] as const;

export type LeagueKey = (typeof LEAGUE_KEYS)[number];

const LABELS: Readonly<Record<LeagueKey, string>> = {
  sans_aura: 'Sans aura',
  naissante: 'Aura naissante',
  stable: 'Aura stable',
  rayonnante: 'Aura rayonnante',
  legendaire: 'Aura légendaire',
  infinie: 'Aura infinie',
};

/** Ce qu'on affiche quand le serveur nomme une ligue qu'on ne connait pas. */
const UNKNOWN_LEAGUE = 'Non classé';

export function leagueLabel(key: string): string {
  return LABELS[key as LeagueKey] ?? UNKNOWN_LEAGUE;
}
