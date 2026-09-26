import type { Animation } from '@aura/content';
import { describe, expect, it } from 'vitest';
import { ANIMATIONS } from '../content/animations.js';
import { soundForCue, type AudioCue } from './cues.js';
import { gestureCues } from './gestures.js';

/** Une animation reduite a ce que `gestureCues` regarde. */
function withAccents(sound: Animation['sound'], duration = 2): Animation {
  return { loop: { duration }, sound } as unknown as Animation;
}

const accentsOf = (cues: readonly AudioCue[]): readonly string[] =>
  cues.map((cue) => (cue.type === 'gesture' ? cue.accent : cue.type));

describe('gestureCues', () => {
  it('ne rend rien pour une danse muette', () => {
    expect(gestureCues(withAccents(undefined), 0, 5)).toEqual([]);
    expect(gestureCues(withAccents([]), 0, 5)).toEqual([]);
  });

  it('rend l accent dont l instant tombe dans l intervalle', () => {
    const animation = withAccents([{ at: 0.5, accent: 'impact' }]);
    expect(accentsOf(gestureCues(animation, 0.9, 1.1))).toEqual(['impact']);
  });

  it('ne rend rien quand l instant est ailleurs', () => {
    const animation = withAccents([{ at: 0.5, accent: 'impact' }]);
    expect(gestureCues(animation, 0.2, 0.9)).toEqual([]);
    expect(gestureCues(animation, 1.1, 1.9)).toEqual([]);
  });

  /**
   * Le bord qui compte : un intervalle ferme des deux cotes rejouerait
   * l impact a l image suivante, puisque la fin d une image est le debut de la
   * suivante. Soixante fois par seconde, ca s entend.
   */
  it('ne sonne jamais deux fois le meme passage sur deux images qui se touchent', () => {
    const animation = withAccents([{ at: 0.5, accent: 'impact' }]);
    expect(accentsOf(gestureCues(animation, 0.95, 1))).toEqual(['impact']);
    expect(gestureCues(animation, 1, 1.05)).toEqual([]);
  });

  it('sonne une fois par tour de boucle', () => {
    const animation = withAccents([{ at: 0.5, accent: 'impact' }]);
    let sonne = 0;
    const step = 1 / 60;
    for (let i = 0; i < 60 * 6; i++) {
      sonne += gestureCues(animation, i * step, (i + 1) * step).length;
    }
    // Six secondes, une boucle de deux secondes : trois passages.
    expect(sonne).toBe(3);
  });

  /**
   * Retour d arriere-plan : l application peut etre suspendue en plein match
   * (CLAUDE.md, « Mise en arriere-plan mobile »). Elle revient avec un
   * intervalle de trente secondes — qui ne doit pas lacher quinze impacts.
   */
  it('ne deverse pas la boucle entiere apres une suspension', () => {
    const animation = withAccents([
      { at: 0.3, accent: 'whoosh' },
      { at: 0.7, accent: 'impact' },
    ]);
    // Chacun sonne une fois, et dans l ordre de leur DERNIER passage : a
    // t=31 s, l impact du tour 14 (29,4 s) precede le souffle du tour 15
    // (30,6 s). L ordre du fichier n a pas son mot a dire.
    expect(accentsOf(gestureCues(animation, 1, 31))).toEqual(['impact', 'whoosh']);
  });

  it('rend les accents dans l ordre chronologique, pas dans celui du fichier', () => {
    const animation = withAccents([
      { at: 0.7, accent: 'impact' },
      { at: 0.3, accent: 'whoosh' },
    ]);
    expect(accentsOf(gestureCues(animation, 0, 2))).toEqual(['whoosh', 'impact']);
  });

  /**
   * Un intervalle qui enjambe la fin de la boucle : l impact de la fin du tour
   * precede le souffle du tour suivant, et l ordre du fichier dirait
   * l inverse.
   */
  it('respecte l ordre a cheval sur deux tours', () => {
    const animation = withAccents([
      { at: 0.3, accent: 'whoosh' },
      { at: 0.7, accent: 'impact' },
    ]);
    expect(accentsOf(gestureCues(animation, 1.3, 2.7))).toEqual(['impact', 'whoosh']);
  });

  it('ignore un intervalle vide ou a l envers', () => {
    const animation = withAccents([{ at: 0.5, accent: 'impact' }]);
    expect(gestureCues(animation, 1, 1)).toEqual([]);
    expect(gestureCues(animation, 1.1, 0.9)).toEqual([]);
  });

  it('accepte un accent pose sur la premiere image', () => {
    const animation = withAccents([{ at: 0, accent: 'hold' }]);
    expect(accentsOf(gestureCues(animation, -0.01, 0.01))).toEqual(['hold']);
  });
});

describe('les accents du catalogue livre', () => {
  const animation = (id: string): Animation => {
    const found = ANIMATIONS.get(id);
    expect(found, id).toBeDefined();
    return found!;
  };

  it('fait claquer la roue une fois par tour, souffle avant impact', () => {
    const roue = animation('anim.acrobatie.t2.wheel');
    const entendus: string[] = [];
    const step = 1 / 60;
    const tours = Math.round((roue.loop.duration / step) * 2);
    for (let i = 0; i < tours; i++) {
      for (const cue of gestureCues(roue, i * step, (i + 1) * step)) {
        if (cue.type === 'gesture') entendus.push(cue.accent);
      }
    }
    expect(entendus).toEqual(['whoosh', 'impact', 'whoosh', 'impact']);
  });

  /**
   * Le bout en bout : une danse du catalogue produit un son reel. Sans lui,
   * l accent pourrait se programmer parfaitement et ne rien jouer.
   */
  it('mene chaque accent livre jusqu a un son', () => {
    const muettes: string[] = [];
    for (const [id, item] of ANIMATIONS) {
      for (const accent of item.sound ?? []) {
        const son = soundForCue({ type: 'gesture', accent: accent.accent });
        if (son === null) muettes.push(`${id} : ${accent.accent}`);
      }
    }
    expect(muettes).toEqual([]);
  });

  /**
   * Regle d or n°4. Un accent ne transporte que ce que le corps fait : ni le
   * style, ni le palier, ni la reussite, ni le siege. Un son qui dirait « en
   * face, quelqu un vient de choisir une acrobatie » vaudrait le message que
   * le protocole refuse d envoyer avant `round:result`.
   */
  it('donne le meme son au meme geste, quel que soit le siege', () => {
    for (const accent of ['whoosh', 'impact', 'hold'] as const) {
      const cue: AudioCue = { type: 'gesture', accent };
      expect(soundForCue(cue)).toEqual(soundForCue({ ...cue }));
      expect(Object.keys(cue).sort()).toEqual(['accent', 'type']);
    }
  });
});
