import { STYLES, TIERS } from '@aura/content';
import { describe, expect, it } from 'vitest';
import { ANIMATIONS } from '../content/animations.js';
import { memeGallery, stepMeme } from './memes.js';

const gallery = memeGallery();

describe('memeGallery', () => {
  /**
   * Une aura battle, c est deux personnes qui rejouent des memes. Le catalogue
   * de memes EST le catalogue de mouvements : s il en manque un ici, le joueur
   * possede une danse qu il ne peut jamais voir.
   */
  it('montre tous les memes du catalogue, et rien d autre', () => {
    const expected = [...ANIMATIONS.keys()].filter((id) => !id.startsWith('anim.system.'));
    expect(gallery.map((card) => card.animationId).sort()).toEqual(expected.sort());
  });

  it('exclut les poses systeme, qui ne sont pas des memes', () => {
    expect(gallery.every((card) => !card.animationId.startsWith('anim.system.'))).toBe(true);
  });

  it('nomme chaque meme', () => {
    for (const card of gallery) {
      expect(card.name).not.toBe('');
    }
  });

  /**
   * L ordre est celui dans lequel on progresse : par style, puis par palier.
   * Parcourir la galerie doit raconter la montee en puissance, pas l ordre
   * alphabetique des fichiers.
   */
  it('range par style puis par palier croissant', () => {
    const rank = (card: (typeof gallery)[number]): number =>
      STYLES.indexOf(card.style) * 100 + card.tier;
    const ranks = gallery.map(rank);
    expect([...ranks].sort((x, y) => x - y)).toEqual(ranks);
  });

  it('couvre chaque couple style-palier', () => {
    for (const style of STYLES) {
      for (const tier of TIERS) {
        const found = gallery.filter((card) => card.style === style && card.tier === tier);
        expect(found.length).toBeGreaterThan(0);
      }
    }
  });

  /**
   * Le premier meme d un palier est celui qui est offert.
   *
   * C est la regle du catalogue (`docs/01` §2) : la premiere animation de
   * chaque case est offerte, les autres sont des cosmetiques. La galerie doit
   * le dire, sinon le joueur croit posseder ce qu il ne possede pas.
   */
  it('marque comme offert exactement un meme par couple style-palier', () => {
    for (const style of STYLES) {
      for (const tier of TIERS) {
        const free = gallery.filter(
          (card) => card.style === style && card.tier === tier && card.free,
        );
        expect(free).toHaveLength(1);
      }
    }
  });
});

describe('stepMeme', () => {
  it('avance au suivant', () => {
    const first = gallery[0]!.animationId;
    expect(stepMeme(gallery, first, 1)).toBe(gallery[1]!.animationId);
  });

  it('recule au precedent', () => {
    expect(stepMeme(gallery, gallery[1]!.animationId, -1)).toBe(gallery[0]!.animationId);
  });

  /**
   * La galerie boucle. En paysage, sans defilement, le joueur parcourt au
   * pouce : buter sur une extremite l obligerait a revenir sur ses pas pour
   * atteindre le meme d a cote.
   */
  it('boucle aux deux extremites', () => {
    const last = gallery[gallery.length - 1]!.animationId;
    expect(stepMeme(gallery, last, 1)).toBe(gallery[0]!.animationId);
    expect(stepMeme(gallery, gallery[0]!.animationId, -1)).toBe(last);
  });

  /** Un identifiant inconnu ne doit pas bloquer la navigation. */
  it('repart du debut depuis un meme inconnu', () => {
    expect(stepMeme(gallery, 'anim.inexistant', 1)).toBe(gallery[0]!.animationId);
  });
});
