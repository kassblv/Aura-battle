import { z } from 'zod';
import { parseFailure, toParseResult, type ParseResult } from './primitives.js';

/**
 * Charge d'authentification du handshake Socket.IO (docs/03-pvp-protocol.md).
 *
 * C'est le seul point d'entree qui porte le JWT, et donc le seul dont un abus
 * precede toute verification metier. Il merite un schema comme les autres : un
 * jeton demesure consomme de la memoire avant meme d'etre lu, et un champ
 * surnumeraire trahit un client qui n'est pas celui qu'on croit.
 */
export const handshakeAuthSchema = z.strictObject({
  /** JWT d'acces. 4096 octets couvrent tres largement un jeton signe. */
  token: z.string().min(1).max(4_096),
  protocolVersion: z.string().min(1).max(16),
});

export type HandshakeAuth = z.infer<typeof handshakeAuthSchema>;

export function parseHandshake(payload: unknown): ParseResult<HandshakeAuth> {
  const parsed = handshakeAuthSchema.safeParse(payload);
  return parsed.success ? toParseResult(parsed) : parseFailure(parsed.error);
}
