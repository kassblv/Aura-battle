import { z } from 'zod';
import { parseFailure, toParseResult, type ParseResult } from './primitives.js';

/**
 * Contrat de l'inventaire : ce qu'on possede, ce qu'on achete, ce qu'on porte.
 *
 * En **HTTP** et non par la socket : la boutique et le vestiaire s'utilisent
 * hors match, et forcer une connexion temps reel pour essayer une tenue serait
 * absurde. `docs/03` decrit le protocole temps reel ; un achat n'en est pas.
 */

/** Identifiant de cosmetique, borne comme tout ce qui entre. */
const itemIdSchema = z.string().min(1).max(64);

/**
 * L'achat ne porte QUE l'objet.
 *
 * **Regle d'or n°1 appliquee a la boutique** : le prix ne vient jamais du
 * client. Un client qui annonce ce qu'il paie est un client qui fixe ses prix.
 * Le schema ferme rend l'erreur impossible a commettre plus tard, meme par
 * distraction — il n'y a aucun champ ou glisser un montant.
 */
export const inventoryBuyRequestSchema = z.strictObject({
  itemId: itemIdSchema,
  /**
   * La monnaie choisie (2.2.0) : pieces (`soft`) ou jetons (`hard`).
   *
   * Une MONNAIE, pas un montant : le prix dans chacune reste celui du
   * catalogue du serveur. Absent, le serveur paie en pieces et ne prend des
   * jetons que si les pieces manquent (comportement 2.1).
   */
  currency: z.enum(['soft', 'hard']).optional(),
});

/**
 * Ce que le joueur porte. Tout est facultatif, et vide veut dire « defauts ».
 *
 * La table des danses est **bornee** : sans plafond, c'est un endroit ou ranger
 * dix mille cles. Le protocole borne un message, celui-ci n'y echappe pas.
 */
export const loadoutSchema = z.strictObject({
  outfit: itemIdSchema.optional(),
  hair: itemIdSchema.optional(),
  auraColor: itemIdSchema.optional(),
  auraEffect: itemIdSchema.optional(),
  dances: z
    .record(z.string().min(1).max(32), itemIdSchema)
    .refine((table) => Object.keys(table).length <= 64, 'trop de danses equipees')
    .optional(),
  /**
   * La danse signature, jouee a la victoire et vue par l adversaire.
   *
   * Un emplacement a part, pas une entree de `dances` : elle ne depend d aucun
   * mouvement — on la rejoue quand on gagne, quel que soit le coup qui a gagne.
   */
  signature: itemIdSchema.optional(),
});

export const inventoryStateSchema = z.strictObject({
  wallet: z.strictObject({
    soft: z.number().int().min(0),
    hard: z.number().int().min(0),
  }),
  owned: z.array(itemIdSchema).max(2_000),
  loadout: loadoutSchema,
});

export type InventoryBuyRequest = z.infer<typeof inventoryBuyRequestSchema>;
export type LoadoutPayload = z.infer<typeof loadoutSchema>;
export type InventoryState = z.infer<typeof inventoryStateSchema>;

export function parseInventoryBuyRequest(payload: unknown): ParseResult<InventoryBuyRequest> {
  const parsed = inventoryBuyRequestSchema.safeParse(payload);
  return parsed.success ? toParseResult(parsed) : parseFailure(parsed.error);
}

export function parseInventoryEquipRequest(payload: unknown): ParseResult<LoadoutPayload> {
  const parsed = loadoutSchema.safeParse(payload);
  return parsed.success ? toParseResult(parsed) : parseFailure(parsed.error);
}
