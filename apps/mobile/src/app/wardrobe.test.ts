import {
  animationIdsFor,
  AURA_COLORS,
  defaultAnimationFor,
  HAIRSTYLES,
  OUTFITS,
  SKIN_TONES,
} from '@aura/content';
import { describe, expect, it } from 'vitest';
import {
  danceFor,
  danceOptions,
  defaultLook,
  effectItems,
  isWorn,
  itemInfo,
  ownsItem,
  equip,
  equipDance,
  equipSignature,
  isOwned,
  priceOf,
  wardrobeSections,
  type Wardrobe,
} from './wardrobe.js';

const free = (): Wardrobe => ({
  look: defaultLook(),
  owned: new Set(
    [...OUTFITS, ...HAIRSTYLES, ...AURA_COLORS].filter((i) => i.price === 0).map((i) => i.id),
  ),
});

describe('defaultLook', () => {
  it('habille tout le monde sans rien acheter', () => {
    const look = defaultLook();
    const outfit = OUTFITS.find((o) => o.id === look.outfit);
    const hair = HAIRSTYLES.find((h) => h.id === look.hair);
    expect(outfit?.price).toBe(0);
    expect(hair?.price).toBe(0);
    expect(SKIN_TONES).toContain(look.skin);
  });
});

describe('wardrobeSections', () => {
  it('range le catalogue par nature, dans l ordre ou on s habille', () => {
    expect(wardrobeSections().map((s) => s.id)).toEqual(['outfit', 'hair', 'skin', 'aura']);
  });

  it('expose le catalogue reel, pas une copie locale', () => {
    const sections = wardrobeSections();
    expect(sections[0]?.items).toHaveLength(OUTFITS.length);
    expect(sections[1]?.items).toHaveLength(HAIRSTYLES.length);
    expect(sections[2]?.items).toHaveLength(SKIN_TONES.length);
    expect(sections[3]?.items).toHaveLength(AURA_COLORS.length);
  });

  /**
   * Regle d or n°3. Le test est ici plutot que dans une revue : c est la seule
   * garantie qui survit a l ajout d un objet six mois plus tard.
   */
  it('ne laisse aucun objet porter une valeur de jeu', () => {
    for (const section of wardrobeSections()) {
      for (const item of section.items) {
        const keys = Object.keys(item);
        expect(keys).not.toContain('power');
        expect(keys).not.toContain('multiplier');
        expect(keys).not.toContain('energy');
        expect(keys).not.toContain('bonus');
      }
    }
  });

  it('offre les teintes de peau : une apparence de base ne se vend pas', () => {
    const skins = wardrobeSections().find((s) => s.id === 'skin');
    for (const item of skins?.items ?? []) expect(item.price).toBe(0);
  });
});

describe('equip', () => {
  it('change la piece demandee et ne touche pas les autres', () => {
    const before = free();
    const after = equip(before, 'outfit', 'outfit.blanc');
    expect(after.look.outfit).toBe('outfit.blanc');
    expect(after.look.hair).toBe(before.look.hair);
    expect(after.look.skin).toBe(before.look.skin);
  });

  it('refuse un objet qu on ne possede pas', () => {
    const wardrobe = free();
    // `outfit.dore` coute 700 : personne ne le porte sans l avoir achete.
    expect(equip(wardrobe, 'outfit', 'outfit.dore')).toBe(wardrobe);
  });

  it('refuse un identifiant inconnu', () => {
    const wardrobe = free();
    expect(equip(wardrobe, 'hair', 'hair.inexistante')).toBe(wardrobe);
  });

  it('ne fabrique pas un nouvel etat quand la piece est deja portee', () => {
    const wardrobe = free();
    expect(equip(wardrobe, 'outfit', wardrobe.look.outfit)).toBe(wardrobe);
  });

  it('accepte toutes les teintes de peau sans les posseder', () => {
    const bare: Wardrobe = { look: defaultLook(), owned: new Set() };
    const tone = SKIN_TONES[2] ?? '#a8714b';
    expect(equip(bare, 'skin', tone).look.skin).toBe(tone);
  });
});

describe('isOwned et priceOf', () => {
  it('tient tout ce qui est gratuit pour acquis', () => {
    const bare: Wardrobe = { look: defaultLook(), owned: new Set() };
    expect(isOwned(bare, 'outfit.noir')).toBe(true);
    expect(isOwned(bare, 'outfit.dore')).toBe(false);
  });

  it('donne le prix affiche, zero pour l inconnu', () => {
    expect(priceOf('outfit.dore')).toBe(700);
    expect(priceOf('color.gold')).toBe(0);
    expect(priceOf('rien')).toBe(0);
  });
});

