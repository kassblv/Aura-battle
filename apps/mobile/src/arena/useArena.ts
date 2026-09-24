import { useEffect, useMemo, useRef, type RefObject } from 'react';
import type { Animation } from '@aura/content';
import { animationBounds, type AnimationBounds } from '../animation/bounds.js';
import { livePose } from '../animation/secondary.js';
import { createPoseSmoother } from '../animation/smooth.js';
import { ANIMATIONS } from '../content/animations.js';
import { gestureCues } from '../audio/gestures.js';
import type { AudioCue } from '../audio/cues.js';
import type { Presentation } from '../match/presentation.js';
import {
  createQualityGovernor,
  effectivePixelRatio,
  type QualityGovernor,
  type QualityTier,
} from '../platform/quality.js';
import { watchReducedMotion } from '../platform/reducedMotion.js';
import { focusFraming, previewFraming, wideFraming, type CameraFraming } from './camera.js';
import { auraIntensity } from './aura.js';
import { CHEST_HEIGHT, type ClashColors, type ClashEnds } from './clash.js';
import { createArenaDirector } from './director.js';
import { createOrbitControl } from './orbit.js';
import { createArenaRenderer } from './renderer.js';
import { storyOfRound, type RoundReport } from './round.js';
import { createArenaScene } from './scene.js';
import { createArenaTextures } from './textures.js';

/**
 * Fait vivre l arene dans React.
 *
 * Seul module du client qui touche a la fois React et la carte graphique : il
 * n est donc pas couvert par les tests, comme `renderer.ts`. Tout ce qui se
 * decide vit ailleurs — `presentation.ts` dit quoi montrer, `smooth.ts` comment
 * l animer — et se teste sans navigateur.
 *
 * La mise en scene arrive par une **reference mutable**, jamais par une
 * dependance d effet : reconstruire la scene a chaque image de match couterait
 * une seconde de chargement par phase.
 */

/**
 * Encombrement des animations, mesure une fois par identifiant.
 *
 * Trente-deux echantillons de pose par animation : le refaire a chaque image
 * pour choisir une distance de camera serait payer soixante fois par seconde
 * une mesure qui ne change jamais.
 */
const boundsCache = new Map<string, AnimationBounds>();

/**
 * L effet d aura quand le joueur n en a equipe aucun.
 *
 * La Lueur est le style offert. Chaque combattant porte desormais le sien,
 * lu dans son loadout — `AURA_STYLES` attendait un porteur depuis le portage
 * des particules, et tout le monde jouait ce repli code en dur.
 */
const DEFAULT_AURA_EFFECT = 'fx.glow';

function boundsOf(animation: Animation): AnimationBounds {
  let bounds = boundsCache.get(animation.id);
  if (bounds === undefined) {
    bounds = animationBounds(animation);
    boundsCache.set(animation.id, bounds);
  }
  return bounds;
}

export interface ArenaControls {
  /** Ce que l arene doit montrer, relu a chaque image. */
  readonly presentation: RefObject<Presentation | null>;
  /**
   * Vrai hors match : un seul personnage, cadrage de vitrine, orbite au doigt.
   *
   * Pendant un match la camera est une mise en scene, elle appartient au jeu :
   * le glissement n y fait rien.
   */
  readonly showcase: RefObject<boolean>;
  /**
   * La derniere manche tranchee, telle que le serveur l a annoncee.
   *
   * C est la seule chose que l arene apprend du match en dehors des poses : le
   * reste — qui se revele en premier, quand les auras se percutent, qui recule
   * — se deduit ici, dans `round.ts`. L appelant se contente d y poser
   * `view.lastRound` a chaque image ; l arene reconnait une manche NOUVELLE a
   * son numero et ne rejoue jamais la meme.
   */
  readonly round: RefObject<RoundReport | null>;
  /**
   * Largeur du panneau lateral ouvert, en pixels. Zero s il n y en a pas.
   *
   * Relue a chaque image, comme le reste : l arene ne doit pas etre
   * reconstruite parce qu un ecran s est ouvert.
   */
  readonly sidePanel: RefObject<number>;
  /**
   * Ramene le personnage de face dans la vitrine.
   *
   * Appele tout seul quand un duel commence ; expose pour qu un bouton
   * « recentrer » puisse le faire aussi.
   */
  resetOrbit(): void;
}

