import { BALANCE, cursorPosition, evaluateTiming, type GaugeParams } from '@aura/rules';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { contrastRatio, mix } from './color.js';
import {
  CENTERED_ZONES,
  chargeClock,
  gaugeBands,
  needlePosition,
  percent,
  resolveZones,
  type MeterZones,
} from './gauge.js';
import { DARK } from './theme.js';

const PERIOD_MS = 1_700;

const meter = (center: number): GaugeParams => ({
  periodMs: PERIOD_MS,
  center,
  zoneWidth: BALANCE.timing.zoneWidth,
  perfectWidth: BALANCE.timing.perfectWidth,
});

/** Centres representatifs, bornes du moteur comprises. */
const CENTERS = [
  BALANCE.timing.centerMin,
  0.37,
  0.5,
  0.63,
  BALANCE.timing.centerMax,
] as const satisfies readonly number[];

describe('gaugeBands', () => {
  it('centre les deux bandes sur le centre tire par le moteur', () => {
    for (const center of CENTERS) {
      const bands = gaugeBands(meter(center));
      expect(bands.good.left + bands.good.width / 2, `bon @${String(center)}`).toBeCloseTo(
        center,
        10,
      );
      expect(
        bands.perfect.left + bands.perfect.width / 2,
        `parfait @${String(center)}`,
      ).toBeCloseTo(center, 10);
    }
  });

  /**
   * La feuille de style peignait 40 % pour une zone de 22 % et 9 % pour une
   * zone de 8 % : le dessin etait presque deux fois trop large, donc presque
   * toujours menteur, meme quand le centre tombait par chance sur 0,5.
   */
  it('donne aux bandes exactement les largeurs du moteur', () => {
    const bands = gaugeBands(meter(0.5));
    expect(bands.good.width).toBeCloseTo(BALANCE.timing.zoneWidth, 10);
    expect(bands.perfect.width).toBeCloseTo(BALANCE.timing.perfectWidth, 10);
  });

  it('inscrit la zone parfaite dans la zone bonne', () => {
    for (const center of CENTERS) {
      const { good, perfect } = gaugeBands(meter(center));
      expect(perfect.left).toBeGreaterThanOrEqual(good.left);
      expect(perfect.left + perfect.width).toBeLessThanOrEqual(good.left + good.width);
    }
  });

  /**
   * Le moteur borne le centre a [0,30 ; 0,70], mais `balance.ts` peut bouger.
   * Une bande qui deborde la piste dessinerait une zone plus petite qu'elle
   * n'est — donc une jauge plus severe qu'elle ne note.
   */
  it('rogne les bandes aux bords de la piste, sans largeur negative', () => {
    for (const center of [0, 0.02, 0.98, 1]) {
      const { good, perfect } = gaugeBands(meter(center));
      for (const [name, b] of [
        ['bon', good],
        ['parfait', perfect],
      ] as const) {
        expect(b.left, `${name} @${String(center)}`).toBeGreaterThanOrEqual(0);
        expect(b.width, `${name} @${String(center)}`).toBeGreaterThanOrEqual(0);
        expect(b.left + b.width, `${name} @${String(center)}`).toBeLessThanOrEqual(1);
      }
    }
  });
});

/**
 * Le test qui compte.
 *
 * Il confronte ce que le joueur **voit** a ce que le serveur **note**. Tant
 * que les deux venaient de sources differentes — des pourcentages ecrits dans
 * la feuille de style d'un cote, `evaluateTiming` de l'autre — cette egalite
 * n'avait aucune raison de tenir, et elle ne tenait pas.
 */
