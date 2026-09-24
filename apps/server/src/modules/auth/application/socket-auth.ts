import { isCompatibleProtocol, parseHandshake, type ErrorCode } from '@aura/protocol';

/**
 * Authentification du handshake Socket.IO (docs/03-pvp-protocol.md).
 *
 * C'est la premiere barriere du temps reel, et la seule qui s'applique avant
 * toute logique metier. Elle repond a trois questions, dans cet ordre : la
 * charge a-t-elle la bonne forme, le client parle-t-il notre version, et le
 * jeton est-il valable.
 */

/** Ce qu'un jeton d'acces contient une fois verifie. */
export interface VerifiedToken {
  readonly sub: string;
  /** Instant d'emission, en SECONDES (claim JWT `iat`), s'il est present. */
  readonly iat?: number;
}

/** Port de verification : le module decide si c'est un JWT, un stub ou autre. */
export interface AccessTokenVerifier {
  verify(token: string): Promise<VerifiedToken>;
}

export type SocketAuthResult =
  | { readonly ok: true; readonly playerId: string }
  | { readonly ok: false; readonly code: ErrorCode; readonly message: string };

const refuse = (code: ErrorCode, message: string): SocketAuthResult => ({
  ok: false,
  code,
  message,
});

export class SocketAuthenticator {
  constructor(private readonly verifier: AccessTokenVerifier) {}

  async authenticate(auth: unknown): Promise<SocketAuthResult> {
    const parsed = parseHandshake(auth);
    if (!parsed.success) {
      return refuse('INVALID_PAYLOAD', 'handshake invalide');
    }

    // La version passe avant le jeton, a dessein. Un client perime dont le
    // jeton a aussi expire doit lire « mets-toi a jour » et non
    // « reconnecte-toi » : sinon il boucle sur une reconnexion qui ne peut pas
    // aboutir.
    if (!isCompatibleProtocol(parsed.data.protocolVersion)) {
      return refuse('CLIENT_OUTDATED', 'version de protocole incompatible');
    }

    try {
      const token = await this.verifier.verify(parsed.data.token);
      if (token.sub === '') {
        return refuse('UNAUTHORIZED', 'session invalide');
      }
      return { ok: true, playerId: token.sub };
    } catch {
      // Message volontairement uniforme : il ne doit pas apprendre a un
      // attaquant si le jeton est expire, mal signe ou inexistant. Le detail
      // reste dans le journal du serveur.
      return refuse('UNAUTHORIZED', 'session invalide');
    }
  }
}
