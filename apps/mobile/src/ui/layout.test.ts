import { AMPLIFIER_LEVELS, amplifierName, styleName, tierName, TIERS } from '@aura/content';
import { BALANCE } from '@aura/rules';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BAND_GAP,
  bandFit,
  bandHeight,
  GAP,
  chunkEvenly,
  clusterHeight,
  clusterWidth,
  GAUGE_HEIGHT,
  GAUGE_LEGEND,
  GAUGE_MIN_WIDTH,
  BET_HEADER,
  GAUGE_TRACK,
  homeClusters,
  NAME_LONG,
  NAME_MAX,
  PICK_STYLE,
  PICK_TIGHT,
  pickNameClass,
  SAFE_SIDE,
  STYLE_CAPACITY,
  STYLE_COLUMNS,
  SUBJECT_FROM,
  ULTIMATE_HEIGHT,
  SUBJECT_TO,
  styleRows,
  TIER_COLUMNS,
  TOUCH,
} from './layout.js';

/**
 * Formats vises, en paysage.
 *
 * `--safe-bottom` vaut `max(10px, env(safe-area-inset-bottom))` : la barre
 * d'accueil ne mord que sur les appareils qui en ont une.
 */
const DEVICES = [
  { name: 'iPhone SE', width: 667, height: 375, safeBottom: 10 },
  { name: 'Android compact', width: 740, height: 360, safeBottom: 10 },
  { name: 'iPhone 13 mini', width: 812, height: 375, safeBottom: 21 },
  { name: 'iPhone 14', width: 844, height: 390, safeBottom: 21 },
  { name: 'iPhone 15 Pro Max', width: 932, height: 430, safeBottom: 21 },
  { name: 'Pixel 7', width: 915, height: 412, safeBottom: 21 },
] as const;

/** Tailles de catalogue a couvrir : trois aujourd'hui, jusqu'a la capacite de la bande. */
const COUNTS = Array.from({ length: STYLE_CAPACITY }, (_, index) => index + 1);

describe('chunkEvenly', () => {
  it('equilibre les rangees plutot que de les remplir', () => {
    expect(chunkEvenly([1, 2, 3, 4], 3)).toEqual([
      [1, 2],
      [3, 4],
    ]);
    expect(chunkEvenly([1, 2, 3, 4, 5], 3)).toEqual([
      [1, 2, 3],
      [4, 5],
    ]);
    expect(chunkEvenly([1, 2, 3], 3)).toEqual([[1, 2, 3]]);
  });

  it('ne perd ni ne duplique un element, et ne deborde jamais', () => {
    for (const count of COUNTS) {
      const items = Array.from({ length: count }, (_, index) => index);
      const rows = chunkEvenly(items, STYLE_COLUMNS);
      expect(rows.flat(), `${String(count)} styles`).toEqual(items);
      for (const row of rows) {
        expect(row.length, `${String(count)} styles`).toBeLessThanOrEqual(STYLE_COLUMNS);
      }
      const sizes = rows.map((row) => row.length);
      expect(
        Math.max(...sizes) - Math.min(...sizes),
        `${String(count)} styles`,
      ).toBeLessThanOrEqual(1);
    }
  });

  it('rend une liste vide plutot que de planter', () => {
    expect(chunkEvenly([], 3)).toEqual([]);
    expect(chunkEvenly([1], 0)).toEqual([]);
  });
});

describe('le bloc de styles grandit en hauteur', () => {
  /**
   * Une colonne de plus se prend sur la jauge, qui n'a que 163 px sur le plus
   * etroit des ecrans vises ; une rangee de plus se prend sur du vide.
   */
  it('garde sa largeur quel que soit le catalogue', () => {
    const widths = COUNTS.map((count) => bandFit(844, count).styleWidth);
    expect(new Set(widths).size).toBe(1);
  });

  it('tient deux rangees jusqu a la capacite de la bande', () => {
    for (const count of COUNTS) {
      expect(styleRows(count), `${String(count)} styles`).toBeLessThanOrEqual(2);
      expect(chunkEvenly(Array.from({ length: count }), STYLE_COLUMNS).length).toBe(
        styleRows(count),
      );
    }
  });

  /**
   * Le garde-fou du catalogue.
   *
   * Sept styles ne tiennent plus : il faudrait soit une troisieme rangee, qui
   * monte sur les jambes des combattants, soit une quatrieme colonne, qui
   * descend la jauge sous sa largeur utile. Ce test tombe ce jour-la, et c'est
   * exactement ce qu'on veut : la decision doit etre prise, pas subie.
   */
  it('signale le jour ou le catalogue depasse la bande', () => {
    expect(BALANCE.styles.length).toBeLessThanOrEqual(STYLE_CAPACITY);
    expect(styleRows(STYLE_CAPACITY)).toBe(2);
    expect(styleRows(STYLE_CAPACITY + 1)).toBe(3);
  });
});

