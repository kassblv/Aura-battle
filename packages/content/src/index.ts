/**
 * @aura/content — animations et cosmetiques, sous forme de donnees.
 *
 * Regle d'or n°5 : le contenu est de la donnee. Ajouter une danse ne demande
 * aucun changement de code — un fichier JSON valide et une entree au catalogue
 * suffisent.
 */

/**
 * Version du catalogue. Servie au client avec les animations pour qu'il sache
 * invalider son cache (`contentVersion` dans `match:found`).
 */
export const CONTENT_VERSION = '1.1.0';

export * from './animation.js';
export * from './catalogue.js';
export * from './challenges.js';
export * from './cosmetics.js';
export * from './featured.js';
export * from './naming.js';
export * from './pricing.js';
export * from './validate.js';
export * from './tokenPacks.js';
export * from './seasonPass.js';
