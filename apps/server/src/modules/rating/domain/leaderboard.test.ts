import { describe, expect, it } from 'vitest';
import { LEADERBOARD_TOP, NEIGHBOURS, leaderboardView, type RankedRow } from './leaderboard.js';

const row = (rank: number, lp: number, id = `p${String(rank)}`): RankedRow => ({
  rank,
  playerId: id,
  displayName: `Joueur ${String(rank)}`,
  leaguePoints: lp,
  league: 'OR_II',
  wins: 10,
  losses: 5,
});

const top = (n: number): RankedRow[] =>
  Array.from({ length: n }, (_, i) => row(i + 1, 1_000 - i * 10));

describe('leaderboardView', () => {
  it('rend la tete du classement', () => {
    const view = leaderboardView({ top: top(5), around: [], me: null });
    expect(view.top.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(view.me).toBeNull();
  });

  /*
    Montrer seulement les cent premiers ne dit rien a quatre-vingt-dix-neuf
    joueurs sur cent. La question qu'on se pose devant un classement, c'est
    « ou suis-je » — pas « qui est premier ». La vue porte donc les deux.
  */
  it('rend aussi le voisinage du joueur', () => {
    const me = row(47, 530, 'moi');
    const around = [row(45, 550), row(46, 540), me, row(48, 520), row(49, 510)];

    const view = leaderboardView({ top: top(3), around, me });
    expect(view.me?.rank).toBe(47);
    expect(view.around.map((r) => r.rank)).toEqual([45, 46, 47, 48, 49]);
  });

  /*
    Quand le joueur EST dans la tete, ses voisins y sont aussi — a deux lignes
    de la sienne. Les renvoyer remplirait la colonne « ta place » d'un extrait
    de la colonne d'a cote. Sa propre ligne, elle, reste rendue : l'ecran la
    montre sous « ta place », et c'est ce qui repond a « ou suis-je » sans
    faire defiler cinquante lignes.
  */
  it('ne repete pas les voisins deja visibles dans la tete', () => {
    const me = row(3, 980);
    const view = leaderboardView({ top: top(5), around: [row(2, 990), me, row(4, 970)], me });

    expect(view.around).toEqual([]);
    expect(view.me?.rank).toBe(3);
  });

  it('garde le voisinage quand le joueur est juste sous la tete', () => {
    const me = row(LEADERBOARD_TOP + 1, 100, 'moi');
    const view = leaderboardView({ top: top(LEADERBOARD_TOP), around: [me], me });
    expect(view.around).toHaveLength(1);
  });

  /*
    Un joueur qui n'a jamais fini de match classe n'a pas de ligne de
    classement. Ce n'est pas une anomalie : c'est le cas de tous ceux qui
    viennent d'arriver, et l'ecran doit le dire au lieu d'inventer un rang.
  */
  it('accepte un joueur sans classement', () => {
    const view = leaderboardView({ top: top(3), around: [], me: null });
    expect(view.me).toBeNull();
    expect(view.around).toEqual([]);
  });

  it('marque le joueur dans les deux listes', () => {
    const me = row(2, 990, 'moi');
    const view = leaderboardView({ top: [row(1, 1000), me, row(3, 980)], around: [], me });
    expect(view.top.find((r) => r.playerId === 'moi')?.isMe).toBe(true);
    expect(view.top.find((r) => r.playerId === 'p1')?.isMe).toBe(false);
  });

  it('ne marque personne quand on ne sait pas qui regarde', () => {
    const view = leaderboardView({ top: top(3), around: [], me: null });
    expect(view.top.every((r) => !r.isMe)).toBe(true);
  });

  /*
    Les bornes sont nommees plutot qu'eparpillees : l'ecran, la requete et ce
    test doivent parler des memes nombres, sinon la vue promet un voisinage
    que la base ne renvoie pas.
  */
  it('nomme ses bornes', () => {
    expect(LEADERBOARD_TOP).toBeGreaterThanOrEqual(20);
    expect(NEIGHBOURS).toBeGreaterThanOrEqual(2);
  });

  it('ne rend jamais plus que la tete demandee', () => {
    const view = leaderboardView({ top: top(LEADERBOARD_TOP + 20), around: [], me: null });
    expect(view.top).toHaveLength(LEADERBOARD_TOP);
  });
});