describe('danses equipees', () => {
  const wardrobe = (owned: readonly string[] = []): Wardrobe => ({
    look: defaultLook(),
    owned: new Set(owned),
  });

  it('demarre sans aucune danse equipee', () => {
    expect(Object.keys(defaultLook().dances)).toHaveLength(0);
  });

  /**
   * Une danse s equipe POUR UN MOUVEMENT, pas globalement.
   *
   * Le catalogue range les animations par couple style-palier, et deux
   * animations de mouvements differents ne sont pas interchangeables : le
   * Moonwalk est un calme palier 3, il ne peut pas remplacer un dab. Un seul
   * emplacement global obligerait a rejouer la meme danse quel que soit le
   * mouvement joue — ou a l ignorer, ce qui revient a ne rien vendre.
   */
  it('equipe une danse pour son seul mouvement', () => {
    const next = equipDance(wardrobe(['anim.calme.t3.moonwalk']), 'anim.calme.t3.moonwalk');
    expect(danceFor(next.look, { style: 'calme', tier: 3 })).toBe('anim.calme.t3.moonwalk');
    expect(danceFor(next.look, { style: 'calme', tier: 4 })).toBeUndefined();
    expect(danceFor(next.look, { style: 'hype', tier: 3 })).toBeUndefined();
  });

  /** Regle d or n°3 : ce qu on ne possede pas ne se porte pas. */
  it('refuse une danse qu on ne possede pas', () => {
    const next = equipDance(wardrobe(), 'anim.calme.t3.moonwalk');
    expect(danceFor(next.look, { style: 'calme', tier: 3 })).toBeUndefined();
  });

  it('accepte une danse offerte sans rien posseder', () => {
    const next = equipDance(wardrobe(), 'anim.calme.t3.meditate');
    expect(danceFor(next.look, { style: 'calme', tier: 3 })).toBe('anim.calme.t3.meditate');
  });

  it('remplace la danse du meme mouvement au lieu de l ajouter', () => {
    const owned = wardrobe(['anim.calme.t3.moonwalk']);
    const first = equipDance(owned, 'anim.calme.t3.moonwalk');
    const second = equipDance(first, 'anim.calme.t3.meditate');
    expect(danceFor(second.look, { style: 'calme', tier: 3 })).toBe('anim.calme.t3.meditate');
    expect(Object.keys(second.look.dances)).toHaveLength(1);
  });

  /** Rien ne change : on rend l objet d origine, pas une copie identique. */
  it('ignore un identifiant qui n est pas une danse du catalogue', () => {
    const before = wardrobe();
    expect(equipDance(before, 'anim.nawak')).toBe(before);
  });
});

describe('danceOptions', () => {
  const HYPE_T2 = { style: 'hype', tier: 2 } as const;

  it('propose l offerte et ce qui est possede, pas le reste', () => {
    const options = danceOptions(
      { look: defaultLook(), owned: new Set(['anim.hype.t2.floss']) },
      HYPE_T2,
    );
    const ids = options.choices.map((card) => card.animationId);
    expect(ids[0]).toBe(defaultAnimationFor(HYPE_T2));
    expect(ids).toContain('anim.hype.t2.floss');
    expect(ids.every((id) => animationIdsFor(HYPE_T2).includes(id))).toBe(true);
    expect(ids.length).toBeLessThan(animationIdsFor(HYPE_T2).length);
  });

  it('designe celle qui est equipee, ou l offerte par defaut', () => {
    const owned = new Set(['anim.hype.t2.floss']);
    expect(danceOptions({ look: defaultLook(), owned }, HYPE_T2).current).toBe(
      defaultAnimationFor(HYPE_T2),
    );
    const look = { ...defaultLook(), dances: { 'hype.t2': 'anim.hype.t2.floss' } };
    expect(danceOptions({ look, owned }, HYPE_T2).current).toBe('anim.hype.t2.floss');
  });

  it('donne la suivante en bouclant', () => {
    const owned = new Set(['anim.hype.t2.floss']);
    const first = danceOptions({ look: defaultLook(), owned }, HYPE_T2);
    expect(first.next).toBe('anim.hype.t2.floss');
    const look = { ...defaultLook(), dances: { 'hype.t2': 'anim.hype.t2.floss' } };
    expect(danceOptions({ look, owned }, HYPE_T2).next).toBe(first.current);
  });

  /*
    La roue est passee de Hype 4 a Acrobatie 2 : son ancien identifiant peut
    rester dans une presélection enregistree. Le jouer serait envoyer au
    serveur une pose qu'il refuse — le joueur perdrait sa manche.
  */
  it('ne presente jamais une pose presélectionnee qui a change de case', () => {
    const owned = new Set(['anim.hype.t4.wheel']);
    const look = { ...defaultLook(), dances: { 'hype.t4': 'anim.hype.t4.wheel' } };
    const view = danceOptions({ look, owned }, { style: 'hype', tier: 4 });
    expect(view.current).toBe('anim.hype.t4.boat');
    expect(view.choices.map((card) => card.animationId)).not.toContain('anim.hype.t4.wheel');
  });

  it('compte les danses a acheter pour ce mouvement', () => {
    const options = danceOptions({ look: defaultLook(), owned: new Set() }, HYPE_T2);
    expect(options.forSale).toBe(animationIdsFor(HYPE_T2).length - 1);
  });
});

