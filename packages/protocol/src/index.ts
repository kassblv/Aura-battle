/**
 * @aura/protocol — schemas zod des messages client<->serveur.
 *
 * Source de verite unique : le serveur valide l'entrant ET le sortant avec ces
 * schemas, le client en infere ses types. Un message qui n'est pas decrit ici
 * n'existe pas.
 *
 * Contenu reel au jalon M2 (docs/03-pvp-protocol.md).
 */

/**
 * Version du protocole. A incrementer des qu'un message change de forme.
 * Le client l'envoie au handshake ; le serveur refuse les versions incompatibles.
 */
export const PROTOCOL_VERSION = 1;
