import { describe, expect, it } from 'vitest';
import { QUALITY_TIERS } from '../platform/quality.js';
import { qualityNote, qualityOptions } from './settings.js';

describe('qualityOptions', () => {
  it('propose l automatique et les trois paliers, dans cet ordre', () => {
    expect(qualityOptions('auto').map((o) => o.id)).toEqual([
      'auto',
      'rich',
      'balanced',
      'smooth',
    ]);
  });

  it('marque le reglage choisi, et lui seul', () => {
    for (const setting of ['auto', ...QUALITY_TIERS] as const) {
      const selected = qualityOptions(setting).filter((o) => o.selected);
      expect(selected).toHaveLength(1);
      expect(selected[0]?.id).toBe(setting);
    }
  });

  it('donne un nom francais a chaque palier', () => {
    const labels = qualityOptions('auto').map((o) => o.label);
    expect(labels).toEqual(['Automatique', 'Beau', 'Équilibré', 'Fluide']);
    expect(qualityOptions('auto').every((o) => o.hint.length > 0)).toBe(true);
  });
});

describe('qualityNote', () => {
  /*
    Une descente automatique retire de la foule et baisse la resolution sans
    rien dire. Si l ecran n affiche que « Automatique », le joueur n a aucun
    moyen de distinguer un reglage qui travaille d un jeu qui s abime — et il
    ira chercher la panne ailleurs. Le palier reellement applique est donc
    nomme, toujours.
  */
  it('nomme le palier reellement applique en automatique', () => {
    expect(qualityNote('auto', 'rich')).toContain('Beau');
    expect(qualityNote('auto', 'balanced')).toContain('Équilibré');
    expect(qualityNote('auto', 'smooth')).toContain('Fluide');
  });

  it('dit que l automatique ne remonte pas tout seul', () => {
    expect(qualityNote('auto', 'smooth')).toMatch(/remonte|manuel|main/i);
  });

  it('ne parle pas de mesure quand le joueur a choisi', () => {
    for (const tier of QUALITY_TIERS) {
      expect(qualityNote(tier, tier)).not.toContain('Automatique');
    }
  });
});
