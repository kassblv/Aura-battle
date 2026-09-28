/**
 * Un bannissement prend effet sur-le-champ (ADR 0018).
 *
 * Le match en cours du banni se termine par forfait — son adversaire le gagne,
 * par le chemin ordinaire d'un abandon — PUIS ses sockets se ferment. Dans cet
 * ordre : fermer d'abord armerait le compte a rebours d'abandon de
 * quarante-cinq secondes au lieu de conclure. Sa reconnexion est refusee au
 * handshake (le verificateur partage relit le bannissement).
 *
 * Partage par `match.module.ts` et le scenario de bout en bout : recopie, ce
 * cablage finirait par diverger du vrai.
 */
export function enforceBans(
  bans: { subscribe(listener: (playerId: string) => void): void },
  runtime: { forfeitPlayer(playerId: string): boolean },
  sockets: { disconnectPlayer(playerId: string): void },
): void {
  bans.subscribe((playerId) => {
    runtime.forfeitPlayer(playerId);
    sockets.disconnectPlayer(playerId);
  });
}
