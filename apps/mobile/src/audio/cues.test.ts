import { describe, expect, it } from 'vitest';
import type { ArenaEvent } from '../arena/events.js';
import { COMBO_MILESTONE, cueForArenaEvent, isComboMilestone, soundForCue } from './cues.js';
import { voicesFor } from './sounds.js';

describe('soundForCue', () => {
  it('distingue le tap ordinaire, le tap dore et le rate', () => {
    expect(soundForCue({ type: 'orbTap', golden: false, hit: true, combo: 3 })?.name).toBe('tap');
    expect(soundForCue({ type: 'orbTap', golden: true, hit: true, combo: 3 })?.name).toBe(
      'tapGold',
    );
    expect(soundForCue({ type: 'orbTap', golden: false, hit: false, combo: 3 })?.name).toBe(
      'tapMiss',
    );
  });

  it('porte le combo jusqu au son du tap', () => {
    expect(soundForCue({ type: 'orbTap', golden: false, hit: true, combo: 9 })?.combo).toBe(9);
  });

  // Un rate casse le combo : le faire sonner aigu mentirait sur l etat du jeu.
  it('oublie le combo sur un rate', () => {
    expect(soundForCue({ type: 'orbTap', golden: false, hit: false, combo: 9 })?.combo).toBe(0);
  });

  it('ne felicite le combo qu a ses paliers', () => {
    expect(soundForCue({ type: 'combo', combo: COMBO_MILESTONE })?.name).toBe('chime');
    expect(soundForCue({ type: 'combo', combo: COMBO_MILESTONE - 1 })).toBeNull();
    expect(soundForCue({ type: 'combo', combo: 0 })).toBeNull();
  });

  it('sonne le verrouillage et la fin de recharge', () => {
    expect(soundForCue({ type: 'lock' })?.name).toBe('lock');
    expect(soundForCue({ type: 'rechargeEnd' })?.name).toBe('rechargeEnd');
  });

  it('sonne la qualite du timing du joueur local', () => {
    const local = { type: 'reveal', local: true, ultimate: false } as const;
    expect(soundForCue({ ...local, quality: 'perfect' })?.name).toBe('perfect');
    expect(soundForCue({ ...local, quality: 'good' })?.name).toBe('good');
    expect(soundForCue({ ...local, quality: 'miss' })?.name).toBe('miss');
  });

  // Regle d or n°4 : le timing de l adversaire ne fuite pas. Un son different
  // selon sa reussite la donnerait a l oreille avant le resultat.
  it('ne laisse pas entendre la qualite du timing adverse', () => {
    const adverse = { type: 'reveal', local: false, ultimate: false } as const;
    const noms = (['perfect', 'good', 'miss'] as const).map(
      (quality) => soundForCue({ ...adverse, quality })?.name,
    );
    expect(new Set(noms)).toEqual(new Set(['reveal']));
  });

  it('couvre tout le reste quand un Ultime part', () => {
    expect(
      soundForCue({ type: 'reveal', local: true, quality: 'miss', ultimate: true })?.name,
    ).toBe('ultimate');
    expect(
      soundForCue({ type: 'reveal', local: false, quality: 'perfect', ultimate: true })?.name,
    ).toBe('ultimate');
  });

  it('separe le choc du contre', () => {
    expect(soundForCue({ type: 'clash', counter: false })?.name).toBe('clash');
    expect(soundForCue({ type: 'clash', counter: true })?.name).toBe('counter');
  });

  it('sonne la victoire, la defaite, et se tait sur une egalite', () => {
    expect(soundForCue({ type: 'matchEnd', outcome: 'win' })?.name).toBe('victory');
    expect(soundForCue({ type: 'matchEnd', outcome: 'loss' })?.name).toBe('defeat');
    expect(soundForCue({ type: 'matchEnd', outcome: 'draw' })).toBeNull();
  });

  it('ne nomme que des sons qui existent dans la table', () => {
    const cues = [
      { type: 'orbTap', golden: false, hit: true, combo: 1 },
      { type: 'orbTap', golden: true, hit: true, combo: 1 },
      { type: 'orbTap', golden: false, hit: false, combo: 1 },
      { type: 'combo', combo: COMBO_MILESTONE },
      { type: 'rechargeEnd' },
      { type: 'lock' },
      { type: 'reveal', local: true, quality: 'perfect', ultimate: false },
      { type: 'reveal', local: false, quality: 'good', ultimate: false },
      { type: 'reveal', local: true, quality: 'good', ultimate: true },
      { type: 'clash', counter: false },
      { type: 'clash', counter: true },
      { type: 'matchEnd', outcome: 'win' },
      { type: 'matchEnd', outcome: 'loss' },
    ] as const;
    for (const cue of cues) {
      const request = soundForCue(cue);
      expect(request, cue.type).not.toBeNull();
      expect(voicesFor(request?.name ?? 'click').length).toBeGreaterThan(0);
    }
  });
});