/**
 * Le test que la mise en page doit a l'utilisateur.
 *
 * La bande tenait par un accord tacite — « trois styles font 162 px, donc la
 * jauge de 420 px centree passe ». Elle ne passait pas : la jauge chevauchait
 * les personnages, et le quatrieme style aurait chevauche la jauge. Ici on
 * mesure au lieu de supposer.
 */
describe('la bande tient dans l ecran, quel que soit le catalogue', () => {
  it('laisse a la jauge une largeur exploitable', () => {
    for (const device of DEVICES) {
      for (const count of COUNTS) {
        const fit = bandFit(device.width, count);
        expect(fit.gaugeWidth, `${device.name}, ${String(count)} styles`).toBeGreaterThanOrEqual(
          GAUGE_MIN_WIDTH,
        );
      }
    }
  });

  it('ne fait jamais deborder les trois blocs', () => {
    for (const device of DEVICES) {
      for (const count of COUNTS) {
        const fit = bandFit(device.width, count);
        const total =
          2 * SAFE_SIDE + 2 * BAND_GAP + fit.styleWidth + fit.gaugeWidth + fit.tierWidth;
        expect(total, `${device.name}, ${String(count)} styles`).toBeLessThanOrEqual(device.width);
      }
    }
  });

  /**
   * Le bloc de styles ne doit jamais depasser celui du palier : c'est lui qui
   * fixe la largeur maximale d'une grappe, et il ne bougera pas (cinq paliers,
   * cinq amplificateurs, decides par les regles).
   */
  it('ne laisse pas le bloc de styles depasser celui du palier', () => {
    for (const count of COUNTS) {
      expect(bandFit(844, count).styleWidth).toBeLessThanOrEqual(
        clusterWidth(TIER_COLUMNS, PICK_TIGHT),
      );
    }
  });

  it('couvre le catalogue reel', () => {
    expect(BALANCE.styles.length).toBeGreaterThan(0);
    const fit = bandFit(667, BALANCE.styles.length);
    expect(fit.gaugeWidth).toBeGreaterThanOrEqual(GAUGE_MIN_WIDTH);
    expect(fit.styleHeight).toBeLessThanOrEqual(fit.tierHeight);
  });
});

/**
 * Les noms tiennent dans les boutons.
 *
 * Une boite fixe et un vocabulaire qui vit dans `@aura/content` : rien
 * n'empeche d'y ecrire « Constellation » un mardi, et personne ne le verrait
 * avant de lancer une manche. Ce test regarde les noms reellement livres.
 */
describe('noms affiches', () => {
  const displayed: readonly (readonly [string, string])[] = [
    ...TIERS.map((tier) => [`palier ${String(tier)}`, tierName(tier).fr] as const),
    ...AMPLIFIER_LEVELS.map(
      (level) => [`amplificateur ${String(level)}`, amplifierName(level).fr] as const,
    ),
    ...BALANCE.styles.map((style) => [`style ${style}`, styleName(style).fr] as const),
  ];

  it('tiennent dans la largeur du bouton', () => {
    for (const [where, name] of displayed) {
      expect(name.length, `${where} : « ${name} »`).toBeLessThanOrEqual(NAME_MAX);
      expect(name.length, `${where} : « ${name} »`).toBeGreaterThan(0);
    }
  });

  it('passent en corps resserre quand ils sont longs, et seulement alors', () => {
    expect(pickNameClass('Orage')).toBe('pick__name');
    expect(pickNameClass('Étincelles')).toBe('pick__name pick__name--long');
    expect(pickNameClass('a'.repeat(NAME_LONG))).toBe('pick__name');
    expect(pickNameClass('a'.repeat(NAME_LONG + 1))).toContain('--long');
  });

  it('gardent une marge entre « resserre » et « tronque »', () => {
    expect(NAME_LONG).toBeLessThan(NAME_MAX);
  });
});