describe('la bande peinte dit la note', () => {
  /** Marge sautee autour des frontieres : un pixel de flottant n'est pas un bug. */
  const EDGE = 1e-4;

  const paintedQuality = (position: number, zones: MeterZones): string => {
    const { good, perfect } = gaugeBands(zones);
    if (position >= perfect.left && position <= perfect.left + perfect.width) return 'perfect';
    if (position >= good.left && position <= good.left + good.width) return 'good';
    return 'miss';
  };

  const edges = (zones: MeterZones): readonly number[] => {
    const { good, perfect } = gaugeBands(zones);
    return [good.left, good.left + good.width, perfect.left, perfect.left + perfect.width];
  };

  it('accorde le dessin et `evaluateTiming` sur toute une periode', () => {
    for (const center of CENTERS) {
      const params = meter(center);
      const skip = edges(params);
      let perfects = 0;
      for (let tapAtMs = 0; tapAtMs <= PERIOD_MS; tapAtMs += 0.5) {
        const position = needlePosition(tapAtMs, PERIOD_MS);
        if (skip.some((edge) => Math.abs(position - edge) < EDGE)) continue;
        const painted = paintedQuality(position, params);
        if (painted === 'perfect') perfects += 1;
        expect(painted, `centre ${String(center)}, ${String(tapAtMs)} ms`).toBe(
          evaluateTiming(tapAtMs, params).quality,
        );
      }
      // Un accord obtenu parce que la zone doree n'est jamais atteinte ne
      // prouverait rien : le balayage doit vraiment y passer.
      expect(perfects, `centre ${String(center)}`).toBeGreaterThan(0);
    }
  });
});

describe('needlePosition', () => {
  it('reprend l onde du moteur, sans la reecrire', () => {
    for (let tapAtMs = 0; tapAtMs <= PERIOD_MS; tapAtMs += 7) {
      expect(needlePosition(tapAtMs, PERIOD_MS)).toBe(cursorPosition(tapAtMs, PERIOD_MS));
    }
  });

  /**
   * Le contrat d'horloge.
   *
   * `match.gateway.ts` note `evaluateTiming(tapAt - chargeAt, ...)`. Le curseur
   * doit donc etre dessine sur cette meme horloge, et pas sur celle de la
   * phase : avec une periode de 1,7 s, cinq secondes de reflexion suffisaient a
   * mettre l'aiguille affichee en opposition avec celle qui compte. C'est aussi
   * ce qui rend la jauge muette avant le choix du mouvement — il n'y a pas
   * encore d'instant d'armement d'ou partir.
   */
  it('part de l armement, comme le serveur', () => {
    const params = meter(0.5);
    for (const chargeAtMs of [0, 400, 2_500, 9_800]) {
      for (let inPhaseMs = chargeAtMs; inPhaseMs <= chargeAtMs + 5_000; inPhaseMs += 13) {
        const sinceCharge = inPhaseMs - chargeAtMs;
        const drawn = needlePosition(sinceCharge, PERIOD_MS);
        // Ce que le serveur evaluera pour ce meme appui.
        const scored = cursorPosition(sinceCharge, params.periodMs);
        expect(drawn, `charge ${String(chargeAtMs)}, tap ${String(inPhaseMs)}`).toBe(scored);
      }
    }
  });

  /** Aucun curseur avant l'armement : une horloge negative n'existe pas. */
  it('ne recule pas avant l armement', () => {
    expect(needlePosition(-1, PERIOD_MS)).toBe(0);
    expect(needlePosition(-5_000, PERIOD_MS)).toBe(0);
  });

  it('reste dans [0, 1]', () => {
    for (let tapAtMs = 0; tapAtMs <= 4 * PERIOD_MS; tapAtMs += 3) {
      const position = needlePosition(tapAtMs, PERIOD_MS);
      expect(position).toBeGreaterThanOrEqual(0);
      expect(position).toBeLessThanOrEqual(1);
    }
  });

  /** Entre le debut de la phase et `choice:start`, la periode vaut encore 0. */
  it('ne dessine pas un curseur `NaN` quand la periode manque', () => {
    expect(needlePosition(1_200, 0)).toBe(0);
    expect(needlePosition(1_200, -1)).toBe(0);
  });
});

