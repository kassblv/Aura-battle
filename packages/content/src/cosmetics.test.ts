import { describe, expect, it } from 'vitest';
import {
  AURA_COLORS,
  AURA_EFFECTS,
  danceKey,
  defaultEffectForLevel,
  effectForLevel,
  effectsForLevel,
  HAIRSTYLES,
  OUTFITS,
  SKIN_TONES,
  type AmplifierLevel,
} from './cosmetics.js';

const LEVELS: readonly AmplifierLevel[] = [0, 1, 2, 3, 4];

describe('aucun avantage payant (regle d or n°3)', () => {
  it('ne laisse aucun cosmetique porter de valeur de jeu', () => {
    const interdits = ['mult', 'multiplier', 'power', 'cost', 'bonus', 'damage'];
    const catalogues = [...AURA_EFFECTS, ...AURA_COLORS, ...HAIRSTYLES, ...OUTFITS];
    for (const item of catalogues) {
      for (const cle of Object.keys(item)) {
        expect(interdits).not.toContain(cle);
      }
    }
  });

  it('offre un effet d aura a chaque niveau d amplificateur', () => {
    for (const level of LEVELS) {
      expect(defaultEffectForLevel(level).price).toBe(0);
    }
  });

  it('offre au moins une tenue et une coiffure', () => {
    expect(OUTFITS.some((outfit) => outfit.price === 0)).toBe(true);
    expect(HAIRSTYLES.some((hair) => hair.price === 0)).toBe(true);
    expect(AURA_COLORS.some((color) => color.price === 0)).toBe(true);
  });
});

describe('AURA_EFFECTS', () => {
  it('porte les huit effets du prototype', () => {
    expect(AURA_EFFECTS).toHaveLength(8);
  });

  it('couvre les cinq niveaux d amplificateur', () => {
    for (const level of LEVELS) {
      expect(effectsForLevel(level).length).toBeGreaterThan(0);
    }
  });

  it('range les effets supplementaires en skins d un niveau existant', () => {
    expect(effectsForLevel(1).map((effect) => effect.id)).toEqual(['fx.sparks', 'fx.flames']);
    expect(effectsForLevel(2).map((effect) => effect.id)).toEqual(['fx.lightning', 'fx.shock']);
    expect(effectsForLevel(3).map((effect) => effect.id)).toEqual(['fx.vortex', 'fx.dark']);
  });

  it('nomme exactement un effet par defaut par niveau', () => {
    for (const level of LEVELS) {
      const defauts = effectsForLevel(level).filter((effect) => effect.rarity === 'default');
      expect(defauts).toHaveLength(1);
    }
  });
});

describe('catalogues', () => {
  it('n utilise jamais deux fois le meme identifiant', () => {
    const ids = [...AURA_EFFECTS, ...AURA_COLORS, ...HAIRSTYLES, ...OUTFITS].map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('exprime toutes les couleurs en hexadecimal', () => {
    const hex = /^#[0-9a-f]{6}$/;
    for (const color of AURA_COLORS) expect(color.hex).toMatch(hex);
    for (const tone of SKIN_TONES) expect(tone).toMatch(hex);
    for (const outfit of OUTFITS) {
      expect(outfit.jacket).toMatch(hex);
      expect(outfit.pants).toMatch(hex);
      expect(outfit.shoes).toMatch(hex);
    }
  });

  it('ne vend jamais une teinte de peau', () => {
    expect(SKIN_TONES).toHaveLength(4);
  });

  it('gele les catalogues', () => {
    expect(Object.isFrozen(AURA_EFFECTS)).toBe(true);
    expect(Object.isFrozen(OUTFITS)).toBe(true);
  });
});

/**
 * L'effet qu'un joueur voit a un niveau d'amplificateur donne.
 *
 * `docs/01-game-design.md` §3 : l'amplificateur s'affiche sous le nom de son
 * effet offert, et « Flammes, Onde de choc, Aura noire deviennent des skins
 * cosmetiques d'un NIVEAU ». Un skin achete habille donc un seul niveau : il
 * recompense le moment ou on l'a paye, pas toute la partie.
 */
describe('effectForLevel', () => {
  it('rend l effet offert quand le joueur n a rien achete', () => {
    for (const level of [0, 1, 2, 3, 4] as const) {
      expect(effectForLevel(level, []).id).toBe(defaultEffectForLevel(level).id);
    }
  });

  it('rend le skin achete au niveau qu il habille', () => {
    expect(effectForLevel(1, ['fx.flames']).id).toBe('fx.flames');
    expect(effectForLevel(2, ['fx.shock']).id).toBe('fx.shock');
    expect(effectForLevel(3, ['fx.dark']).id).toBe('fx.dark');
  });

  /*
    Le coeur de la regle. Acheter les Flammes n'habille QUE l'amplificateur A1 :
    jouer A4 montre la Galaxie, comme tout le monde. Sans ca, l'amplificateur
    cesse d'etre lisible a l'ecran — son nom EST celui de son effet.
  */
  it('ne deborde pas sur les autres niveaux', () => {
    const owned = ['fx.flames'];
    expect(effectForLevel(0, owned).id).toBe('fx.glow');
    expect(effectForLevel(2, owned).id).toBe('fx.lightning');
    expect(effectForLevel(3, owned).id).toBe('fx.vortex');
    expect(effectForLevel(4, owned).id).toBe('fx.galaxy');
  });

  it('sert chaque niveau quand le joueur a tout achete', () => {
    const tout = AURA_EFFECTS.map((effect) => effect.id);
    expect(effectForLevel(1, tout).id).toBe('fx.flames');
    expect(effectForLevel(2, tout).id).toBe('fx.shock');
    expect(effectForLevel(3, tout).id).toBe('fx.dark');
    // Les niveaux sans skin payant gardent leur effet offert.
    expect(effectForLevel(0, tout).id).toBe('fx.glow');
    expect(effectForLevel(4, tout).id).toBe('fx.galaxy');
  });

  /*
    Ce que le joueur possede vient de la base, mais la liste traverse le
    reseau. Un identifiant inconnu — vieux catalogue, message bricole — ne doit
    pas faire disparaitre l'aura : on retombe sur l'effet offert.
  */
  it('ignore ce qu il ne connait pas', () => {
    expect(effectForLevel(1, ['fx.inexistant', 'outfit.noir']).id).toBe('fx.sparks');
    expect(effectForLevel(1, []).id).toBe('fx.sparks');
  });

  it('rend toujours un effet du niveau demande', () => {
    for (const level of [0, 1, 2, 3, 4] as const) {
      for (const owned of [[], ['fx.flames'], ['fx.dark', 'fx.shock']]) {
        expect(effectForLevel(level, owned).level, `A${String(level)}`).toBe(level);
      }
    }
  });
});

describe('danceKey', () => {
  /*
    Le format est documente dans `LoadoutData.dances` et dans le schema Prisma,
    et il est lu des deux cotes. Le figer ici est ce qui empeche le client et
    le serveur de diverger en silence : une cle differente ne provoque aucune
    erreur, seulement une danse equipee que l'adversaire ne voit jamais.
  */
  it('suit le format annonce par le modele de donnees', () => {
    expect(danceKey({ style: 'hype', tier: 3 })).toBe('hype.t3');
    expect(danceKey({ style: 'calme', tier: 0 })).toBe('calme.t0');
    expect(danceKey({ style: 'provoc', tier: 4 })).toBe('provoc.t4');
  });

  it('distingue deux mouvements qui ne different que par le palier', () => {
    expect(danceKey({ style: 'hype', tier: 1 })).not.toBe(danceKey({ style: 'hype', tier: 2 }));
  });
});
