/**
 * Version du protocole, en semver.
 *
 * Une difference de version **majeure** est incompatible : le serveur repond
 * `CLIENT_OUTDATED` et le client affiche un ecran de mise a jour. Une
 * difference mineure ou corrective reste compatible — un champ ajoute ne casse
 * pas un client qui l'ignore.
 */
/*
  1.1.0 — `choice:lock` a PERDU son champ `cosmetic`.

  Retirer un champ d'un `strictObject` est en theorie une rupture : un client
  qui l'envoyait serait desormais refuse. Aucun ne l'envoyait — il etait
  facultatif et le client n'a jamais rempli ce champ — donc personne ne casse.
  Passer en 2.0.0 aurait renvoye tous les joueurs sur un ecran de mise a jour
  pour un champ que pas un seul message ne portait.
*/
/*
  1.2.0 — `match:end.rewards` porte `xpTotal`.

  Un champ AJOUTE : un client qui l'ignore continue de fonctionner, donc pas
  de rupture majeure.
*/
/*
  1.3.0 — la danse signature.

  `loadout.signature` et `opponent.cosmetics.signature` sont AJOUTES, et
  facultatifs : un client 1.2 les ignore et joue la victoire du systeme, un
  serveur 1.2 ne les envoie pas et le client retombe sur la meme. Pas de
  rupture majeure.
*/
export const PROTOCOL_VERSION = '1.3.0';

const MAJOR = /^(\d+)\./;

/** Extrait la version majeure, ou `null` si la chaine n'est pas un semver. */
export function majorOf(version: string): number | null {
  const match = MAJOR.exec(version);
  return match?.[1] === undefined ? null : Number.parseInt(match[1], 10);
}

/** Un client est compatible si sa version majeure est celle du serveur. */
export function isCompatibleProtocol(clientVersion: string): boolean {
  const client = majorOf(clientVersion);
  return client !== null && client === majorOf(PROTOCOL_VERSION);
}
