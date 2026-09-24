import {
  animationIdsFor,
  defaultAnimationFor,
  loadAnimation,
  systemAnimationId,
  type Animation,
  type Move,
} from '@aura/content';

/**
 * Les animations, embarquees dans le client.
 *
 * `@aura/content` decrit le catalogue et valide un document ; les fichiers,
 * eux, sont de la donnee du paquet. On les agrege ici plutot que dans le
 * paquet parce que `import.meta.glob` est une construction de Vite : le serveur
 * consomme le meme paquet en Node, ou elle n existe pas.
 *
 * Chargement immediat, pas a la demande : les 26 fichiers pesent quelques
 * dizaines de kilo-octets, et aller chercher une animation au moment de la
 * revelation ferait attendre l ecran que le joueur regarde le plus.
 */
const files = import.meta.glob<{ default: unknown }>(
  '../../../../packages/content/animations/*/*.json',
  {
    eager: true,
  },
);

function loadAll(): ReadonlyMap<string, Animation> {
  const byId = new Map<string, Animation>();
  for (const module of Object.values(files)) {
    const animation = loadAnimation(module.default);
    byId.set(animation.id, animation);
  }
  return byId;
}

export const ANIMATIONS: ReadonlyMap<string, Animation> = loadAll();

function require(id: string): Animation {
  const animation = ANIMATIONS.get(id);
  if (animation === undefined) {
    throw new Error(`animation ${id} absente du client`);
  }
  return animation;
}

/**
 * L animation a jouer pour un mouvement.
 *
 * `skinId` est le cosmetique equipe. Deux garde-fous : un identifiant inconnu
 * retombe sur l animation offerte — un cosmetique absent ne doit jamais faire
 * echouer une manche — et un skin qui appartient a un autre mouvement est
 * ignore, parce qu il mentirait sur ce que l adversaire vient de depenser.
 */
export function animationFor(move: Move, skinId?: string): Animation {
  if (skinId !== undefined && animationIdsFor(move).includes(skinId)) {
    const skin = ANIMATIONS.get(skinId);
    if (skin !== undefined) return skin;
  }
  return require(defaultAnimationFor(move));
}

/**
 * Poses hors mouvement : recharge, encaissement, victoire, defaite.
 *
 * Prend le slug du catalogue (`charge`, `victory`…), pas l identifiant complet :
 * c est sous cette forme que `SYSTEM_ANIMATIONS` les nomme.
 */
export function systemAnimation(slug: string): Animation {
  return require(systemAnimationId(slug));
}

/**
 * Ce que danse un vainqueur : sa signature, ou la pose de victoire du jeu.
 *
 * La signature est un cosmetique annonce par le serveur (ou le vestiaire, pour
 * soi-meme) ; ce client doit encore savoir la jouer. Une animation inconnue,
 * ou une animation systeme glissee a sa place, retombe sur la victoire : une
 * fin de manche ne doit jamais rester sans pose.
 */
export function victoryAnimation(signatureId?: string): Animation {
  if (signatureId !== undefined) {
    const dance = ANIMATIONS.get(signatureId);
    if (dance !== undefined && dance.move.style !== 'system') return dance;
  }
  return systemAnimation('victory');
}
