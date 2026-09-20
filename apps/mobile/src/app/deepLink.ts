/**
 * Les liens d'invitation.
 *
 * Dicter six caracteres a quelqu'un marche, mais ne se partage pas : un lien
 * se colle dans une conversation, et c'est ainsi qu'un duel se propose vraiment
 * (`docs/05`, § « Invitations »).
 *
 * La lecture est pure et vit ici plutot que dans un composant, parce qu'elle
 * est aussi la porte d'entree d'un lien venu de l'exterieur. Un lien trafique
 * ne doit pas devenir un message que le serveur devra refuser : le format est
 * donc verifie au moment de la lecture, avec le meme motif que le protocole.
 */

/** Le chemin reconnu, partage avec ce qui fabriquera les liens. */
export const INVITE_PATH = '/duel/';

/** Meme format que `invite:join` dans `@aura/protocol`. */
const CODE = /^[A-Z0-9]{4,16}$/;

/**
 * Le code d'invitation porte par une adresse, ou `null`.
 *
 * Tolerant sur la forme, strict sur le fond : un lien se recopie a la main, se
 * colle depuis une conversation, se tape au clavier. Pardonner la casse et une
 * barre finale evite d'envoyer le joueur sur un ecran vide pour une raison
 * qu'il ne verra jamais — mais un code mal forme reste refuse.
 */
export function inviteFromUrl(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href.trim());
  } catch {
    return null;
  }

  if (!url.pathname.startsWith(INVITE_PATH)) return null;

  const code = url.pathname.slice(INVITE_PATH.length).replace(/\/+$/, '').toUpperCase();
  return CODE.test(code) ? code : null;
}
