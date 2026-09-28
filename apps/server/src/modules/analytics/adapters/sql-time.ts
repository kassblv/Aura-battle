import { Prisma } from '@prisma/client';

/**
 * Un instant serveur (ms depuis l'epoque), en `timestamp` UTC pour Postgres.
 *
 * Les colonnes de date du schema sont des `timestamp without time zone` qui
 * portent de l'UTC (Prisma les ecrit ainsi). Un `Date` passe tel quel a une
 * requete brute part avec un fuseau, que Postgres convertit selon le fuseau de
 * la SESSION : le resultat dependrait du reglage du serveur de base. On
 * convertit donc explicitement, en UTC, quel que soit ce reglage.
 */
export function utcTimestamp(ms: number): Prisma.Sql {
  return Prisma.sql`(to_timestamp(${ms / 1_000}::double precision) AT TIME ZONE 'UTC')`;
}
