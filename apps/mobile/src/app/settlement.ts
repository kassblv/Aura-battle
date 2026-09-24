import type { ServerMessage } from '@aura/protocol';

import type { MatchOutcome } from './record.js';

/**
 * Ce que l'application encaisse d'un `match:end`.
 *
 * Le serveur a deja tout regle — il credite la bourse lui-meme
 * (`WalletCredit`) — et le client ne fait que recopier. Mais recopier ne
 * suffit pas pour la bourse : `match:end` annonce le GAIN, pas le solde, et
 * l'ajouter ici le compterait deux fois a l'ecran jusqu'a la lecture suivante.
 * Il faut donc la RELIRE.
 *
 * Personne ne la relisait : l'ecran de fin annoncait « +12 ◈ », la base
 * contenait bien 12, et l'accueil affichait toujours 0 — jusqu'au prochain
 * lancement. Le seul moment ou le joueur regarde son solde, c'est en revenant
 * d'un match.
 */
export interface Settlement {
  readonly league: ServerMessage<'match:end'>['rating']['leagueAfter'];
  readonly outcome: MatchOutcome;
  /** La bourse a change cote serveur : l'inventaire doit etre relu. */
  readonly rereadWallet: boolean;
}

/**
 * @param winner l'issue deja traduite par la vue — `'moi'`, l'adversaire, ou
 *   `null` pour une egalite. La vue ne parle jamais de sieges, et la retraduire
 *   ici rouvrirait la question de savoir lequel on occupe.
 */
export function settlementOf(
  settled: ServerMessage<'match:end'>,
  winner: string | null,
): Settlement {
  return {
    league: settled.rating.leagueAfter,
    outcome: {
      // Une egalite reste `null` : la traiter comme une defaite casserait une
      // serie que le joueur n'a pas perdue.
      won: winner === null ? null : winner === 'moi',
      lp: settled.rating.after,
      // Le TOTAL, pas le gain : recopie, jamais cumule, comme les LP.
      xp: settled.rewards.xpTotal,
    },
    // Un match sans piece — abandon, fantome non recompense — ne change rien
    // a la bourse : inutile de refaire trois requetes pour relire la meme.
    rereadWallet: settled.rewards.softCurrency > 0,
  };
}
