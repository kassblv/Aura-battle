import { AMPLIFIER_LEVELS, amplifierName, styleName, tierName, TIERS } from '@aura/content';
import { BALANCE } from '@aura/rules';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  AMP_WIDTH,
  BAND_GAP,
  bandHeight,
  BAND_LEFT_WIDTH,
  CARD_ARC,
  CARD_HEIGHT,
  CARD_LIFT,
  CARD_STEP_MAX,
  CARD_WIDTH,
  GAP,
  chunkEvenly,
  clusterHeight,
  clusterWidth,
  GAUGE_HEIGHT,
  GAUGE_LEGEND,
  GAUGE_MIN_WIDTH,
  BET_HEADER,
  GAUGE_TRACK,
  handBand,
  HAND_TABS_WIDTH,
  homeClusters,
  NAME_LONG,
  NAME_MAX,
  PICK_TIGHT,
  pickNameClass,
  SAFE_SIDE,
  SUBJECT_FROM,
  ULTIMATE_HEIGHT,
  SUBJECT_TO,
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
    for (let count = 1; count <= 6; count += 1) {
      const items = Array.from({ length: count }, (_, index) => index);
      const rows = chunkEvenly(items, 3);
      expect(rows.flat(), `${String(count)} elements`).toEqual(items);
      for (const row of rows) {
        expect(row.length, `${String(count)} elements`).toBeLessThanOrEqual(3);
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

/**
 * Le test que la mise en page doit a l'utilisateur.
 *
 * La bande tenait par un accord tacite — « trois styles font 162 px, donc la
 * jauge de 420 px centree passe ». Elle ne passait pas : la jauge chevauchait
 * les personnages, et le quatrieme style aurait chevauche la jauge. Ici on
 * mesure au lieu de supposer.
 */
describe('la main tient dans l ecran (chantier n°2)', () => {
  it('ne fait jamais deborder les trois blocs', () => {
    for (const device of DEVICES) {
      const fit = handBand(device.width);
      const total = 2 * SAFE_SIDE + 2 * BAND_GAP + fit.leftWidth + fit.handWidth + fit.rightWidth;
      expect(total, device.name).toBeLessThanOrEqual(device.width);
    }
  });

  /*
    Les cartes se chevauchent en eventail : ce qu'on touche d'une carte, c'est
    sa part visible, soit un pas. Il reste une cible de l'ADR 0008 partout.
  */
  it('laisse a chaque carte une part visible d au moins une cible tactile', () => {
    for (const device of DEVICES) {
      const fit = handBand(device.width);
      expect(fit.cardStep, device.name).toBeGreaterThanOrEqual(TOUCH);
      expect(fit.cardStep, device.name).toBeLessThanOrEqual(CARD_STEP_MAX);
      expect(CARD_WIDTH + 4 * fit.cardStep, device.name).toBeLessThanOrEqual(fit.handWidth);
    }
  });

  it('pose les cinq onglets de famille au-dessus de la main', () => {
    for (const device of DEVICES) {
      expect(HAND_TABS_WIDTH, device.name).toBeLessThanOrEqual(handBand(device.width).handWidth);
    }
  });

  it('laisse a la jauge une largeur exploitable dans sa colonne', () => {
    expect(BAND_LEFT_WIDTH - 2 * 7).toBeGreaterThanOrEqual(GAUGE_MIN_WIDTH);
  });

  it('tient en hauteur sous le bandeau du haut, sur le plus petit ecran vise', () => {
    for (const device of DEVICES) {
      expect(bandHeight() + device.safeBottom + 30, device.name).toBeLessThanOrEqual(device.height);
    }
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

  it('garde les boutons et les cartes au-dessus de la cible', () => {
    for (const [name, pick] of [
      ['amplificateur', PICK_TIGHT],
      ['carte', { width: CARD_WIDTH, height: CARD_HEIGHT }],
      ['amplificateur en colonne', { width: AMP_WIDTH, height: TOUCH }],
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
    expect(css).toContain(`--hand-card-w: ${String(CARD_WIDTH)}px;`);
    expect(css).toContain(`--hand-card-h: ${String(CARD_HEIGHT)}px;`);
    expect(css).toContain(`--hand-lift: ${String(CARD_LIFT)}px;`);
    expect(css).toContain(`--hand-arc: ${String(CARD_ARC)}px;`);
    expect(css).toContain(`--amp-w: ${String(AMP_WIDTH)}px;`);
    expect(css).toContain(`--band-left-w: ${String(BAND_LEFT_WIDTH)}px;`);
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

    // La LARGEUR est celle de la colonne de gauche, fixe : la jauge arrive
    // sans deplacer une seule carte de la main.
    const left = css.slice(css.indexOf('.band__left {'));
    expect(left.slice(0, left.indexOf('}'))).toContain('width: var(--band-left-w)');
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
  it('compte les trois blocs : jauge et Ultime, main, amplificateur', () => {
    expect(bandHeight()).toBeGreaterThanOrEqual(ULTIMATE_HEIGHT + GAP + GAUGE_HEIGHT);
    expect(bandHeight()).toBeGreaterThanOrEqual(TOUCH + GAP + CARD_HEIGHT + CARD_LIFT + CARD_ARC);
    expect(bandHeight()).toBeGreaterThanOrEqual(clusterHeight(2, PICK_TIGHT, 0));
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
