import { useState, type JSX } from 'react';
import type { ConnectionStatus } from '../net/connection.js';

/**
 * Creer ou rejoindre une invitation.
 *
 * Un code se dicte a voix haute : majuscules et chiffres seulement, et la
 * saisie met en capitales toute seule plutot que de refuser ce qu un joueur
 * vient de taper en minuscules.
 */

export interface InviteProps {
  readonly status: ConnectionStatus;
  readonly code: string | null;
  readonly error: string | null;
  readonly onCreate: () => void;
  readonly onJoin: (code: string) => void;
  readonly onClose: () => void;
}

const LINK_LABEL: Readonly<Record<ConnectionStatus, string>> = {
  offline: 'Hors ligne',
  connecting: 'Connexion…',
  reconnecting: 'Reconnexion…',
  online: 'En ligne',
};

export function InviteScreen({
  status,
  code,
  error,
  onCreate,
  onJoin,
  onClose,
}: InviteProps): JSX.Element {
  const [entered, setEntered] = useState('');
  const ready = status === 'online';

  return (
    <section className="sheet sheet--wide sheet--short" aria-label="Duel en ligne">
      <header className="sheet__head">
        <h2>Duel en ligne</h2>
        <span className="queue__link" data-status={status}>
          {LINK_LABEL[status]}
        </span>
        <button type="button" className="mini" onClick={onClose}>
          Fermer
        </button>
      </header>

      {code === null ? (
        /*
          Deux chemins sans rapport, cote a cote.

          Creer et rejoindre ne s'enchainent pas : on fait l'un OU l'autre. Les
          empiler dans une colonne de 430 px laissait la moitie gauche de
          l'ecran vide et poussait le champ de code en bas, loin des pouces.
          Cote a cote, chacun est un debut de phrase, pas une etape.
        */
        <div className="sheet__cols invite__cols">
          <div className="sheet__col">
            <h3>Créer</h3>
            <button type="button" className="invite__create" disabled={!ready} onClick={onCreate}>
              Créer une partie
            </button>
            <p className="sheet__note">Ton adversaire entre ton code, et le duel commence.</p>
          </div>

          <div className="sheet__col">
            <h3>Rejoindre</h3>
            <form
              className="invite__join"
              onSubmit={(event) => {
                event.preventDefault();
                if (ready && entered.trim().length >= 4) onJoin(entered);
              }}
            >
              <input
                className="invite__input"
                value={entered}
                // Les codes se dictent : on met en capitales plutot que de
                // refuser ce qui vient d etre tape en minuscules.
                onChange={(event) => {
                  setEntered(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''));
                }}
                maxLength={16}
                placeholder="CODE"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                inputMode="text"
                enterKeyHint="go"
                aria-label="Code d’invitation"
                disabled={!ready}
              />
              <button type="submit" className="mini" disabled={!ready || entered.length < 4}>
                Rejoindre
              </button>
            </form>
          </div>
        </div>
      ) : (
        <div className="sheet__col">
          <h3>Ton code</h3>
          <p className="invite__code">{code}</p>
          <p className="sheet__note">
            Dicte-le à ton adversaire. Le duel démarre dès qu’il l’a entré.
          </p>
        </div>
      )}

      {error !== null && <p className="onboard__error">{error}</p>}
    </section>
  );
}
