/**
 * Metriques de la bande de commandes, en pixels logiques.
 *
 * Deux contraintes gouvernent cette bande, et aucune des deux ne se lit dans
 * la feuille de style :
 *
 * 1. **Les combattants sont le sujet.** Le cadrage large les pose entre 28,8 %
 *    et 78,7 % de la hauteur affichee — des proportions qui ne dependent que
 *    du champ vertical de la camera, donc identiques sur tous les rapports
 *    d'ecran. Le dernier cinquieme est le seul endroit ou poser un panneau
 *    sans couvrir personne. `arena/hud.test.ts` le verifie en projetant les
 *    vrais rigs a travers la vraie camera.
 * 2. **Le catalogue de styles peut grandir.** Trois aujourd'hui, davantage
 *    demain : aucune largeur ne doit supposer trois. Le bloc gagne des
 *    rangees, pas de la largeur, et c'est ce qui lui permet de ne jamais
 *    mordre sur la jauge ni sur l'amplificateur.
 *
 * Les valeurs sont dupliquees en variables CSS dans `styles.css` ; le test de
 * parite de `layout.test.ts` interdit qu'elles divergent.
 */

/** Cible tactile minimale (ADR 0008). */
export const TOUCH = 46;

/** Espacement entre deux boutons d'une rangee, et entre deux rangees. */
export const GAP = 5;

/** Rembourrage d'une grappe, et le trait qui la borde. */
export const CLUSTER_PADDING = 6;
export const CLUSTER_BORDER = 1;

/** Hauteur du libelle d'une grappe, interligne compris. */
export const CLUSTER_LABEL = 11;

/**
 * Hauteur de l'en-tete de mise, qui remplace le libelle a droite.
 *
 * Il porte la puissance misee, les deux noms choisis et les huit points
 * d'energie. Treize pixels de plus que le libelle qu'il remplace, pris sur une
 * bande qui les a — la marge sous les combattants reste verifiee par
 * `arena/hud.test.ts`.
 */
export const BET_HEADER = 24;

/** Ecart entre les trois blocs de la bande. */
export const BAND_GAP = 10;

/** Inset lateral minimal garanti par `--safe-left` / `--safe-right`. */
export const SAFE_SIDE = 12;

/**
 * Pire inset bas a prevoir.
 *
 * `--safe-bottom` vaut `max(10px, env(safe-area-inset-bottom))` : 10 px sur un
 * ecran sans encoche, une vingtaine sous la barre d'accueil d'un iPhone en
 * paysage. C'est ce second cas qui contraint la bande.
 */
export const SAFE_BOTTOM_MAX = 21;

/** Hauteur de la piste de la jauge. */
export const GAUGE_TRACK = 20;

/** Rembourrage, bordure et legende du panneau de jauge. */
export const GAUGE_PADDING = 5;
export const GAUGE_BORDER = 1;
export const GAUGE_LEGEND = 10;
export const GAUGE_LEGEND_GAP = 3;

/** Hauteur totale du panneau de jauge : la somme, pas un nombre recopie. */
export const GAUGE_HEIGHT =
  2 * GAUGE_BORDER + 2 * GAUGE_PADDING + GAUGE_TRACK + GAUGE_LEGEND_GAP + GAUGE_LEGEND;

/**
 * Hauteur du bouton d'Ultime, bordures comprises.
 *
 * Il vit au-dessus de la jauge, dans la colonne du milieu. Il etait avant en
 * `position: absolute` au-dessus de la bande — et a 667x320 il recouvrait la
 * grappe palier de 35x47 pixels, deux cibles tactiles l'une sur l'autre. Ce
 * qui empeche ca n'est pas un decalage mieux choisi, c'est d'etre dans le
 * flux : la mise en page interdit alors le chevauchement au lieu de l'eviter.
 */
export const ULTIMATE_HEIGHT = TOUCH + 2 * CLUSTER_BORDER;

/** Largeur au-dela de laquelle la jauge ne s'etale plus : la course est temporelle. */
export const GAUGE_MAX_WIDTH = 420;

/**
 * Largeur minimale exploitable de la jauge.
 *
 * En dessous, la zone « parfait » — 8 % de la course — descend sous une
 * dizaine de pixels et cesse d'etre un repere visuel.
 */
