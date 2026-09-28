/**
 * Niveaux de qualite graphique.
 *
 * Trois paliers, et un gouverneur qui choisit entre eux d apres ce que la
 * machine rend vraiment. Rien ici ne connait Three.js ni le DOM : ce module
 * decide, `arena/scene.ts` applique. C est la meme separation que
 * `crowdLayout.ts` / `crowd.ts`, et elle a la meme raison d etre — un choix de
 * qualite se verifie image par image dans un test, sans carte graphique.
 *
 * **Cette table est la source.** `MAX_PIXEL_RATIO`, `CROWD_SIZE`,
 * `ADDITIVE_CAPACITY`, `DARK_CAPACITY` et `AURA_BUDGET` en decoulent, jamais l inverse : une
 * valeur reexprimee des deux cotes ne se voit ni au compilateur, ni aux tests,
 * ni en relecture, et c est le defaut le plus cher que ce depot ait produit.
 */

export type QualityTier = 'rich' | 'balanced' | 'smooth';

/** Ce que le joueur peut demander : `auto`, ou un palier impose. */
export type QualitySetting = 'auto' | QualityTier;

export interface QualityProfile {
  /** Plafond du rapport de pixels. Le premier levier du cout de remplissage. */
  readonly pixelRatioCap: number;
  /** Places de la foule reellement dessinees, premier cercle en tete. */
  readonly crowdSeats: number;
  readonly additiveParticles: number;
  readonly darkParticles: number;
  /**
   * Particules vivantes par aura de combattant.
   *
   * Compte a part des capacites de tampon : c est un plafond de **simulation**,
   * pas d ecriture. Laisser le tampon tronquer suffirait a l affichage, mais on
   * paierait la naissance et le deplacement de particules jetees ensuite.
   */
  readonly auraParticles: number;
  /** Les mains articulees des combattants. */
  readonly hands: boolean;
}

/** Du plus cher au moins cher. L ordre porte la descente : il est significatif. */
export const QUALITY_TIERS = [
  'rich',
  'balanced',
  'smooth',
] as const satisfies readonly QualityTier[];

/**
 * Les trois paliers.
 *
 * Le rapport de pixels baisse en premier et le plus fort : de 1,75 a 1,0, on
 * divise par trois le nombre de pixels a remplir, sans retirer quoi que ce
 * soit de l arene. La foule vient ensuite, par le fond — le brouillard
 * commence a 6,5 m, les derniers rangs sont deja a moitie effaces. Les mains
 * ne partent qu au dernier palier : ce sont elles qui portent la moitie des
 * poses du contenu.
 */
export const QUALITY_PROFILES: Readonly<Record<QualityTier, QualityProfile>> = Object.freeze({
  rich: Object.freeze({
    pixelRatioCap: 1.75,
    crowdSeats: 210,
    additiveParticles: 2400,
    darkParticles: 600,
    auraParticles: 260,
    hands: true,
  }),
  balanced: Object.freeze({
    pixelRatioCap: 1.25,
    crowdSeats: 120,
    additiveParticles: 1400,
    darkParticles: 350,
    auraParticles: 150,
    hands: true,
  }),
  smooth: Object.freeze({
    pixelRatioCap: 1,
    crowdSeats: 60,
    additiveParticles: 700,
    darkParticles: 180,
    auraParticles: 70,
    hands: false,
  }),
});

/**
 * Le plancher de `docs/09` : 30 i/s, donc 33 ms.
 *
 * Ce n est pas la moyenne qu on surveille mais le **nombre d images qui
 * depassent**. Une moyenne a 42 i/s peut cacher une mediane a 58 avec des
 * a-coups reguliers ; c est l a-coup qui se voit, pas la moyenne.
 */
export const SLOW_FRAME_MS = 33;

/** Taille de la fenetre de mesure : environ quatre secondes a 60 i/s. */
export const SAMPLE_FRAMES = 240;

/** Part d images lentes au-dela de laquelle on descend d un palier. */
export const SLOW_FRAME_SHARE = 0.1;

