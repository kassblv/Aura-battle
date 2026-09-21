import { describe, expect, it } from 'vitest';
import { AURA_COLORS } from '@aura/content';
import { defaultLook, type Look } from './wardrobe.js';
import { lookFromLoadout, loadoutFromLook } from './loadout.js';

const GRATUIT = AURA_COLORS.find((c) => c.price === 0)!;
const PAYANT = AURA_COLORS.find((c) => c.price > 0)!;

const possede = (...ids: string[]): ReadonlySet<string> => new Set(ids);

describe('loadoutFromLook', () => {
  /*
    Le serveur raisonne en IDENTIFIANTS, le client en valeurs.

    `Look.aura` porte un hexadecimal, pas un identifiant : c'est ce que le
    rendu consomme. Le serveur, lui, ne peut verifier que quelqu'un possede
    une couleur que s'il en recoit l'identifiant — un hexadecimal ne se
    verifie pas, il se croit.
  */
  it('traduit la couleur d aura en identifiant', () => {
    const look: Look = { ...defaultLook(), aura: PAYANT.hex };
    expect(loadoutFromLook(look).auraColor).toBe(PAYANT.id);
  });

  it('transmet les emplacements qui sont deja des identifiants', () => {
    const look: Look = {
      ...defaultLook(),
      outfit: 'outfit.blanc',
      hair: 'hair.capuche',
      auraEffect: 'fx.vortex',
      dances: { 'hype.t2': 'anim.hype.t2.floss' },
    };
    expect(loadoutFromLook(look)).toMatchObject({
      outfit: 'outfit.blanc',
      hair: 'hair.capuche',
      auraEffect: 'fx.vortex',
      dances: { 'hype.t2': 'anim.hype.t2.floss' },
    });
  });

  /*
    La teinte de peau n'est pas un cosmetique : elle n'a pas d'identifiant, pas
    de prix, pas de ligne au catalogue. Elle reste une preference locale, et
    l'envoyer au serveur reviendrait a lui demander de verifier la possession
    de quelque chose qui ne se possede pas.
  */
  it('n envoie pas la teinte de peau', () => {
    expect(loadoutFromLook({ ...defaultLook(), skin: '#3b2417' })).not.toHaveProperty('skin');
  });

  it('omet un emplacement vide plutot que d envoyer undefined', () => {
    const envoye = loadoutFromLook(defaultLook());
    expect(envoye).not.toHaveProperty('auraEffect');
  });
});

describe('lookFromLoadout', () => {
  /*
    LA regle de migration, et celle qui decide de ce que voit un joueur
    existant : on garde ce qu'il possede, on retombe sur les defauts pour le
    reste. Sa bourse, elle, n'a jamais rien valu — elle se creditait
    elle-meme dans son propre navigateur.
  */
  it('garde ce que le joueur possede', () => {
    const look = lookFromLoadout(
      { outfit: 'outfit.blanc', auraColor: PAYANT.id, auraEffect: 'fx.vortex' },
      possede('outfit.blanc', PAYANT.id, 'fx.vortex'),
      defaultLook(),
    );

    expect(look.outfit).toBe('outfit.blanc');
    expect(look.aura).toBe(PAYANT.hex);
    expect(look.auraEffect).toBe('fx.vortex');
  });

  it('retombe sur le defaut pour ce qu il ne possede pas', () => {
    const base = defaultLook();
    const look = lookFromLoadout({ outfit: 'outfit.blanc', auraColor: PAYANT.id }, possede(), base);

    expect(look.outfit).toBe(base.outfit);
    expect(look.aura).toBe(base.aura);
  });

  it('retombe sur le defaut pour un identifiant inconnu du catalogue', () => {
    const base = defaultLook();
    const look = lookFromLoadout(
      { auraColor: 'color.inexistante' },
      possede('color.inexistante'),
      base,
    );
    expect(look.aura).toBe(base.aura);
  });

  /*
    La teinte de peau ne vient pas du serveur : elle vient de ce que le joueur
    avait deja. La perdre serait le seul changement visible d'une migration
    qui, sinon, ne se voit pas.
  */
  it('conserve la teinte de peau locale', () => {
    const base = { ...defaultLook(), skin: '#3b2417' };
    expect(lookFromLoadout({}, possede(), base).skin).toBe('#3b2417');
  });

  it('ne garde que les danses possedees', () => {
    const look = lookFromLoadout(
      { dances: { 'hype.t2': 'anim.hype.t2.floss', 'calme.t3': 'anim.calme.t3.moonwalk' } },
      possede('anim.hype.t2.floss'),
      defaultLook(),
    );

    expect(look.dances).toEqual({ 'hype.t2': 'anim.hype.t2.floss' });
  });

  it('rend les defauts pour un equipement vide', () => {
    expect(lookFromLoadout({}, possede(), defaultLook())).toEqual(defaultLook());
  });

  /*
    L'aller-retour ne doit rien perdre : ce qui part au serveur et revient
    doit redonner la meme apparence, sinon le joueur voit son equipement
    changer tout seul entre deux chargements.
  */
  it('fait l aller-retour sans rien perdre', () => {
    const look: Look = {
      ...defaultLook(),
      outfit: 'outfit.blanc',
      hair: 'hair.capuche',
      aura: PAYANT.hex,
      auraEffect: 'fx.vortex',
      dances: { 'hype.t2': 'anim.hype.t2.floss' },
    };
    const owned = possede(
      'outfit.blanc',
      'hair.capuche',
      PAYANT.id,
      'fx.vortex',
      'anim.hype.t2.floss',
    );

    expect(lookFromLoadout(loadoutFromLook(look), owned, defaultLook())).toEqual(look);
  });

  it('accepte la couleur gratuite sans qu elle soit listee', () => {
    const look = lookFromLoadout({ auraColor: GRATUIT.id }, possede(GRATUIT.id), defaultLook());
    expect(look.aura).toBe(GRATUIT.hex);
  });
});