describe('equipSignature', () => {
  const wardrobe = (owned: readonly string[] = []): Wardrobe => ({
    look: defaultLook(),
    owned: new Set(owned),
  });

  it('fait d une danse possedee la signature, et la danse de son mouvement', () => {
    const next = equipSignature(wardrobe(['anim.calme.t3.moonwalk']), 'anim.calme.t3.moonwalk');
    expect(next.look.signature).toBe('anim.calme.t3.moonwalk');
    expect(next.look.dances['calme.t3']).toBe('anim.calme.t3.moonwalk');
  });

  it('refuse une danse qu on ne possede pas', () => {
    const before = wardrobe();
    expect(equipSignature(before, 'anim.calme.t3.moonwalk')).toBe(before);
  });
});

describe('isWorn', () => {
  /*
    La couleur d'aura se porte par sa VALEUR : comparer l'identifiant au
    hexadecimal ne marquait jamais aucune couleur comme portee.
  */
  it('reconnait la couleur d aura portee', () => {
    const violet = AURA_COLORS.find((c) => c.id === 'color.violet')!;
    const look = { ...defaultLook(), aura: violet.hex };
    expect(isWorn(look, 'aura', 'color.violet')).toBe(true);
    expect(isWorn(look, 'aura', 'color.gold')).toBe(false);
  });

  it('reconnait la tenue portee', () => {
    expect(isWorn(defaultLook(), 'outfit', defaultLook().outfit)).toBe(true);
  });
});

describe('effectItems', () => {
  it('liste les huit effets, niveau et prix compris', () => {
    const items = effectItems({ look: defaultLook(), owned: new Set() });
    expect(items).toHaveLength(8);
    expect(items.find((item) => item.id === 'fx.flames')).toMatchObject({
      level: 1,
      price: 400,
      owned: false,
    });
  });

  it('tient les effets offerts pour possedes, et les achetes aussi', () => {
    const items = effectItems({ look: defaultLook(), owned: new Set(['fx.dark']) });
    expect(items.find((item) => item.id === 'fx.glow')?.owned).toBe(true);
    expect(items.find((item) => item.id === 'fx.dark')?.owned).toBe(true);
    expect(items.find((item) => item.id === 'fx.shock')?.owned).toBe(false);
  });
});

describe('ownsItem et itemInfo', () => {
  const nobody: Wardrobe = { look: defaultLook(), owned: new Set() };

  it('nomme et chiffre un article de chaque rayon', () => {
    expect(itemInfo('fx.flames')).toEqual({ name: 'Flammes', price: 400 });
    expect(itemInfo('color.violet')?.price).toBe(80);
    expect(itemInfo('anim.calme.t3.moonwalk')?.price).toBeGreaterThan(0);
    expect(itemInfo('inconnu')).toBeNull();
  });

  it('tient pour possede ce qui est offert, et seulement ca', () => {
    expect(ownsItem(nobody, 'fx.glow')).toBe(true);
    expect(ownsItem(nobody, 'fx.flames')).toBe(false);
    expect(ownsItem(nobody, defaultAnimationFor({ style: 'hype', tier: 2 }))).toBe(true);
    expect(ownsItem(nobody, 'anim.calme.t3.moonwalk')).toBe(false);
    expect(ownsItem({ ...nobody, owned: new Set(['fx.flames']) }, 'fx.flames')).toBe(true);
  });
});

/*
  Un exclusif de saison porte un prix de 0 parce qu'il ne se VEND pas, pas
  parce qu'il est offert : il n'appartient qu'a qui l'a gagne sur le passe.
*/
describe('cosmetiques exclusifs de saison', () => {
  const bare = { look: defaultLook(), owned: new Set<string>() };

  it('ne sont a personne tant qu on ne les a pas gagnes', () => {
    expect(isOwned(bare, 'outfit.aurore')).toBe(false);
    expect(isOwned(bare, 'color.aurore')).toBe(false);
    expect(isOwned({ ...bare, owned: new Set(['outfit.aurore']) }, 'outfit.aurore')).toBe(true);
    expect(ownsItem(bare, 'color.aurore')).toBe(false);
    expect(ownsItem({ ...bare, owned: new Set(['color.aurore']) }, 'color.aurore')).toBe(true);
  });

  it('ne sont jamais la tenue ni la couleur de depart', () => {
    const look = defaultLook();
    expect(look.outfit).not.toBe('outfit.aurore');
    expect(look.aura).not.toBe('#6ef0c4');
  });
});
