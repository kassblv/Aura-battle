import { AURA_COLORS } from '@aura/content';
import type { LoadoutPayload } from '@aura/protocol';
import type { Look } from './wardrobe.js';

/**
 * La traduction entre ce que le serveur range et ce que le rendu consomme.
 *
 * **Le serveur raisonne en identifiants, le client en valeurs.** `Look.aura`
 * porte un hexadecimal parce que c est ce que l arene dessine ; le serveur,
 * lui, ne peut verifier qu un joueur possede une couleur que s il en recoit
 * l identifiant — un hexadecimal ne se verifie pas, il se croit.
 *
 * C est aussi ici que vit la **regle de migration** : on garde ce que le
 * joueur possede, on retombe sur les defauts pour le reste.
 */

const HEX_BY_ID = new Map(AURA_COLORS.map((color) => [color.id, color.hex]));
const ID_BY_HEX = new Map(AURA_COLORS.map((color) => [color.hex, color.id]));

/** Ce qu on envoie au serveur. Un emplacement vide est **omis**, pas indefini. */
export function loadoutFromLook(look: Look): LoadoutPayload {
  const auraColor = ID_BY_HEX.get(look.aura);
  return {
    outfit: look.outfit,
    hair: look.hair,
    ...(auraColor === undefined ? {} : { auraColor }),
    ...(look.auraEffect === undefined ? {} : { auraEffect: look.auraEffect }),
    ...(Object.keys(look.dances).length === 0 ? {} : { dances: look.dances }),
  };
  /*
    La teinte de peau n est pas un cosmetique : ni identifiant, ni prix, ni
    ligne au catalogue. Elle reste une preference locale — l envoyer
    reviendrait a demander au serveur de verifier la possession de quelque
    chose qui ne se possede pas.
  */
}

/**
 * Ce qu on affiche, a partir de ce que le serveur range.
 *
 * `owned` tranche : **on ne porte que ce qu on possede**. Le serveur applique
 * deja cette regle a l ecriture ; on la rejoue a la lecture parce qu un objet
 * peut avoir quitte le catalogue depuis, et qu un emplacement pointant sur
 * rien se dessinerait comme un trou.
 */
export function lookFromLoadout(
  loadout: LoadoutPayload,
  owned: ReadonlySet<string>,
  fallback: Look,
): Look {
  const kept = (id: string | undefined, known: (value: string) => boolean): string | undefined =>
    id !== undefined && owned.has(id) && known(id) ? id : undefined;

  const outfit = kept(loadout.outfit, () => true);
  const hair = kept(loadout.hair, () => true);
  const auraId = kept(loadout.auraColor, (id) => HEX_BY_ID.has(id));
  const auraEffect = kept(loadout.auraEffect, () => true);

  const dances: Record<string, string> = {};
  for (const [move, animation] of Object.entries(loadout.dances ?? {})) {
    if (owned.has(animation)) dances[move] = animation;
  }

  return {
    outfit: outfit ?? fallback.outfit,
    hair: hair ?? fallback.hair,
    // La teinte de peau ne vient pas du serveur : elle vient de ce que le
    // joueur avait deja. La perdre serait le seul changement visible d une
    // migration qui, sinon, ne se voit pas.
    skin: fallback.skin,
    aura: auraId === undefined ? fallback.aura : (HEX_BY_ID.get(auraId) ?? fallback.aura),
    ...(auraEffect === undefined ? {} : { auraEffect }),
    dances,
  };
}
