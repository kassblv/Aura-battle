import { AURA_EFFECTS } from '@aura/content';
import { describe, expect, it } from 'vitest';
import { AURA_BUDGET } from './aura.js';
import {
  AURA_STYLES,
  type AuraStyle,
  FALLBACK_STYLE,
  styleForEffect,
  totalRate,
} from './auraTheme.js';

const HEX = /^#[0-9a-f]{6}$/;

describe('styleForEffect', () => {
  it('habille les huit effets du catalogue', () => {
    for (const effect of AURA_EFFECTS) {
      expect(styleForEffect(effect.id).id).toBe(effect.id);
    }
    // L inverse aussi : pas de style orphelin qu aucun cosmetique ne vend.
    const sold = new Set(AURA_EFFECTS.map((effect) => effect.id));
    expect(AURA_STYLES.map((style) => style.id).filter((id) => !sold.has(id))).toEqual([]);
  });

  /**
   * Regle du jalon : un cosmetique absent ne casse jamais une manche.
   *
   * Le catalogue du serveur peut devancer celui du client (achat fait sur une
   * autre version, contenu pousse en cours de saison). Lever ici, c est priver
   * le joueur de sa manche pour une histoire d apparence.
   */
  it('retombe sur la Lueur sans lever pour un effet inconnu', () => {
    for (const unknown of ['fx.inexistant', '', 'glow', 'FX.GLOW', 'anim.system.charge']) {
      expect(styleForEffect(unknown)).toBe(FALLBACK_STYLE);
    }
    expect(styleForEffect(undefined)).toBe(FALLBACK_STYLE);
    expect(styleForEffect(null)).toBe(FALLBACK_STYLE);
    expect(FALLBACK_STYLE.id).toBe('fx.glow');
  });
});

describe('table des effets', () => {
  it('emet quelque chose pour chaque effet, la Lueur comprise', () => {
    // Le prototype donnait une cadence nulle a la Lueur : l effet offert a
    // tous etait litteralement invisible.
    for (const style of AURA_STYLES) {
      expect(totalRate(style)).toBeGreaterThan(0);
      expect(style.layers.length).toBeGreaterThan(0);
    }
  });

  it('tient le budget de particules de chaque effet', () => {
    // cadence x duree de vie maximale = particules vivantes a intensite 1. Au
    // dela du budget, l emetteur cesse d emettre et l effet se met a clignoter
    // au lieu de couler.
    for (const style of AURA_STYLES) {
      const alive = style.layers.reduce((sum, l) => sum + l.rate * l.life.max, 0);
      expect(alive, style.id).toBeLessThanOrEqual(AURA_BUDGET);
    }
  });

  it('n ecrit que des couleurs hexadecimales completes', () => {
    for (const style of AURA_STYLES) {
      for (const layer of style.layers) {
        for (const tint of layer.tints) {
          if (tint !== null) expect(tint, style.id).toMatch(HEX);
        }
        if (layer.coreTint !== null) expect(layer.coreTint, style.id).toMatch(HEX);
      }
    }
  });

  it('garde des intervalles bien ordonnes', () => {
    for (const style of AURA_STYLES) {
      for (const layer of style.layers) {
        for (const [name, range] of Object.entries({
          life: layer.life,
          size: layer.size,
          height: layer.height,
          spread: layer.spread,
          speed: layer.speed,
          drift: layer.drift,
          radius: layer.radius,
        })) {
          expect(range.min, `${style.id}.${name}`).toBeLessThanOrEqual(range.max);
        }
        expect(layer.life.min, style.id).toBeGreaterThan(0);
        expect(layer.size.min, style.id).toBeGreaterThan(0);
      }
    }
  });

  /**
   * Un joueur qui paie 900 pieces pour la Galaxie doit voir pourquoi.
   *
   * Deux effets qui ne different que par une teinte sont indiscernables sur un
   * ecran de telephone : on exige donc une signature de mouvement propre a
   * chacun — formes employees, tailles, cadence, eclairs.
   */
  it('donne a chaque effet une signature visuelle differente', () => {
    const signature = (style: AuraStyle): string =>
      [
        [...new Set(style.layers.map((l) => l.shape))].sort().join('+'),
        Math.round(totalRate(style)),
        style.layers.some((l) => l.size.max > 0.08) ? 'gros' : 'fin',
        style.bolts === null ? 'sans-eclair' : 'eclairs',
        style.layers.some((l) => !l.additive) ? 'opaque' : 'lumineux',
        style.layers.some((l) => l.twinkle) ? 'scintille' : 'stable',
        style.layers.map((l) => l.tilt.toFixed(2)).join(','),
      ].join('|');

    const seen = new Map<string, string>();
    for (const style of AURA_STYLES) {
      const key = signature(style);
      expect(seen.get(key), `${style.id} ressemble a ${seen.get(key) ?? ''}`).toBeUndefined();
      seen.set(key, style.id);
    }
  });

  it('distingue le Vortex de la Galaxie par le rayon, la vitesse et l inclinaison', () => {
    const vortex = styleForEffect('fx.vortex').layers[0]!;
    const galaxy = styleForEffect('fx.galaxy').layers[0]!;
    // Serre et rapide contre large et lent : c est ce qui les separe de loin.
    expect(vortex.radius.max).toBeLessThan(galaxy.radius.min);
    expect(vortex.speed.min).toBeGreaterThan(galaxy.speed.max);
    expect(vortex.tilt).toBe(0);
    expect(galaxy.tilt).toBeGreaterThan(0.2);
  });

  it('ne fait craquer la Galaxie qu au sommet de l intensite', () => {
    // Sinon elle imite les Éclairs, qui eux craquent des le repos.
    expect(styleForEffect('fx.galaxy').bolts?.minIntensity).toBeGreaterThan(0.5);
    expect(styleForEffect('fx.lightning').bolts?.minIntensity).toBe(0);
  });
});