export const GAUGE_MIN_WIDTH = 130;

export interface PickSize {
  readonly width: number;
  readonly height: number;
}

export const PICK_TIGHT: PickSize = Object.freeze({ width: 52, height: TOUCH });

/**
 * Longueur des noms affiches dans un bouton.
 *
 * Une boite fixe impose une limite au texte, et mieux vaut l'ecrire que la
 * decouvrir : 52 px moins le rembourrage laissent 48 px, soit une dizaine de
 * lettres a 9,5 px et douze au corps resserre. « Étincelles » en fait dix et
 * passe donc en resserre ; un nom de treize lettres serait tronque, et le test
 * de `layout.test.ts` le dit avant que le joueur ne le voie.
 */
export const NAME_LONG = 8;
export const NAME_MAX = 12;

/** Classe du nom d'un bouton : resserre au-dela de `NAME_LONG`. */
export function pickNameClass(name: string): string {
  return name.length > NAME_LONG ? 'pick__name pick__name--long' : 'pick__name';
}

/** Largeur d'une grappe de `columns` colonnes. */
export function clusterWidth(columns: number, pick: PickSize): number {
  return columns * pick.width + (columns - 1) * GAP + 2 * (CLUSTER_PADDING + CLUSTER_BORDER);
}

/** Hauteur d'une grappe de `rows` rangees, en-tete compris. */
export function clusterHeight(rows: number, pick: PickSize, head = CLUSTER_LABEL): number {
  return head + rows * pick.height + (rows - 1) * GAP + 2 * (CLUSTER_PADDING + CLUSTER_BORDER);
}

/**
 * Repartit des elements en rangees d'au plus `columns`, equilibrees.
 *
 * Equilibrees et non remplies : quatre styles donnent 2 + 2, pas 3 + 1. Une
 * rangee orpheline se lit comme un oubli de mise en page.
 */
export function chunkEvenly<T>(items: readonly T[], columns: number): readonly (readonly T[])[] {
  if (items.length === 0 || columns <= 0) return [];
  const rows = Math.ceil(items.length / columns);
  const perRow = Math.ceil(items.length / rows);
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += perRow) {
    out.push([...items.slice(index, index + perRow)]);
  }
  return out;
}

/**
 * La clairiere du personnage, sur l'accueil.
 *
 * L'accueil obeit a une contrainte differente de la bande de match. Le sujet
 * n'y est pas deux combattants poses dans le dernier cinquieme de la hauteur :
 * c'est UN personnage debout au milieu de l'ecran, qui porte ce qu'on lui
 * essaie. Les commandes se rangent donc a sa GAUCHE et a sa DROITE, et la
 * question devient horizontale.
 *
 * Mesure sur le client en marche a 844x390, en masquant l'interface et en
 * comptant les colonnes sombres du canvas : la silhouette occupe 390 a 465,
 * soit 46,2 % a 55,1 % de la largeur. Le rail, lui, s'etendait jusqu'a 463 —
 * il lui coupait les jambes, et personne ne l'avait ecrit nulle part.
 *
 * Des PARTS, pas des pixels : la camera cadre le personnage a la meme place
 * quelle que soit la largeur, donc ce sont bien des proportions qui se
 * conservent d'un appareil a l'autre.
 */
export const SUBJECT_FROM = 0.45;
export const SUBJECT_TO = 0.56;

/** Le souffle laisse entre une grappe et la silhouette. */
export const SUBJECT_CLEARANCE = 10;

/** Largeur minimale de la grappe d'action : sous ca, « Duel » ne pese plus. */
export const LAUNCH_MIN = 240;

export interface HomeClusters {
  /** Largeur de la grappe gauche : galerie de memes et rail de menus. */
  readonly left: number;
  /** Largeur de la grappe droite : mode, duel, et les deux detours. */
  readonly right: number;
}

