import { describe, expect, it } from 'vitest';
import { panelViewOffset } from './panelOffset.js';

describe('panelViewOffset', () => {
  /*
    Un panneau lateral ne doit pas couvrir ce qu il sert a regarder.

    En boutique et au vestiaire, la moitie gauche de l ecran n est PAS perdue :
    c est la que le personnage porte ce qu on essaie. Elargir le panneau
    cacherait donc exactement ce qu on vient voir — a moins de recentrer le
    sujet dans ce qui reste.

    `setViewOffset` de Three.js decale la PROJECTION, pas la camera : le sujet
    se deplace dans le cadre sans que l angle, la distance ni le cadrage
    changent. Ce que le realisateur a compose reste compose.
  */
  it('ne decale rien sans panneau', () => {
    expect(panelViewOffset(844, 390, 0)).toBeNull();
  });

  it('decale de la moitie du panneau', () => {
    // Le sujet etait au centre (422) ; il doit finir au centre des 504 px
    // libres (252), soit 170 px plus a gauche — la moitie du panneau.
    expect(panelViewOffset(844, 390, 340)).toEqual({
      fullWidth: 844,
      fullHeight: 390,
      x: 170,
      y: 0,
      width: 844,
      height: 390,
    });
  });

  /*
    Un panneau qui prendrait tout l ecran ne laisse rien a recentrer : on
    renonce plutot que de pousser le sujet hors du cadre.
  */
  it('renonce quand le panneau ne laisse plus de place', () => {
    expect(panelViewOffset(844, 390, 844)).toBeNull();
    expect(panelViewOffset(844, 390, 900)).toBeNull();
  });

  it('renonce sur une taille absurde', () => {
    expect(panelViewOffset(0, 390, 100)).toBeNull();
    expect(panelViewOffset(844, 0, 100)).toBeNull();
  });

  it('ignore une largeur negative', () => {
    expect(panelViewOffset(844, 390, -50)).toBeNull();
  });

  /*
    Le sujet doit rester CONFORTABLEMENT dans la zone libre : au-dela des
    deux tiers de l ecran, ce qui reste est trop etroit pour qu un personnage
    s y lise, et le decaler ne ferait que le comprimer contre le bord.
  */
  it('renonce quand la zone libre devient trop etroite', () => {
    expect(panelViewOffset(844, 390, 700)).toBeNull();
    expect(panelViewOffset(844, 390, 500)).not.toBeNull();
  });
});
