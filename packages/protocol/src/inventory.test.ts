import { describe, expect, it } from 'vitest';
import {
  inventoryStateSchema,
  loadoutSchema,
  parseInventoryBuyRequest,
  parseInventoryEquipRequest,
} from './inventory.js';

describe('achat', () => {
  it('accepte un identifiant d objet', () => {
    expect(parseInventoryBuyRequest({ itemId: 'color.violet' }).success).toBe(true);
  });

  it('refuse un champ inconnu', () => {
    expect(parseInventoryBuyRequest({ itemId: 'color.violet', price: 0 }).success).toBe(false);
  });

  /*
    Le prix ne vient JAMAIS du client.

    C'est la regle d'or n°1 appliquee a la boutique : un client qui annonce ce
    qu'il paie est un client qui se fixe ses prix. Le schema ferme rend l'erreur
    impossible a commettre, et ces noms-la sont ceux qu'on essaierait.
  */
  it('refuse toute tentative d annoncer un montant', () => {
    for (const champ of ['price', 'priceSoft', 'priceHard', 'cost', 'spend', 'wallet']) {
      expect(parseInventoryBuyRequest({ itemId: 'color.violet', [champ]: 0 }).success).toBe(false);
    }
  });

  it('refuse un identifiant vide ou demesure', () => {
    expect(parseInventoryBuyRequest({ itemId: '' }).success).toBe(false);
    expect(parseInventoryBuyRequest({ itemId: 'x'.repeat(200) }).success).toBe(false);
  });
});

describe('equipement', () => {
  it('accepte un equipement partiel', () => {
    expect(parseInventoryEquipRequest({ auraEffect: 'fx.galaxy' }).success).toBe(true);
  });

  /* Vide veut dire « retour aux defauts », et c'est une demande legitime. */
  it('accepte un equipement vide', () => {
    expect(parseInventoryEquipRequest({}).success).toBe(true);
  });

  it('accepte les danses par mouvement', () => {
    expect(
      parseInventoryEquipRequest({ dances: { 'hype.t2': 'anim.hype.t2.floss' } }).success,
    ).toBe(true);
  });

  /*
    La danse signature : celle que le joueur rejoue quand il gagne, et que
    l'adversaire voit. Un identifiant de contenu, rien de plus — la possession
    se verifie cote serveur.
  */
  it('accepte une danse signature', () => {
    expect(parseInventoryEquipRequest({ signature: 'anim.hype.t2.floss' }).success).toBe(true);
  });

  it('refuse une signature qui n est pas un identifiant borne', () => {
    expect(parseInventoryEquipRequest({ signature: '' }).success).toBe(false);
    expect(parseInventoryEquipRequest({ signature: 'x'.repeat(65) }).success).toBe(false);
  });

  it('refuse un emplacement inconnu', () => {
    expect(parseInventoryEquipRequest({ arme: 'epee.legendaire' }).success).toBe(false);
  });

  /*
    Une table de danses sans borne est une table ou l'on peut ranger dix mille
    cles. Le protocole borne un message : celui-ci n'y echappe pas.
  */
  it('borne le nombre de danses equipees', () => {
    const trop = Object.fromEntries(
      Array.from({ length: 200 }, (_, i) => [`s${String(i)}.t1`, 'anim.x']),
    );
    expect(parseInventoryEquipRequest({ dances: trop }).success).toBe(false);
  });
});

describe('etat de l inventaire', () => {
  const etat = {
    wallet: { soft: 120, hard: 0 },
    owned: ['color.gold', 'fx.glow'],
    loadout: { auraColor: 'color.gold' },
  };

  it('decrit ce que le serveur renvoie', () => {
    expect(inventoryStateSchema.safeParse(etat).success).toBe(true);
  });

  it('accepte un loadout vide', () => {
    expect(inventoryStateSchema.safeParse({ ...etat, loadout: {} }).success).toBe(true);
  });

  it('refuse une bourse negative', () => {
    expect(inventoryStateSchema.safeParse({ ...etat, wallet: { soft: -1, hard: 0 } }).success).toBe(
      false,
    );
  });

  it('le loadout est le meme schema des deux cotes', () => {
    expect(loadoutSchema.safeParse({ auraEffect: 'fx.vortex' }).success).toBe(true);
    expect(loadoutSchema.safeParse({ arme: 'x' }).success).toBe(false);
  });
});
