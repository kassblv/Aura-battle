/**
 * La vitrine ouverte sur une pose donnee, en developpement seulement :
 * `?pose=anim.prouesse.t0.flex`. C'est la visionneuse de l'ecriture de
 * contenu (skill `add-dance`) : on regarde une pose sans avoir a la posseder
 * ni a faire defiler la galerie. En production, l'adresse n'est pas lue.
 */
export function devPoseFrom(search: string, dev: boolean): string | null {
  if (!dev) return null;
  const pose = new URLSearchParams(search).get('pose');
  return pose === null || pose === '' ? null : pose;
}