export function useArena(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  /**
   * Ou partent les accents des gestes.
   *
   * Les animations declarent leurs temps forts en donnee (`sound` dans le
   * fichier) ; c est cette boucle qui sait ou en est chaque combattant, donc
   * c est elle qui les fait sonner. Facultatif pour que l arene reste
   * constructible sans audio — un test, un rendu hors navigateur.
   */
  onCue?: (cue: AudioCue) => void,
  /**
   * Le gouverneur de qualite graphique.
   *
   * Fourni par l appelant, qui detient aussi le reglage manuel de l ecran
   * Reglages et sa memorisation : c est le meme objet des deux cotes, sinon
   * l ecran afficherait un palier et l arene en dessinerait un autre.
   *
   * Facultatif pour que l arene reste constructible sans — un test, un rendu
   * hors navigateur. Elle se donne alors le sien, en automatique.
   */
  quality?: QualityGovernor,
  /** Appele quand le palier applique change, pour que l ecran suive. */
  onQualityTier?: (tier: QualityTier) => void,
): ArenaControls {
  /**
   * Le puits d accents traverse par une reference, pas par la dependance de
   * l effet.
   *
   * L effet de l arene ne depend que du canvas — reconstruire la scene parce
   * qu une fonction a change d identite couterait une seconde de chargement.
   * La reference donne toujours la derniere sans rien reconstruire.
   */
  const cueRef = useRef(onCue);
  cueRef.current = onCue;
  const tierRef = useRef(onQualityTier);
  tierRef.current = onQualityTier;
  // Meme raison que l orbite : le palier trouve doit survivre aux rendus de
  // React, pas repartir du plus haut a chaque redessin de l accueil.
  const fallback = useRef<QualityGovernor | null>(null);
  fallback.current ??= createQualityGovernor();
  const governor = quality ?? fallback.current;
  const governorRef = useRef(governor);
  governorRef.current = governor;
  const presentation = useRef<Presentation | null>(null);
  const showcase = useRef(true);
  const round = useRef<RoundReport | null>(null);
  const sidePanel = useRef(0);
  // Cree une seule fois : l angle doit survivre aux rendus de React, pas
  // repartir de zero a chaque fois que l accueil se redessine.
  const orbit = useRef(createOrbitControl());

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;

    const renderer = createArenaRenderer(canvas);
    // Sans WebGL, le calque 2D reste seul a l ecran : c est degrade, pas casse.
    if (renderer === null) return;

    const textures = createArenaTextures();
    const arena = createArenaScene({ textures, rng: Math.random });
    const smoothers = { a: createPoseSmoother(), b: createPoseSmoother() };

    const motion = watchReducedMotion();
    const control = orbit.current;
    const director = createArenaDirector({ reducedMotion: motion.reduced });

    const resize = (): void => {
      const { clientWidth, clientHeight } = canvas;
      /*
        Le meme nombre aux deux.

        Le rendu dessine dans un tampon de `css x ratio` pixels physiques, et
        la scene convertit la taille d une particule en pixels **de ce
        tampon**. Deux valeurs differentes grossissent les particules du
        rapport entre elles.
      */
      const ratio = effectivePixelRatio(
        window.devicePixelRatio,
        governorRef.current.profile.pixelRatioCap,
      );
      arena.setSize(clientWidth, clientHeight, ratio);
      renderer.setSize(clientWidth, clientHeight, ratio);
      control.setViewport(clientWidth, clientHeight);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    arena.applyQuality(governorRef.current.profile);
    resize();

    /**
     * Applique une descente en attente, si la frontiere de manche en a une.
     *
     * Appele **entre** les manches, jamais pendant : changer le rapport de
     * pixels au milieu de la jauge deplacerait le sol sous les pieds du joueur
     * a l instant precis ou son timing est mesure.
     */
    const commitQuality = (): void => {
      const current = governorRef.current;
      if (!current.commit()) return;
      arena.applyQuality(current.profile);
      // Le plafond du rapport de pixels a change avec le palier.
      resize();
      tierRef.current?.(current.tier);
    };

    /**
     * Glissement sur l arene : le joueur retourne son personnage.
     *
     * L ecoute est posee sur le **canvas**, pas sur la fenetre : les boutons de
     * l accueil sont au-dessus dans le document, un appui sur l un d eux ne
     * descend donc jamais jusqu ici. La capture de pointeur fait le reste — un
     * glissement qui sort du canvas continue d etre livre au canvas.
     *
     * `touch-action` est pose en JavaScript plutot qu en CSS : la feuille de
     * style appartient a l interface, et cette regle n existe que parce que
     * cette ecoute existe. Sans elle, le navigateur fait defiler la page au
     * lieu de laisser tourner le personnage.
     */
    const previousTouchAction = canvas.style.touchAction;
    canvas.style.touchAction = 'none';

    const onPointerDown = (event: PointerEvent): void => {
      if (!showcase.current) return;
      control.start({ id: event.pointerId, x: event.clientX, y: event.clientY });
      canvas.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent): void => {
      control.move({ id: event.pointerId, x: event.clientX, y: event.clientY });
    };
    const onPointerUp = (event: PointerEvent): void => {
      control.end(event.pointerId);
    };
    /**
     * Le glissement s interrompt sans `pointerup` : appel entrant, geste
     * systeme, application mise en arriere-plan. Sans cette annulation, le
     * personnage tournerait pour toujours.
     *
     * Le garde n est pas une precaution : `lostpointercapture` suit **chaque**
     * `pointerup`, capture relachee implicitement par le navigateur. Annuler
     * sans condition tuerait donc l inertie de tous les lachers, et le geste
     * s arreterait net a chaque fois.
     */
    const onPointerLost = (): void => {
      if (control.dragging) control.cancel();
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerLost);
    canvas.addEventListener('lostpointercapture', onPointerLost);

    let frame = 0;
    let previous = performance.now();
    let wasShowcase = showcase.current;
    let stagedRound: number | null = null;
    /**
     * Horloge des danses, qui n est pas celle de la salle.
     *
     * Elle s accumule au lieu de suivre `performance.now()`, parce qu elle est
     * la seule a subir le ralenti : un timing parfait ou un Ultime fige un
     * instant les combattants pendant que la camera, la foule et les
     * projecteurs continuent a vitesse reelle. Une horloge absolue ne peut pas
     * ralentir sans sauter en arriere.
     */
    let danceClock = 0;
    /** Abscisse de repos du siege de gauche, avant recul. */
    let restingX = arena.fighters.a.root.position.x;

    const tick = (now: number): void => {
      frame = requestAnimationFrame(tick);
      // Un onglet revenu au premier plan livre plusieurs secondes d un coup :
      // les rattraper ferait traverser l arene aux personnages.
      /*
        La mesure lit l ecart **brut**, l animation l ecart borne.

        Le plafond de 0,25 s existe pour ne pas faire traverser l arene aux
        personnages apres un retour au premier plan. Mesurer la valeur bornee
        rendrait une suspension de dix secondes indistinguable d une image
        lente, et ferait chuter la qualite de quelqu un qui a simplement
        repondu a un message — c est justement ce que le gouverneur sait
        ecarter, a condition de voir le vrai nombre.
      */
      const rawMs = now - previous;
      const delta = Math.min(0.25, rawMs / 1000);
      previous = now;
      governorRef.current.record(rawMs);
      const elapsed = now / 1000;

      const scene = presentation.current;
      const solo = showcase.current;

      director.setReducedMotion(motion.reduced);

      /**
       * Une manche tranchee met l arene en scene, une seule fois.
       *
       * Le numero de manche est ce qui distingue « ca vient d arriver » de
       * « c est encore le resultat d avant » : en ligne, `lastRound` survit a
       * sa manche, et le rejouer relancerait le choc pendant la recharge
       * suivante.
       */
      const report = round.current;
      if (solo || report === null) {
        if (stagedRound !== null) {
          stagedRound = null;
          director.cancel();
          commitQuality();
        }
      } else if (report.round !== stagedRound) {
        stagedRound = report.round;
        director.play(storyOfRound(report));
        /*
          La revelation est le meilleur instant pour basculer : les deux choix
          sont verrouilles, plus rien du joueur n est mesure, et elle s ouvre
          sur un voile blanc qui couvre le changement de resolution.
        */
        commitQuality();
      }

      const colors: ClashColors = {
        a: scene?.fighters.a.look.aura ?? '#ffffff',
        b: scene?.fighters.b.look.aura ?? '#ffffff',
      };
      const ends: ClashEnds = {
        a: { x: arena.fighters.a.root.position.x, y: CHEST_HEIGHT, z: 0 },
        b: { x: arena.fighters.b.root.position.x, y: CHEST_HEIGHT, z: 0 },
      };
      director.update({ deltaMs: delta * 1000, ends, colors });

      // Le ralenti ne touche que les danses : `danceClock` avance moins vite
      // que `elapsed`, et c est elle que lisent l echantillonnage et les accents.
      const danceDelta = delta * director.timeScale;
      danceClock += danceDelta;

      /**
       * Un duel qui commence remet le personnage de face.
       *
       * Garder l angle **pendant** l inspection est le contrat (celui qui a
       * tourne pour voir le dos veut rester la) ; le garder d un duel a l autre
       * ne l est pas — on revient a l accueil et le personnage est de dos, sans
       * que personne l ait demande.
       */
      if (!solo && wasShowcase) control.reset();
      wasShowcase = solo;

      let showcaseAnimation: Animation | undefined;

      for (const seat of ['a', 'b'] as const) {
        const fighter = arena.fighters[seat];
        const shown = scene?.fighters[seat];
        if (shown === undefined) continue;
        fighter.dress(shown.look);
        const animation = ANIMATIONS.get(shown.animationId);
        if (animation === undefined) continue;
        if (seat === 'a') showcaseAnimation = animation;
        // Le decalage de phase evite que les deux respirent a l unisson.
        const offset = seat === 'a' ? 0 : 1.7;
        // La ferveur est la meme pour les deux sieges (voir `auraHype`) : le
        // rebond des genoux ne peut rien dire du coup joue.
        const target = livePose(animation, danceClock, offset, {
          hype: Math.max(scene?.hype ?? 0.2, director.hype),
          reducedMotion: motion.reduced,
        });
        fighter.pose(smoothers[seat].step(target, danceDelta), animation, danceClock, danceDelta);

        /**
         * Les temps forts du geste, sonnes au passage.
         *
         * Rien ne fuit : avant la revelation les deux combattants jouent la
         * garde, qui ne declare aucun accent. Un accent ne peut donc accompagner
         * qu un mouvement deja visible a l ecran.
         */
        const cue = cueRef.current;
        if (cue !== undefined) {
          const from = danceClock - danceDelta + offset;
          for (const accent of gestureCues(animation, from, danceClock + offset)) {
            cue(accent);
          }
        }
      }

      arena.fighters.b.root.visible = !solo;
      control.update(solo ? delta : 0);

      /**
       * Hors match, le joueur revient au centre.
       *
       * En duel il tient le siege de gauche ; seul a l ecran, rien ne justifie
       * qu il reste decale — le vide a droite se lirait comme un adversaire
       * manquant. Le retour est progressif : une teleportation entre deux
       * ecrans casserait la continuite de la vitrine.
       */
      const restX = solo ? 0 : -1.45;
      restingX += (restX - restingX) * Math.min(1, delta * 4);

      /**
       * Le recul du perdant s ajoute a sa place, il ne la remplace pas.
       *
       * Deux mouvements se superposent : celui de la mise en page — le joueur
       * qui revient au centre en quittant le duel — et celui du coup encaisse.
       * Les fondre en une seule abscisse ferait annuler l un par l autre au
       * pire moment, et le personnage frappe ne bougerait pas.
       */
      const fighter = arena.fighters.a.root;
      fighter.position.x = restingX + director.knockback('a');
      arena.fighters.b.root.position.x = 1.45 + director.knockback('b');

      /**
       * Le cadrage de la vitrine suit le meme joue.
       *
       * Rien de plus a appeler depuis l accueil : `presentation` porte deja
       * l identifiant de l animation, et sa mesure dit quelle distance il
       * faut. Une danse qui saute plus haut se cadre toute seule.
       */
      const focus = director.focus;
      let framing: CameraFraming;
      if (solo && showcaseAnimation !== undefined) {
        framing = previewFraming({
          worldX: fighter.position.x,
          bounds: boundsOf(showcaseAnimation),
          shot: showcaseAnimation.framing?.shot,
          orbit: control.yaw,
          tilt: control.tilt,
        });
      } else if (focus !== null) {
        // Le cadrage du duel appartient a la mise en scene, pas au doigt : on
        // se rapproche de celui qui se revele, puis de celui qui l emporte.
        framing = focusFraming({
          worldX: arena.fighters[focus.seat].root.position.x,
          worldY: CHEST_HEIGHT,
          facing: arena.fighters[focus.seat].placement.facing,
          zoom: focus.zoom,
        });
      } else {
        framing = wideFraming();
      }

      /*
        Ce que chaque aura doit afficher, et rien de plus.

        Regle d or n°4 : avant le choc, les deux sieges recoivent la MEME
        ferveur — celle que la phase justifie, identique des deux cotes. Le
        palier joue par chacun est secret jusqu a `round:result` et n entre
        jamais ici ; `auraIntensity` n a d ailleurs aucun champ ou le mettre.
        Le seul moment ou les deux auras different est le choc, une fois les
        deux choix publics.
      */
      const auraHype = Math.max(scene?.hype ?? 0.2, director.hype);
      for (const seat of ['a', 'b'] as const) {
        arena.auras[seat].set({
          /*
            L effet annonce par le serveur avec le resultat, quand il existe.

            Il depend du palier d amplificateur joue, que le serveur seul
            connait — et qu il n envoie qu a `round:result`, une fois les deux
            choix publics. Avant la revelation, `auraEffectId` est absent et
            les deux sieges portent le meme effet : la regle d or n°4 tient
            parce qu il n y a rien a dire, pas parce qu on evite de le dire.
          */
          effectId:
            scene?.fighters[seat].auraEffectId ??
            scene?.fighters[seat].look.auraEffect ??
            DEFAULT_AURA_EFFECT,
          color: scene?.fighters[seat].look.aura ?? '#ffcf3f',
          intensity: auraIntensity({
            showcase: solo,
            hype: auraHype,
            clashWeight: director.auraWeight(seat),
          }),
        });
      }

      // Le panneau lateral : l arene recentre le sujet dans ce qui reste.
      // `setSidePanel` ne fait rien quand la valeur n a pas change.
      arena.setSidePanel(sidePanel.current);

      arena.update({
        elapsed,
        delta,
        framing,
        // La ferveur est la plus haute des deux : celle que la phase justifie,
        // et celle que le choc vient d allumer.
        hype: auraHype,
        shake: director.shake,
        flash: director.flash,
        reducedMotion: motion.reduced,
        showcase: solo,
      });

      /**
       * Les particules de l arene, posees juste avant le rendu.
       *
       * `begin` / `draw` / `commit` a chaque image : rien n est conserve d une
       * image sur l autre, et tout ce qui est pose ici — faisceaux du choc,
       * gerbes, ondes — tient dans les deux memes tampons.
       */
      arena.particles.begin();
      arena.drawAuras(arena.particles, elapsed);
      director.draw(arena.particles, now);
      arena.particles.commit();

      renderer.renderer.render(arena.scene, arena.camera);
    };

    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerLost);
      canvas.removeEventListener('lostpointercapture', onPointerLost);
      canvas.style.touchAction = previousTouchAction;
      motion.dispose();
      arena.dispose();
      renderer.dispose();
    };
  }, [canvasRef]);

  /**
   * Une identite stable, pas un objet neuf a chaque rendu.
   *
   * Les refs, elles, ne changent jamais ; c est l enveloppe qui trahissait.
   * Un appelant qui met `arena` dans ses dependances relancait son effet a
   * chaque rendu — anodin pour une boucle d animation, fatal pour celui qui
   * tient la socket du duel.
   */
  return useMemo(
    () => ({
      presentation,
      showcase,
      round,
      sidePanel,
      resetOrbit(): void {
        orbit.current.reset();
      },
    }),
    [],
  );
}
