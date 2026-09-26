import { AURA_COLORS, AURA_EFFECTS, HAIRSTYLES, OUTFITS } from '@aura/content';
import { describe, expect, it } from 'vitest';
import { memeGallery } from './memes.js';
import { shopSections } from './shop.js';
import { tryOn } from './tryOn.js';
import { defaultLook } from './wardrobe.js';

const base = defaultLook();
const MEME = 'anim.hype.t0.dab';

describe('tryOn', () => {
  it('ne change rien quand on n essaie rien', () => {
    const shown = tryOn(base, MEME, null);
    expect(shown.look).toEqual(base);
    expect(shown.animationId).toBe(MEME);
  });

  it('enfile une tenue sans toucher au reste', () => {
    const tenue = OUTFITS.find((outfit) => outfit.price > 0)!;
    const shown = tryOn(base, MEME, tenue.id);
    expect(shown.look).toEqual({ ...base, outfit: tenue.id });
    expect(shown.animationId).toBe(MEME);
  });

  it('essaie une coiffure', () => {
    const coiffure = HAIRSTYLES.find((hair) => hair.price > 0)!;
    expect(tryOn(base, MEME, coiffure.id).look.hair).toBe(coiffure.id);
  });

  /**
   * La couleur d aura se porte par sa VALEUR, pas par son identifiant : le rig
   * attend un hexadecimal, et le catalogue en est la seule source. Montrer
   * `color.violet` au lieu de `#b36bff` repeindrait le personnage en noir.
   */
  it('essaie une couleur d aura par sa valeur', () => {
    const couleur = AURA_COLORS.find((color) => color.price > 0)!;
    expect(tryOn(base, MEME, couleur.id).look.aura).toBe(couleur.hex);
  });

  /**
   * Essayer une danse, c est la JOUER. Une vignette ne montre pas un
   * mouvement, et c est tout ce qu on achete ici.
   */
  it('joue la danse qu on essaie', () => {
    const danse = memeGallery().find((card) => !card.free)!;
    const shown = tryOn(base, MEME, danse.animationId);
    expect(shown.animationId).toBe(danse.animationId);
    expect(shown.look).toEqual(base);
  });

  /** Un identifiant inconnu ne doit rien casser : on montre ce qu on portait. */
  it('ignore un identifiant inconnu', () => {
    const shown = tryOn(base, MEME, 'objet.inexistant');
    expect(shown.look).toEqual(base);
    expect(shown.animationId).toBe(MEME);
  });

  /**
   * L essayage ne modifie jamais ce qu on porte vraiment.
   *
   * C est la seule chose qui distingue « essayer » d « equiper » : reposer
   * l article doit rendre le joueur a son apparence, sans qu il ait rien a
   * annuler.
   */
  it('laisse l apparence d origine intacte', () => {
    const avant = { ...base };
    tryOn(base, MEME, OUTFITS.find((outfit) => outfit.price > 0)!.id);
    expect(base).toEqual(avant);
  });

  it('essaie tout ce que la boutique vend', () => {
    const shown = (id: string) => tryOn(base, MEME, id);
    for (const outfit of OUTFITS.filter((o) => o.price > 0)) {
      expect(shown(outfit.id).look.outfit).toBe(outfit.id);
    }
    for (const hair of HAIRSTYLES.filter((h) => h.price > 0)) {
      expect(shown(hair.id).look.hair).toBe(hair.id);
    }
    for (const color of AURA_COLORS.filter((c) => c.price > 0)) {
      expect(shown(color.id).look.aura).toBe(color.hex);
    }
    for (const dance of memeGallery().filter((card) => !card.free)) {
      expect(shown(dance.animationId).animationId).toBe(dance.animationId);
    }
    for (const effect of AURA_EFFECTS.filter((e) => e.price > 0)) {
      expect(shown(effect.id).look.auraEffect).toBe(effect.id);
    }
  });

  /*
    La liste ci-dessus etait tenue a la main, et elle avait oublie les effets
    d'aura : la boutique affichait « touche pour essayer » sur Flammes, et le
    personnage ne changeait pas. Celle-ci part de ce que la boutique affiche
    vraiment — un article ajoute demain y entre tout seul.
  */
  it('change quelque chose a l ecran pour chaque article de la boutique', () => {
    for (const section of shopSections(0)) {
      for (const item of section.items) {
        const shown = tryOn(base, MEME, item.id);
        const changed =
          shown.animationId !== MEME || JSON.stringify(shown.look) !== JSON.stringify(base);
        expect(changed, item.id).toBe(true);
      }
    }
  });
});