describe('cibles tactiles', () => {
  /** ADR 0008 : 46 px, sans derogation — la jauge accepte tout l ecran, pas eux. */
  it('garde la cible minimale de l ADR', () => {
    expect(TOUCH).toBeGreaterThanOrEqual(46);
  });

  it('garde les deux tailles de bouton au-dessus de la cible', () => {
    for (const [name, pick] of [
      ['style', PICK_STYLE],
      ['palier', PICK_TIGHT],
    ] as const) {
      expect(pick.width, `${name} : largeur`).toBeGreaterThanOrEqual(TOUCH);
      expect(pick.height, `${name} : hauteur`).toBeGreaterThanOrEqual(TOUCH);
    }
  });

  it('compose la grappe a partir du bouton, jamais l inverse', () => {
    expect(clusterWidth(1, PICK_TIGHT)).toBeGreaterThan(PICK_TIGHT.width);
    expect(clusterHeight(1, PICK_TIGHT)).toBeGreaterThan(PICK_TIGHT.height);
    // Une colonne de plus coute exactement un bouton et son ecart.
    expect(clusterWidth(4, PICK_TIGHT) - clusterWidth(3, PICK_TIGHT)).toBe(PICK_TIGHT.width + GAP);
  });
});

/**
 * Parite avec la feuille de style.
 *
 * Ces nombres vivent aux deux endroits — le CSS ne peut pas importer un module
 * TypeScript. Une valeur changee d'un seul cote donnerait des tests qui
 * valident une mise en page que personne ne voit.
 */
