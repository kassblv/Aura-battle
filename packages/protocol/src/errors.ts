import { z } from 'zod';

/** Codes d'erreur du protocole (docs/03-pvp-protocol.md). */
export const ERROR_CODES = [
  'UNAUTHORIZED',
  'CLIENT_OUTDATED',
  'NOT_IN_MATCH',
  'WRONG_PHASE',
  'DEADLINE_PASSED',
  'INVALID_PAYLOAD',
  'NOT_ENOUGH_ENERGY',
  'ULT_NOT_READY',
  'ALREADY_LOCKED',
  'COSMETIC_NOT_OWNED',
  'RATE_LIMITED',
  'INVITE_NOT_FOUND',
  'INVITE_EXPIRED',
  'ALREADY_IN_QUEUE',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const errorCodeSchema = z.enum(ERROR_CODES);