export function homeClusters(viewportWidth: number): HomeClusters {
  const width = viewportWidth > 0 ? viewportWidth : 0;

  // Le rail se reduit a ses pictogrammes quand il faut, mais jamais en deca :
  // cinq cibles tactiles et leurs ecarts sont un plancher, pas une preference.
  const railFloor = 5 * TOUCH + 4 * GAP;

  const left = Math.max(
    railFloor,
    Math.floor(width * SUBJECT_FROM) - SAFE_SIDE - SUBJECT_CLEARANCE,
  );
  const right = Math.max(
    LAUNCH_MIN,
    width - Math.ceil(width * SUBJECT_TO) - SAFE_SIDE - SUBJECT_CLEARANCE,
  );

  const available = width - 2 * SAFE_SIDE;
  if (left + right <= available) return { left, right };

  /*
    Dernier recours : l'ecran est trop etroit pour les deux grappes ET la
    clairiere. On rogne la clairiere, pas les boutons — un bouton hors de
    portee est pire qu'un personnage a moitie cache, parce qu'on peut
    contourner le second et pas le premier.

    Le partage suit les largeurs demandees plutot que de couper au milieu : le
    rail et le bloc de duel n'ont pas les memes besoins, et les ecraser a
    parts egales rendrait le plus exigeant des deux inutilisable en premier.
  */
  const share = available / (left + right);
  return {
    left: Math.max(1, Math.floor(left * share)),
    right: Math.max(1, Math.floor(right * share)),
  };
}

/*
  La bande de la phase de choix (chantier n°2) : trois blocs cote a cote.

  - a gauche, la mise, l'Ultime et la jauge, sur une largeur fixe : la jauge
    arrive sans deplacer une seule carte ;
  - au centre, la main — cinq onglets de famille, puis cinq cartes en
    eventail ;
  - a droite, l'amplificateur en grille de trois colonnes sur deux rangees :
    en une seule colonne de cinq, il montait jusqu'au torse des combattants
    sur les ecrans de 375 px (mesure dans `arena/hud.test.ts`).
*/

/** Largeur de la colonne de gauche (mise, Ultime, jauge). */
export const BAND_LEFT_WIDTH = 200;
/** Largeur d'un bouton d'amplificateur dans sa grille de 3 × 2. */
export const AMP_WIDTH = 48;
/** Colonnes de la grille d'amplificateur. */
export const AMP_COLUMNS = 3;
/** Carte de pose, au repos. */
export const CARD_WIDTH = 70;
export const CARD_HEIGHT = 92;
/** Hauteur dont se souleve la carte choisie : la main la reserve. */
export const CARD_LIFT = 12;
/**
 * Marge sous l'eventail : les cartes du bord, inclinees et plus basses, y
 * descendent. Sans elle, le bas de leur texte passait sous le bord de l'ecran.
 */
export const CARD_ARC = 8;
/** Pas maximal entre deux cartes : au-dela, l'eventail se disloque. */
export const CARD_STEP_MAX = 62;
/** Les cinq onglets de famille, cibles tactiles pleines. */
export const HAND_TABS_WIDTH = 5 * TOUCH + 4 * GAP;

export interface HandBand {
  readonly leftWidth: number;
  readonly handWidth: number;
  readonly rightWidth: number;
  /** Ecart entre deux cartes : la part visible, donc touchable, de chacune. */
  readonly cardStep: number;
}

export function handBand(viewportWidth: number): HandBand {
  const rightWidth = clusterWidth(AMP_COLUMNS, { width: AMP_WIDTH, height: TOUCH });
  const handWidth = viewportWidth - 2 * SAFE_SIDE - 2 * BAND_GAP - BAND_LEFT_WIDTH - rightWidth;
  return {
    leftWidth: BAND_LEFT_WIDTH,
    handWidth,
    rightWidth,
    cardStep: Math.floor(Math.min(CARD_STEP_MAX, (handWidth - CARD_WIDTH) / 4)),
  };
}

/** Hauteur de la bande : le plus haut des trois blocs. */
export function bandHeight(): number {
  const padding = 2 * (CLUSTER_PADDING + CLUSTER_BORDER);
  const left = BET_HEADER + GAP + ULTIMATE_HEIGHT + GAP + GAUGE_HEIGHT + padding;
  const hand = TOUCH + GAP + CARD_HEIGHT + CARD_LIFT + CARD_ARC;
  const right = clusterHeight(2, { width: AMP_WIDTH, height: TOUCH }, 0);
  return Math.max(left, hand, right);
}
