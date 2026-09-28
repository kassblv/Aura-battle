/**
 * La recharge au clavier, pour qui joue sur ordinateur.
 *
 * Viser une orbe mobile a la souris est bien plus dur qu au doigt : sur
 * ordinateur, chaque orbe porte une touche, et on l attrape en la frappant.
 * Le serveur n en sait rien — un tap ne transporte qu un rang d orbe et un
 * instant — donc rien ne change dans le moteur ni dans le protocole.
 *
 * L equite avec le tactile tient en trois choix :
 *
 * - **Six touches**, celles de la rangee de repos communes a l AZERTY et au
 *   QWERTY (`event.key` y rend la meme lettre). Il faut lire avant de frapper.
 * - **La touche vient de la position** de l orbe, tiree de la graine de la
 *   manche, jamais de son rang : les rangs valent 0, 1, 2… a chaque manche,
 *   et une suite derivee d eux s apprendrait par coeur.
 * - **Une touche de la reserve qui ne vise rien est un tap dans le vide** :
 *   elle casse le combo. Frapper les six touches au hasard ne paie pas.
 */

export const ORB_KEYS = ['s', 'd', 'f', 'j', 'k', 'l'] as const;
export type OrbKey = (typeof ORB_KEYS)[number];

const isOrbKey = (key: string): key is OrbKey => (ORB_KEYS as readonly string[]).includes(key);

/**
 * Touche d une orbe qui apparait, differente de celles deja affichees.
 *
 * `taken` ne contient jamais les six touches : il y a au plus trois orbes a
 * l ecran, donc la boucle trouve toujours une touche libre.
 */
export function orbKey(
  orb: { readonly x: number; readonly y: number },
  taken: ReadonlySet<string>,
): OrbKey {
  // Deux grands nombres premiers melangent les deux coordonnees : des orbes
  // voisines ne recoivent pas des touches voisines.
  const mixed = Math.floor(orb.x * 9_973 + orb.y * 7_919);
  const start = ((mixed % ORB_KEYS.length) + ORB_KEYS.length) % ORB_KEYS.length;
  for (let step = 0; step < ORB_KEYS.length; step += 1) {
    const key = ORB_KEYS[(start + step) % ORB_KEYS.length]!;
    if (!taken.has(key)) return key;
  }
  return ORB_KEYS[start]!;
}

/**
 * Ce que vise une touche frappee.
 *
 * @returns l orbe visee, `{ orbIndex: null }` pour un tap dans le vide, ou
 *   `null` si la touche ne joue pas du tout (hors reserve).
 */
export function pressedOrb(
  key: string,
  slotKeys: readonly (string | null)[],
  slotOrbs: readonly (number | null | undefined)[],
): { readonly orbIndex: number | null } | null {
  const pressed = key.toLowerCase();
  if (!isOrbKey(pressed)) return null;
  for (let slot = 0; slot < slotKeys.length; slot += 1) {
    const orbIndex = slotOrbs[slot];
    if (slotKeys[slot] === pressed && orbIndex !== null && orbIndex !== undefined) {
      return { orbIndex };
    }
  }
  return { orbIndex: null };
}
