import { useEffect, useMemo, useRef } from 'react';
import { createAudioEngine, type AudioEngine } from '../audio/engine.js';

/**
 * Le moteur audio, branche sur le cycle de vie de l application.
 *
 * Deux gestes que personne ne fait spontanement, et dont l oubli ne se voit
 * jamais — il s entend, ou plutot il ne s entend pas :
 *
 * 1. **Le premier geste.** Sur iOS, un `AudioContext` cree hors d un geste
 *    utilisateur naît suspendu et le reste. Sans ce `resume()`, le jeu est muet
 *    sur iPhone, sans la moindre erreur nulle part.
 * 2. **La mise en arriere-plan.** Un jeu mobile qu on quitte doit se taire ;
 *    celui qui continue de sonner par-dessus la musique du telephone se fait
 *    desinstaller.
 *
 * Ce fichier est un adaptateur : il ne decide rien. Le choix des sons vit dans
 * `audio/cues.ts` et `audio/matchCues.ts`, qui sont purs et testes.
 */

export interface AudioControls {
  readonly engine: AudioEngine;
}

export function useAudio(): AudioControls {
  const engine = useMemo(() => createAudioEngine(), []);

  /**
   * Le deverrouillage n a lieu qu une fois.
   *
   * Appeler `resume()` a chaque appui marcherait, mais ferait une promesse par
   * tap pendant la recharge — soit une douzaine par seconde au plus fort du
   * jeu, exactement quand le fil principal a autre chose a faire.
   */
  const unlocked = useRef(false);

  useEffect(() => {
    const unlock = (): void => {
      if (unlocked.current) return;
      unlocked.current = true;
      void engine.resume();
    };

    /**
     * `pointerdown` couvre le doigt et la souris ; `keydown` garde le clavier,
     * seule entree possible au debogage sur ordinateur. L ecoute est en phase
     * de capture pour deverrouiller meme si un composant arrete l evenement.
     */
    const options = { capture: true, passive: true } as const;
    window.addEventListener('pointerdown', unlock, options);
    window.addEventListener('keydown', unlock, { capture: true });

    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') {
        void engine.suspend();
      } else if (unlocked.current) {
        // Reprendre sans deverrouillage prealable recreerait le contexte hors
        // d un geste : iOS le rendrait suspendu, et le jeu resterait muet.
        void engine.resume();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.removeEventListener('pointerdown', unlock, options);
      window.removeEventListener('keydown', unlock, { capture: true });
      document.removeEventListener('visibilitychange', onVisibility);
      engine.dispose();
    };
  }, [engine]);

  return useMemo(() => ({ engine }), [engine]);
}