describe('chargeClock', () => {
  it('ne rend rien tant que la jauge n est pas armee', () => {
    expect(chargeClock(0, null)).toBeNull();
    expect(chargeClock(9_000, null)).toBeNull();
  });

  it('compte a partir de l armement', () => {
    expect(chargeClock(2_500, 2_000)).toBe(500);
    expect(chargeClock(2_000, 2_000)).toBe(0);
  });

  /** Une horloge locale peut reculer d un poil entre deux images. */
  it('ne descend pas sous zero', () => {
    expect(chargeClock(1_990, 2_000)).toBe(0);
  });
});

describe('resolveZones', () => {
  it('prend le centre de la manche des qu il existe', () => {
    expect(resolveZones({ center: 0.42, zoneWidth: 0.2, perfectWidth: 0.06 })).toEqual({
      center: 0.42,
      zoneWidth: 0.2,
      perfectWidth: 0.06,
    });
  });

  it('se rabat sur une jauge centree, aux largeurs du moteur', () => {
    expect(resolveZones({})).toEqual(CENTERED_ZONES);
    expect(CENTERED_ZONES.zoneWidth).toBe(BALANCE.timing.zoneWidth);
    expect(CENTERED_ZONES.perfectWidth).toBe(BALANCE.timing.perfectWidth);
  });
});

describe('percent', () => {
  it('emet une longueur CSS au centieme', () => {
    expect(percent(0)).toBe('0.00%');
    expect(percent(1)).toBe('100.00%');
    expect(percent(0.393_21)).toBe('39.32%');
  });
});

/**
 * Lisibilite de la jauge.
 *
 * Elle est posee au milieu de l'ecran, sur la foule 3D. Les valeurs testees
 * ici sont celles de `styles.css` : le dernier cas du bloc verifie qu'elles
 * n'ont pas divergé, sans quoi ce test garantirait une jauge qui n'existe pas.
 */
describe('contraste de la jauge', () => {
  const PANEL = DARK.surface;
  const TRACK = DARK.chipDeep;
  const GOOD_MIX = 0.5;
  const GOOD = mix(DARK.goodInk, DARK.chipDeep, GOOD_MIX);
  const PERFECT = DARK.goldInk;

  const zones = [
    ['faible (fond de piste)', TRACK],
    ['bon', GOOD],
    ['parfait', PERFECT],
  ] as const;

  it('separe les trois zones d au moins 3:1', () => {
    for (const [a, b] of [
      ['faible/bon', [TRACK, GOOD]],
      ['bon/parfait', [GOOD, PERFECT]],
      ['faible/parfait', [TRACK, PERFECT]],
    ] as const) {
      expect(contrastRatio(b[0], b[1]), a).toBeGreaterThanOrEqual(3);
    }
  });

  /**
   * Le curseur est un coeur clair borde de sombre. Un trait blanc seul tombe a
   * 1,3:1 sur l'or — invisible exactement la ou le joueur vise.
   */
  it('garde le curseur visible sur chaque zone', () => {
    for (const [name, zone] of zones) {
      const best = Math.max(contrastRatio(DARK.ink, zone), contrastRatio(DARK.bg, zone));
      expect(best, `curseur sur ${name}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('pose la legende a 4,5:1 sur le panneau', () => {
    for (const [name, color] of [
      ['faible', DARK.muted],
      ['bon', DARK.goodInk],
      ['parfait', DARK.goldInk],
    ] as const) {
      expect(contrastRatio(color, PANEL), name).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('detache le panneau de son contour', () => {
    expect(contrastRatio(DARK.line, PANEL)).toBeGreaterThanOrEqual(1.4);
  });

  it('teste bien les couleurs que la feuille de style peint', () => {
    const css = readFileSync(fileURLToPath(new URL('../styles.css', import.meta.url)), 'utf8');
    expect(css).toContain('background: var(--surface)');
    expect(css).toContain(
      `background: color-mix(in srgb, var(--good-ink) ${String(GOOD_MIX * 100)}%, var(--chip-deep))`,
    );
    expect(css).toContain('.gauge__track');
    // Plus une seule position dans la feuille : elles viennent toutes d'ici.
    expect(css).not.toContain('.gauge__good');
    expect(css).not.toContain('.gauge__perfect');
  });
});