describe('isComboMilestone', () => {
  it('tombe tous les cinq orbes', () => {
    expect(isComboMilestone(5)).toBe(true);
    expect(isComboMilestone(10)).toBe(true);
    expect(isComboMilestone(4)).toBe(false);
  });

  it('ne felicite pas un combo nul ou negatif', () => {
    expect(isComboMilestone(0)).toBe(false);
    expect(isComboMilestone(-5)).toBe(false);
  });

  it('ignore une valeur qui n est pas un compte entier', () => {
    expect(isComboMilestone(5.5)).toBe(false);
    expect(isComboMilestone(Number.NaN)).toBe(false);
  });
});

describe('cueForArenaEvent', () => {
  // L image et le son partent du meme evenement serveur : c est ce qui garantit
  // qu ils ne racontent pas deux histoires differentes.
  it('traduit une revelation en gardant qui joue', () => {
    const event: ArenaEvent = {
      type: 'reveal',
      seat: 'a',
      local: true,
      score: 80,
      quality: 'perfect',
      ultimate: false,
    };
    expect(cueForArenaEvent(event, 'a')).toEqual({
      type: 'reveal',
      local: true,
      quality: 'perfect',
      ultimate: false,
    });
  });

  it('reconnait un contre au siege qui l a porte', () => {
    expect(
      cueForArenaEvent({ type: 'clash', winner: 'a', counter: 'a', ultimate: null }, 'a'),
    ).toEqual({
      type: 'clash',
      counter: true,
    });
    expect(
      cueForArenaEvent({ type: 'clash', winner: 'b', counter: null, ultimate: null }, 'a'),
    ).toEqual({
      type: 'clash',
      counter: false,
    });
  });

  it('lit la victoire du point de vue de cet appareil', () => {
    expect(cueForArenaEvent({ type: 'victory', seat: 'a' }, 'a')).toEqual({
      type: 'matchEnd',
      outcome: 'win',
    });
    expect(cueForArenaEvent({ type: 'victory', seat: 'a' }, 'b')).toEqual({
      type: 'matchEnd',
      outcome: 'loss',
    });
    expect(cueForArenaEvent({ type: 'victory', seat: null }, 'a')).toEqual({
      type: 'matchEnd',
      outcome: 'draw',
    });
  });
});

describe('soundForCue — gestes de carte (chantier n°2)', () => {
  it('donne un son a chaque geste de la main', () => {
    expect(soundForCue({ type: 'card', action: 'deal' })?.name).toBe('whoosh');
    expect(soundForCue({ type: 'card', action: 'pick' })?.name).toBe('click');
    expect(soundForCue({ type: 'card', action: 'flip' })?.name).toBe('select');
    expect(soundForCue({ type: 'card', action: 'denied' })?.name).toBe('tapMiss');
    expect(soundForCue({ type: 'card', action: 'shiny' })?.name).toBe('tapGold');
  });
});

describe('soundForCue — passe de saison', () => {
  it('sonne une recompense a sa mesure', () => {
    expect(soundForCue({ type: 'reward', size: 'small' })?.name).toBe('buy');
    expect(soundForCue({ type: 'reward', size: 'rare' })?.name).toBe('chime');
    expect(soundForCue({ type: 'reward', size: 'jackpot' })?.name).toBe('victory');
  });
});
