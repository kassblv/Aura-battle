import { Prisma } from '@prisma/client';
import type { AdminAuditEntry } from './admin-audit.js';

/** Ce qu'il faut d'un client Prisma pour ecrire le journal : le client lui-meme, ou une transaction. */
type AuditWriter = Pick<Prisma.TransactionClient, 'adminAction'>;

/**
 * `null` en JSON Prisma : « pas de valeur » (`DbNull`), distinct de la valeur
 * JSON `null`. Le reste passe par un aller-retour JSON : ce que le journal
 * garde est exactement ce qu'on relira, sans `undefined` ni `Date` vivante.
 */
const jsonOf = (value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull => {
  if (value === null || value === undefined) return Prisma.DbNull;
  const parsed: unknown = JSON.parse(JSON.stringify(value));
  return parsed as Prisma.InputJsonValue;
};

/**
 * Inscrit une ligne du journal d'administration.
 *
 * A appeler avec le client de la TRANSACTION qui porte l'ecriture : c'est ce qui
 * fait qu'une ecriture sans journal n'a pas lieu, et qu'un journal sans
 * ecriture n'existe pas.
 */
export async function writeAdminAction(tx: AuditWriter, entry: AdminAuditEntry): Promise<void> {
  await tx.adminAction.create({
    data: {
      at: new Date(entry.atMs),
      action: entry.action,
      target: entry.target,
      before: jsonOf(entry.before),
      after: jsonOf(entry.after),
      reason: entry.reason,
    },
  });
}
