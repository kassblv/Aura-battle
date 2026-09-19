/**
 * Version du protocole, en semver.
 *
 * Une difference de version **majeure** est incompatible : le serveur repond
 * `CLIENT_OUTDATED` et le client affiche un ecran de mise a jour. Une
 * difference mineure ou corrective reste compatible — un champ ajoute ne casse
 * pas un client qui l'ignore.
 */
export const PROTOCOL_VERSION = '1.0.0';

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