/**
 * Au-dela, ce n est plus une image lente.
 *
 * L application peut etre suspendue en plein match — le joueur repond a un
 * message, verrouille son telephone. Au reveil, l ecart entre deux images se
 * compte en secondes et ne dit rien de la carte graphique. Le compter ferait
 * chuter la qualite de quelqu un qui n a rien fait de mal.
 */
export const MAX_CREDIBLE_FRAME_MS = 250;

/**
 * Le rapport de pixels a utiliser, plafond du palier applique.
 *
 * Deux appelants en dependent et doivent recevoir **la meme valeur** : le
 * rendu, qui dimensionne son tampon, et la scene, qui convertit la taille
 * d une particule exprimee en metres vers des pixels de ce tampon. Leur donner
 * deux valeurs differentes — le rapport brut a l une, le plafond a l autre —
 * grossit toutes les particules du rapport entre les deux.
 */
export function effectivePixelRatio(devicePixelRatio: number, cap: number): number {
  // Hors navigateur, ou sur un `window` avare, le rapport peut etre absent,
  // nul ou negatif : l unite est la seule valeur sure.
  const ratio = devicePixelRatio > 0 ? devicePixelRatio : 1;
  return Math.min(cap, ratio);
}

export interface QualityGovernor {
  /** Le palier reellement dessine. */
  readonly tier: QualityTier;
  readonly profile: QualityProfile;
  /** Le palier qu un `commit()` appliquerait. Egal a `tier` si rien n attend. */
  readonly pending: QualityTier;
  readonly setting: QualitySetting;
  /** Une image de plus dans la fenetre. Ne change jamais `tier`. */
  record(deltaMs: number): void;
  /**
   * Frontiere de manche : applique une descente en attente.
   *
   * Renvoie vrai si le palier a change, pour que l appelant sache qu il doit
   * reconfigurer la scene.
   */
  commit(): boolean;
  /** Reglage manuel. Prend effet tout de suite : c est le joueur qui demande. */
  select(setting: QualitySetting): void;
}

export interface QualityGovernorOptions {
  /** Reglage memorise. Par defaut : automatique. */
  readonly setting?: QualitySetting;
  /**
   * Palier de depart en automatique.
   *
   * On y remet le palier trouve a la session precedente : sans cela, un
   * appareil modeste repaye une premiere manche hachee a chaque lancement.
   */
  readonly start?: QualityTier;
}

function lower(tier: QualityTier): QualityTier {
  const next = QUALITY_TIERS[QUALITY_TIERS.indexOf(tier) + 1];
  return next ?? tier;
}

export function createQualityGovernor(options: QualityGovernorOptions = {}): QualityGovernor {
  let setting: QualitySetting = options.setting ?? 'auto';
  let tier: QualityTier = setting === 'auto' ? (options.start ?? 'rich') : setting;
  let pending: QualityTier = tier;

  let frames = 0;
  let slow = 0;

  const forget = (): void => {
    frames = 0;
    slow = 0;
  };

  return {
    get tier(): QualityTier {
      return tier;
    },

    get profile(): QualityProfile {
      return QUALITY_PROFILES[tier];
    },

    get pending(): QualityTier {
      return pending;
    },

    get setting(): QualitySetting {
      return setting;
    },

    record(deltaMs): void {
      // Le joueur a la main : on ne mesure meme pas. Une fenetre accumulee
      // pendant un reglage manuel serait un verdict rendu sur un palier que
      // personne n a plus.
      if (setting !== 'auto') return;

      if (!(deltaMs > 0) || deltaMs > MAX_CREDIBLE_FRAME_MS) {
        forget();
        return;
      }

      frames++;
      if (deltaMs > SLOW_FRAME_MS) slow++;
      if (frames < SAMPLE_FRAMES) return;

      if (slow / frames > SLOW_FRAME_SHARE) pending = lower(pending);
      forget();
    },

    commit(): boolean {
      if (pending === tier) return false;
      tier = pending;
      forget();
      return true;
    },

    select(next): void {
      setting = next;
      if (next !== 'auto') tier = next;
      pending = tier;
      forget();
    },
  };
}
