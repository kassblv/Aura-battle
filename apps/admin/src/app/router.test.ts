import { describe, expect, it } from 'vitest';
import { href, parseRoute, sectionOf } from './router.js';

describe('routage par le hash', () => {
  it('reconnait chaque page', () => {
    expect(parseRoute('')).toEqual({ name: 'dashboard' });
    expect(parseRoute('#/')).toEqual({ name: 'dashboard' });
    expect(parseRoute('#/experiences')).toEqual({ name: 'experiments' });
    expect(parseRoute('#/evenements')).toEqual({ name: 'events' });
    expect(parseRoute('#/joueurs')).toEqual({ name: 'players' });
    expect(parseRoute('#/joueurs/')).toEqual({ name: 'players' });
    expect(parseRoute('#/journal')).toEqual({ name: 'audit' });
  });

  it('decode l identifiant d une fiche joueur, aller-retour avec href', () => {
    expect(parseRoute(href.player('a/b c'))).toEqual({ name: 'player', id: 'a/b c' });
    expect(sectionOf(parseRoute('#/joueurs/p_1'))).toBe('players');
  });

  it('une adresse inconnue ou mal encodee ne plante pas', () => {
    expect(parseRoute('#/players')).toEqual({ name: 'unknown' });
    expect(parseRoute('#/joueurs/%E0%A4%A')).toEqual({ name: 'unknown' });
    expect(parseRoute('#/joueurs/a/b')).toEqual({ name: 'unknown' });
  });
});