describe('styles.css', () => {
  const css = readFileSync(fileURLToPath(new URL('../styles.css', import.meta.url)), 'utf8');

  it('declare les memes metriques de bande', () => {
    expect(css).toContain(`--touch: ${String(TOUCH)}px;`);
    expect(css).toContain(`--band-gap: ${String(BAND_GAP)}px;`);
    expect(css).toContain(`--gauge-track: ${String(GAUGE_TRACK)}px;`);
    expect(css).toContain(`--gauge-legend: ${String(GAUGE_LEGEND)}px;`);
    expect(css).toContain(`--gauge-h: ${String(GAUGE_HEIGHT)}px;`);
    expect(css).toContain(`--pick-w: ${String(PICK_STYLE.width)}px;`);
    expect(css).toContain(`--pick-h: ${String(PICK_STYLE.height)}px;`);
    expect(css).toContain(`--pick-tight-w: ${String(PICK_TIGHT.width)}px;`);
    expect(css).toContain(`--pick-tight-h: ${String(PICK_TIGHT.height)}px;`);
    expect(css).toContain(`--bet-h: ${String(BET_HEADER)}px;`);
  });

  /**
   * La fente garde la place de la jauge tant qu'elle n'est pas armee. Sans
   * elle, l'arrivee de la jauge pousserait les deux grappes — donc dix boutons
   * — a l'instant precis ou le pouce vient d'en toucher un.
   */
  it('declare la hauteur de l Ultime', () => {
    expect(css).toContain(`--ultimate-h: ${String(ULTIMATE_HEIGHT)}px;`);
  });

  /*
    L'Ultime etait en `position: absolute`, au-dessus d'une bande dont le
    commentaire promet que « rien ne peut se chevaucher, faute de position
    absolue ». A 667x320 il recouvrait la grappe palier de 35x47 pixels : son
    libelle passait sous le panneau, et deux cibles tactiles se superposaient.

    Une seule chose empeche ca pour de bon, et ce n'est pas un decalage bien
    choisi : c'est d'etre dans le flux, ou la mise en page interdit le
    chevauchement au lieu de l'eviter.
  */
  it('pose l Ultime dans le flux, jamais au-dessus de la bande', () => {
    const rule = css.slice(css.indexOf('.ultimate {'));
    expect(rule.slice(0, rule.indexOf('}'))).not.toContain('position: absolute');
  });

  it('reserve la place de la jauge avant qu elle arrive', () => {
    const slot = css.slice(css.indexOf('.gauge-slot {'), css.indexOf('.gauge-slot--empty'));
    expect(slot).toContain('height: var(--gauge-h)');

    // La LARGEUR est absorbee par la colonne du milieu, pas par la fente : la
    // fente ne retient que la hauteur, qui est ce qui empeche les grappes de
    // bouger quand la jauge arrive.
    const middle = css.slice(css.indexOf('.band__middle {'));
    expect(middle.slice(0, middle.indexOf('}'))).toContain('flex: 1 1 0');
  });

  it('deplie la jauge au lieu de l afficher', () => {
    expect(css).toContain('animation: gauge-in var(--d-panel)');
    expect(css).toContain('@keyframes gauge-in');
    // La regle globale ramene toute duree a 0,01 ms en mouvement reduit.
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('pose la jauge dans la bande, et non plus en absolu au centre', () => {
    const gauge = css.slice(css.indexOf('.gauge {'), css.indexOf('.gauge__track'));
    // Elle remplit sa fente ; c est la fente qui tient la place et la hauteur.
    expect(gauge).toContain('width: 100%');
    expect(gauge).toContain('height: 100%');
    expect(gauge).not.toContain('position: absolute');
    expect(gauge).not.toContain('bottom:');
  });

  /**
   * La jauge se tape. Une bande opaque aux evenements avalerait l appui pose
   * entre les deux grappes, et le joueur croirait avoir verrouille.
   */
  it('laisse la bande transparente a l appui, sauf les grappes', () => {
    const controls = css.slice(css.indexOf('.controls {'), css.indexOf('.cluster {'));
    expect(controls).toContain('pointer-events: none');
    const cluster = css.slice(css.indexOf('.cluster {'), css.indexOf('.cluster__label'));
    expect(cluster).toContain('pointer-events: auto');
  });

  it('laisse les grappes a leur taille naturelle', () => {
    const cluster = css.slice(css.indexOf('.cluster {'), css.indexOf('.cluster__label'));
    expect(cluster).toContain('flex: none');
    // Une largeur plafonnee en pourcentage ecrase la quatrieme colonne.
    expect(cluster).not.toContain('max-width');
  });
});

/**
 * La clairiere du personnage, sur l'accueil.
 *
 * L'accueil n'est pas un ecran de match : le sujet n'y est pas deux
 * combattants dans le dernier cinquieme de la hauteur, c'est UN personnage
 * debout au milieu. Les grappes de commandes se posent donc a gauche et a
 * droite de lui, pas sous lui — et la question devient horizontale.
 *
 * Mesure sur le client en marche a 844x390 : la silhouette occupe les
 * colonnes 390 a 465, soit 46,2 % a 55,1 % de la largeur. Le rail s'arretait
 * a 463 et lui coupait les jambes.
 */
/*
  L'Ultime vit au-dessus de la jauge, dans la colonne du milieu.

  Il ne coute pas d'energie — il se paie en jauge — donc il ne rentre pas dans
  la grappe palier/amplificateur, qui affiche un budget. Mais il se decide au
  meme instant, et la seule colonne qui puisse l'accueillir sans bousculer une
  cible tactile est celle qui porte deja la jauge.
*/
describe('hauteur de la bande', () => {
  it('donne a l Ultime au moins une cible tactile', () => {
    expect(ULTIMATE_HEIGHT).toBeGreaterThanOrEqual(TOUCH);
  });

  /*
    `bandHeight` ne comptait QUE les deux grappes. L'Ultime flottait au-dessus,
    absent du calcul : l'invariant « la bande tient sous les combattants » etait
    donc verifie sur une bande qui n'etait pas celle qu'on affichait.
  */
  it('compte la colonne du milieu, Ultime compris', () => {
    expect(bandHeight(STYLE_CAPACITY)).toBeGreaterThanOrEqual(
      ULTIMATE_HEIGHT + BAND_GAP + GAUGE_HEIGHT,
    );
  });
});

describe('homeClusters', () => {
  it('arrete la grappe gauche avant le personnage', () => {
    // 844 : la silhouette commence a 390. Bord droit de la grappe = marge de
    // securite plus sa largeur, et il doit rester en deca.
    expect(SAFE_SIDE + homeClusters(844).left).toBeLessThan(844 * SUBJECT_FROM);
  });

  it('commence la grappe droite apres le personnage', () => {
    expect(844 - SAFE_SIDE - homeClusters(844).right).toBeGreaterThan(844 * SUBJECT_TO);
  });

  /*
    Le rail porte cinq destinations. Reduites a leurs pictogrammes elles
    demandent cinq cibles tactiles et leurs ecarts : en dessous, une grappe
    « propre » cacherait un bouton qu'on ne peut plus toucher.
  */
  it('garde de quoi poser les cinq menus, meme serre', () => {
    for (const width of [568, 640, 667, 740, 844, 926]) {
      expect(homeClusters(width).left, `${String(width)} px`).toBeGreaterThanOrEqual(
        5 * TOUCH + 4 * GAP,
      );
    }
  });

  /*
    Le dernier recours : sur un ecran trop etroit pour les deux grappes ET la
    clairiere, on rogne la clairiere — un bouton hors de portee est pire qu'un
    personnage a moitie cache.
  */
  it('ne laisse jamais les deux grappes se chevaucher', () => {
    for (const width of [400, 480, 520, 568, 667, 844, 1280]) {
      const { left, right } = homeClusters(width);
      expect(left + right + 2 * SAFE_SIDE, `${String(width)} px`).toBeLessThanOrEqual(width);
    }
  });

  it('rend des largeurs entieres et positives', () => {
    for (const width of [0, -20, Number.NaN, 333, 701, 844]) {
      const { left, right } = homeClusters(width);
      expect(Number.isInteger(left)).toBe(true);
      expect(Number.isInteger(right)).toBe(true);
      expect(left).toBeGreaterThan(0);
      expect(right).toBeGreaterThan(0);
    }
  });
});
