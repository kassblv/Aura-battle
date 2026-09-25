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
/*
  2.0.0 — le choix designe une POSE, et les familles passent de trois a cinq.

  `choice:lock.move` est remplace par `poseId`. Un client 1.x enverrait un champ
  que le serveur refuse : il est renvoye sur l'ecran de mise a jour des la
  connexion (`CLIENT_OUTDATED`) plutot que de perdre chaque verrouillage en
  silence.
*/
/*
  2.1.0 — la carte brillante.

  `choice:start.shiny` (la case du destinataire seulement) et
  `round:result.sides.*.shiny` sont AJOUTES et facultatifs : un client 2.0 les
  ignore, un serveur 2.0 ne les envoie pas et le client lit « pas de
  brillante ». Pas de rupture majeure.
*/
/*
  2.2.0 — la monnaie choisie a l'achat.

  `inventoryBuyRequest.currency` est AJOUTE et facultatif : un client 2.1 ne
  l'envoie pas et garde le comportement d'avant (pieces d'abord). Pas de
  rupture majeure.
*/
/*
  2.3.0 — le passe de saison.

  Routes HTTP AJOUTEES (`GET /season`, `POST /season/claim`,
  `POST /season/premium`) : un client 2.2 ne les appelle pas. Pas de rupture.
*/
/*
  2.4.0 — la variante de regles de la semaine.

  `match:found.rulesVariant` est AJOUTE et facultatif : un client 2.3 l'ignore
  et joue la partie rapide avec les couts normaux a l'ecran — le serveur, lui,
  fait autorite sur le score. Pas de rupture majeure.
*/
export const PROTOCOL_VERSION = '2.4.0';

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
