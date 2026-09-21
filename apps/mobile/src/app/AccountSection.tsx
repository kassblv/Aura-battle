import { useState, type JSX } from 'react';
import { accountNotice, groupsOf } from './account.js';

/**
 * La section « Compte » des Reglages.
 *
 * Deux gestes, et un seul ecran : obtenir un code a noter, ou en presenter un
 * pour retrouver son compte ailleurs. C est la reponse au probleme du joueur
 * sur ordinateur, dont le compte vit dans un stockage de navigateur qui se
 * vide pour un rien.
 */

export interface AccountSectionProps {
  /** Absent hors ligne : sans serveur, il n y a pas de compte a garder. */
  readonly online: boolean;
  readonly busy: boolean;
  readonly error: string | null;
  /** Le code fraichement delivre, tant que l ecran est ouvert. */
  readonly code: string | null;
  readonly issue: () => void;
  readonly claim: (code: string) => void;
}

export function AccountSection({
  online,
  busy,
  error,
  code,
  issue,
  claim,
}: AccountSectionProps): JSX.Element {
  const [entry, setEntry] = useState('');
  const [copied, setCopied] = useState(false);

  if (!online) {
    return (
      <div className="sheet__col">
        <h3>Compte</h3>
        <p className="sheet__note">Hors ligne : reconnecte-toi pour mettre ton compte à l’abri.</p>
      </div>
    );
  }

  return (
    <>
      {/*
        Deux colonnes, parce que ce sont deux gestes sans rapport : mettre SON
        compte a l'abri, et en retrouver un autre. Les empiler forcait a
        defiler un ecran de reglages, au doigt, au milieu d'un jeu.
      */}
      <div className="sheet__col">
        <h3>Garder mon compte</h3>
        {code === null ? (
          <>
            <p className="sheet__note">{accountNotice('idle')}</p>
            <button type="button" className="choice" onClick={issue} disabled={busy}>
              <b>Garder mon compte</b>
              <small>Obtiens un code à noter, qui le rouvre sur n’importe quel appareil.</small>
            </button>
          </>
        ) : (
          <>
            {/*
            Le code en gros, en groupes, et lisible sans zoom.

            On le recopie souvent d un ecran vers un autre appareil, parfois
            depuis une photo : c est la lisibilite qui decide si le joueur y
            arrive du premier coup.
          */}
            <p className="code" aria-label="Ton code de récupération">
              {groupsOf(code).map((group) => (
                <span key={group} className="code__group">
                  {group}
                </span>
              ))}
            </p>
            <div className="choices">
              <button
                type="button"
                className="choice"
                onClick={() => {
                  void navigator.clipboard?.writeText(code).then(
                    () => {
                      setCopied(true);
                    },
                    () => {
                      // Presse-papiers refuse : le code reste lisible a l ecran,
                      // ce qui est le seul chemin qui marche partout.
                      setCopied(false);
                    },
                  );
                }}
              >
                <b>{copied ? 'Copié' : 'Copier'}</b>
                <small>Colle-le dans tes notes.</small>
              </button>
            </div>
            <p className="sheet__note sheet__note--warn">{accountNotice('issued')}</p>
          </>
        )}
      </div>

      <div className="sheet__col">
        <h3>J’ai déjà un compte</h3>
        <p className="sheet__note sheet__note--warn">{accountNotice('claim')}</p>
        <div className="choices choices--one">
          <label className="account__field">
            <span>Ton code</span>
            <input
              value={entry}
              onChange={(event) => {
                setEntry(event.target.value);
              }}
              placeholder="AURA-…"
              autoComplete="off"
              spellCheck={false}
              inputMode="text"
            />
          </label>
          <button
            type="button"
            className="choice"
            disabled={busy || entry.trim().length === 0}
            onClick={() => {
              claim(entry);
            }}
          >
            <b>Retrouver mon compte</b>
            <small>Ce navigateur rejoindra ce compte.</small>
          </button>
        </div>

        {error !== null && (
          <p className="sheet__note sheet__note--bad" role="alert">
            {error}
          </p>
        )}
      </div>
    </>
  );
}
