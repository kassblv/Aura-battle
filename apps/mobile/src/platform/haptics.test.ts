import { describe, expect, it } from 'vitest';
import { HAPTIC_MIN_GAP_MS, createHaptics, hapticFor, type HapticDriver } from './haptics.js';

describe('hapticFor', () => {
  /*
    Le toucher double le son, il ne le remplace pas.

    On ne fait pas vibrer a chaque evenement : un telephone qui bourdonne en
    continu pendant une recharge de douze taps par seconde devient penible, et
    le joueur coupe le retour au lieu de couper le bruit. Seuls les faits qui
    ont un POIDS le meritent.
  */
  it('ne fait rien vibrer pour un tap ordinaire', () => {
    expect(hapticFor({ type: 'orbTap', golden: false, hit: true, combo: 3 })).toBeNull();
  });

  it('marque l orbe doree', () => {
    expect(hapticFor({ type: 'orbTap', golden: true, hit: true, combo: 1 })).toBe('light');
  });

  /*
    Un tap rate se sent, et c est le seul retour immediat : le son du rate se
    perd dans celui des orbes voisines, et l oeil est occupe ailleurs.
  */
  it('marque un tap tombe a cote', () => {
    expect(hapticFor({ type: 'orbTap', golden: false, hit: false, combo: 0 })).toBe('light');
  });

  it('marque le verrouillage du choix', () => {
    expect(hapticFor({ type: 'lock' })).toBe('medium');
  });

  it('pese le choc plus fort qu un contre', () => {
    expect(hapticFor({ type: 'clash', counter: false })).toBe('medium');
    expect(hapticFor({ type: 'clash', counter: true })).toBe('heavy');
  });

  it('marque un Ultime revele', () => {
    expect(hapticFor({ type: 'reveal', local: true, quality: 'perfect', ultimate: true })).toBe(
      'heavy',
    );
    expect(hapticFor({ type: 'reveal', local: true, quality: 'good', ultimate: false })).toBeNull();
  });

  /*
    Regle d or n°4 : le toucher est un canal comme un autre.

    Une vibration declenchee par la revelation de l ADVERSAIRE dirait, par le
    doigt, quelque chose que l ecran n a pas encore montre. Seul ce qui arrive
    au joueur de cet appareil se sent.
  */
  it('ne fait rien sentir de la revelation adverse', () => {
    expect(
      hapticFor({ type: 'reveal', local: false, quality: 'perfect', ultimate: true }),
    ).toBeNull();
  });

  it('marque la fin du match selon son issue', () => {
    expect(hapticFor({ type: 'matchEnd', outcome: 'win' })).toBe('heavy');
    expect(hapticFor({ type: 'matchEnd', outcome: 'loss' })).toBe('medium');
    expect(hapticFor({ type: 'matchEnd', outcome: 'draw' })).toBe('medium');
  });

  it('ignore les accents de geste', () => {
    expect(hapticFor({ type: 'gesture', accent: 'impact' })).toBeNull();
  });
});

describe('createHaptics', () => {
  /** Pilote de test : il note ce qu on lui demande. */
  function driver(): HapticDriver & { readonly calls: string[] } {
    const calls: string[] = [];
    return {
      calls,
      impact: (style) => {
        calls.push(style);
      },
    };
  }

  it('transmet ce qui merite une vibration', () => {
    const d = driver();
    const haptics = createHaptics(d, { now: () => 0 });
    haptics.cue({ type: 'lock' });
    expect(d.calls).toEqual(['medium']);
  });

  it('laisse passer ce qui n en merite pas', () => {
    const d = driver();
    const haptics = createHaptics(d, { now: () => 0 });
    haptics.cue({ type: 'orbTap', golden: false, hit: true, combo: 2 });
    expect(d.calls).toEqual([]);
  });

  /*
    Un plancher entre deux vibrations.

    Une revelation, un choc et une fin de manche tombent a quelques dizaines de
    millisecondes d ecart. Sans plancher, le moteur du telephone les empile et
    rend un bourdonnement continu au lieu de trois coups — et le joueur ne sent
    plus rien de precis, ce qui est pire que pas de retour du tout.
  */
  it('espace deux vibrations', () => {
    const d = driver();
    let t = 0;
    const haptics = createHaptics(d, { now: () => t });
    haptics.cue({ type: 'lock' });
    t = HAPTIC_MIN_GAP_MS - 1;
    haptics.cue({ type: 'clash', counter: true });
    expect(d.calls).toEqual(['medium']);

    t = HAPTIC_MIN_GAP_MS;
    haptics.cue({ type: 'clash', counter: true });
    expect(d.calls).toEqual(['medium', 'heavy']);
  });

  it('s eteint et se rallume', () => {
    const d = driver();
    const haptics = createHaptics(d, { now: () => 0 });
    haptics.setEnabled(false);
    haptics.cue({ type: 'lock' });
    expect(d.calls).toEqual([]);

    haptics.setEnabled(true);
    haptics.cue({ type: 'lock' });
    expect(d.calls).toEqual(['medium']);
  });

  /*
    Un pilote absent est le cas NORMAL : sur un navigateur de bureau, il n y a
    pas de moteur a faire tourner. Ce n est pas une panne, et ca ne doit pas
    en devenir une.
  */
  it('ne casse rien sans pilote', () => {
    const haptics = createHaptics(null, { now: () => 0 });
    expect(() => {
      haptics.cue({ type: 'lock' });
    }).not.toThrow();
  });

  it('avale l echec d un pilote', () => {
    const haptics = createHaptics(
      {
        impact: () => {
          throw new Error('moteur occupe');
        },
      },
      { now: () => 0 },
    );
    expect(() => {
      haptics.cue({ type: 'lock' });
    }).not.toThrow();
  });
});

describe('hapticFor — gestes de carte', () => {
  it('fait sentir le choix, le retournement et la brillante, pas la distribution', () => {
    expect(hapticFor({ type: 'card', action: 'pick' })).toBe('light');
    expect(hapticFor({ type: 'card', action: 'flip' })).toBe('light');
    expect(hapticFor({ type: 'card', action: 'shiny' })).toBe('light');
    expect(hapticFor({ type: 'card', action: 'deal' })).toBeNull();
    expect(hapticFor({ type: 'card', action: 'denied' })).toBeNull();
  });
});
