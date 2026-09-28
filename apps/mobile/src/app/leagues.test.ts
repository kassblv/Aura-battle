import { describe, expect, it } from 'vitest';
import { LEAGUE_KEYS, leagueLabel } from './leagues.js';

describe('leagueLabel', () => {
  it('nomme chaque ligue du serveur', () => {
    for (const key of LEAGUE_KEYS) {
      expect(leagueLabel(key)).not.toBe('');
    }
  });

  it('donne un nom distinct a chacune', () => {
    expect(new Set(LEAGUE_KEYS.map(leagueLabel)).size).toBe(LEAGUE_KEYS.length);
  });

  /**
   * Le serveur envoie une CLE, jamais un libelle.
   *
   * C'est ce qui lui evite de figer du texte francais dans le protocole, et ce
   * qui permettra de traduire le jeu sans toucher au serveur. Mais cela veut
   * dire que le client doit connaitre toutes les cles — et qu'une cle qu'il ne
   * connait pas ne doit pas s'afficher telle quelle : « sans_aura » a l'ecran
   * est pire qu'un repli honnete.
   */
  it('ne montre jamais une cle brute au joueur', () => {
    expect(leagueLabel('sans_aura')).not.toContain('_');
    expect(leagueLabel('ligue_inventee_par_le_futur')).not.toContain('_');
    expect(leagueLabel('')).not.toBe('');
  });

  it('traduit les six ligues du game design', () => {
    expect(leagueLabel('sans_aura')).toBe('Sans aura');
    expect(leagueLabel('naissante')).toBe('Aura naissante');
    expect(leagueLabel('stable')).toBe('Aura stable');
    expect(leagueLabel('rayonnante')).toBe('Aura rayonnante');
    expect(leagueLabel('legendaire')).toBe('Aura légendaire');
    expect(leagueLabel('infinie')).toBe('Aura infinie');
  });

  /** L'ordre est celui de la progression, pas celui de l'alphabet. */
  it('range les ligues de la plus basse a la plus haute', () => {
    expect([...LEAGUE_KEYS]).toEqual([
      'sans_aura',
      'naissante',
      'stable',
      'rayonnante',
      'legendaire',
      'infinie',
    ]);
  });
});
