/**
 * Moteur audio.
 *
 * Aucun fichier son : tout est synthetise en direct, comme dans le prototype.
 * La logique (table des sons, choix du son, volume, file d attente) est pure et
 * testee ; `engine.ts` est la seule piece qui parle a la Web Audio API.
 */
export * from './cues.js';
export * from './engine.js';
export * from './gestures.js';
export * from './mixer.js';
export * from './notes.js';
export * from './scheduler.js';
export * from './sounds.js';
export * from './voices.js';
