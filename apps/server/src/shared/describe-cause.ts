/**
 * Resume d'une erreur, sans rien recopier de ce qu'on etait en train de faire.
 *
 * Une `PrismaClientValidationError` reproduit les arguments refuses dans son
 * message **et** dans sa pile : journaliser l'un ou l'autre tel quel publierait
 * la graine d'un match et son journal d'evenements en clair. On ne garde que le
 * nom et la premiere ligne, tronquee — le detail d'une erreur ne vaut pas cette
 * fuite.
 *
 * Le code d'erreur passe en revanche entier. Les messages de Prisma commencent
 * par un saut de ligne : s'en tenir a la premiere ligne les reduit a une chaine
 * vide, et le journal ne dirait plus rien de la panne. `P2002` (unicite) ou
 * `P2003` (cle etrangere) nomment la cause exactement, et sont des constantes
 * du client — ils ne peuvent rien recopier du match.
 *
 * **Ce module est partage, et c'est le point.** La meme regle vaut pour la file
 * d'attente, l'ouverture d'un match ou la passerelle : partout ou l'on ecrit
 * `${String(cause)}` dans un journal, on recopie un message ecrit par une
 * bibliotheque a partir de nos propres donnees. Une seconde version de cette
 * fonction, c'est une seconde occasion de l'ecrire un peu moins prudemment.
 */

/** Longueur maximale de la cause recopiee dans un journal d'erreur. */
export const MAX_CAUSE_CHARS = 200;

export function describeCause(error: unknown): string {
  if (!(error instanceof Error)) return 'cause inconnue';
  const code = 'code' in error && typeof error.code === 'string' ? ` [${error.code}]` : '';
  const firstLine = error.message.split('\n', 1)[0] ?? '';
  return `${error.name}${code}: ${firstLine.slice(0, MAX_CAUSE_CHARS)}`;
}
