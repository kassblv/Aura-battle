import { randomInt } from 'node:crypto';
import type { ErrorCode } from '@aura/protocol';

/**
 * Invitations par code (docs/03-pvp-protocol.md).
 *
 * Un joueur cree un code, le dicte ou l'envoie a un ami, et les deux se
 * retrouvent dans un match sans passer par la file. Le code vit en memoire :
 * il ne survit volontairement pas a un redemarrage, puisqu'il ne vaut que
 * quelques minutes.
 */

/** Alphabet sans caracteres confondables : ni O/0, ni I/1. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;

/** Une invitation ne vaut que le temps d'envoyer un message. */
const TTL_MS = 10 * 60 * 1_000;

export interface Invite {
  readonly code: string;
  readonly deepLink: string;
  readonly expiresAt: number;
}

export type JoinResult =
  { readonly ok: true; readonly hostId: string } | { readonly ok: false; readonly code: ErrorCode };

interface StoredInvite {
  readonly hostId: string;
  readonly expiresAt: number;
}

export class InviteService {
  private readonly invites = new Map<string, StoredInvite>();
  private readonly byHost = new Map<string, string>();

  get size(): number {
    return this.invites.size;
  }

  private newCode(): string {
    let code = '';
    for (let i = 0; i < CODE_LENGTH; i += 1) {
      code += ALPHABET[randomInt(0, ALPHABET.length)];
    }
    return this.invites.has(code) ? this.newCode() : code;
  }

  /** Retire les invitations perimees. Sans cela, la carte grossit sans fin. */
  private prune(now: number): void {
    for (const [code, invite] of this.invites) {
      if (invite.expiresAt <= now) {
        this.invites.delete(code);
        this.byHost.delete(invite.hostId);
      }
    }
  }

  create(hostId: string, now: number): Invite {
    this.prune(now);

    // Une seule invitation vivante par joueur : sinon un joueur qui hesite
    // seme derriere lui des codes valides que n'importe qui peut utiliser.
    const previous = this.byHost.get(hostId);
    if (previous !== undefined) {
      this.invites.delete(previous);
    }

    const code = this.newCode();
    const expiresAt = now + TTL_MS;
    this.invites.set(code, { hostId, expiresAt });
    this.byHost.set(hostId, code);

    return { code, deepLink: `aurabattle://invite/${code}`, expiresAt };
  }

  join(code: string, guestId: string, now: number): JoinResult {
    // Le code est dicte puis saisi : on ne va pas refuser une minuscule.
    const normalized = code.toUpperCase();
    const invite = this.invites.get(normalized);

    if (invite === undefined) {
      return { ok: false, code: 'INVITE_NOT_FOUND' };
    }
    if (invite.expiresAt <= now) {
      this.invites.delete(normalized);
      this.byHost.delete(invite.hostId);
      return { ok: false, code: 'INVITE_EXPIRED' };
    }
    if (invite.hostId === guestId) {
      // Se rejoindre soi-meme creerait un match a un seul joueur assis des
      // deux cotes. On ne dit pas pourquoi : le code reste utilisable.
      return { ok: false, code: 'INVITE_NOT_FOUND' };
    }

    // Consommee : un code ne sert qu'une fois.
    this.invites.delete(normalized);
    this.byHost.delete(invite.hostId);
    return { ok: true, hostId: invite.hostId };
  }
}
