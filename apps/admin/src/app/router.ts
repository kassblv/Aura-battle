/**
 * Routage par le hash : `#/joueurs/abc`.
 *
 * L'application est servie sous `/admin/`, a cote des routes d'API
 * `/admin/players`, `/admin/events`… Un routage par chemin ferait de
 * `/admin/players` a la fois une page et une route d'API. Le hash ne quitte
 * jamais le navigateur : aucune collision possible.
 */

export type Route =
  | { readonly name: 'dashboard' }
  | { readonly name: 'experiments' }
  | { readonly name: 'events' }
  | { readonly name: 'players' }
  | { readonly name: 'player'; readonly id: string }
  | { readonly name: 'audit' }
  | { readonly name: 'unknown' };

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, '').replace(/\/+$/, '');
  const [, first = '', second, ...rest] = path.split('/');
  if (rest.length > 0) return { name: 'unknown' };
  if (second === undefined) {
    switch (first) {
      case '':
        return { name: 'dashboard' };
      case 'experiences':
        return { name: 'experiments' };
      case 'evenements':
        return { name: 'events' };
      case 'joueurs':
        return { name: 'players' };
      case 'journal':
        return { name: 'audit' };
      default:
        return { name: 'unknown' };
    }
  }
  if (first === 'joueurs' && second !== '') {
    try {
      return { name: 'player', id: decodeURIComponent(second) };
    } catch {
      return { name: 'unknown' };
    }
  }
  return { name: 'unknown' };
}

export const href = {
  dashboard: '#/',
  experiments: '#/experiences',
  events: '#/evenements',
  players: '#/joueurs',
  player: (id: string) => `#/joueurs/${encodeURIComponent(id)}`,
  audit: '#/journal',
} as const;

/** L'onglet de navigation actif pour une route (une fiche joueur allume « Joueurs »). */
export function sectionOf(route: Route): Route['name'] {
  return route.name === 'player' ? 'players' : route.name;
}
