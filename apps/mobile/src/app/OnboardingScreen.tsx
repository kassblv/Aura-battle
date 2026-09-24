import { DISPLAY_NAME_MAX } from '@aura/protocol';
import { useState, type JSX } from 'react';
import { nameHint } from './onboarding.js';

/**
 * Le premier ecran d un nouveau joueur.
 *
 * On ne demande ni adresse, ni mot de passe, ni consentement : le compte existe
 * deja quand cet ecran s affiche, ouvert par le secret d appareil. Il ne reste
 * qu une question, et elle est facultative — d ou le « Plus tard » : un jeu qui
 * retient son joueur derriere un formulaire perd celui qui voulait juste voir
 * a quoi ca ressemble.
 *
 * Le second geste, « J'ai deja un compte », vit ICI et pas seulement dans les
 * Reglages : c est sur un appareil neuf qu on en a besoin, et c est cet ecran
 * qu un appareil neuf montre en premier. Cache dans les Reglages, le code de
 * recuperation n etait trouve par personne — le joueur choisissait un nom,
 * jouait sous un compte vide, et concluait qu il avait tout perdu.
 */

export interface OnboardingProps {
  /** Nom de secours attribue par le serveur, montre comme repli. */
  readonly guestName: string;
  readonly busy: boolean;
  /** Message du serveur quand il a refuse : reseau, session, nom. */
  readonly error: string | null;
  readonly onSubmit: (displayName: string) => void;
  readonly onSkip: () => void;
  /** Presente un code de recuperation : ce navigateur rejoint ce compte. */
  readonly onRestore: (code: string) => void;
}

export function OnboardingScreen({
  guestName,
  busy,
  error,
  onSubmit,
  onSkip,
  onRestore,
}: OnboardingProps): JSX.Element {
  const [mode, setMode] = useState<'name' | 'restore'>('name');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const hint = nameHint(name);
  const trimmed = name.trim();
  const ready = trimmed.length > 0 && hint === null && !busy;

  if (mode === 'restore') {
    const canRestore = code.trim().length > 0 && !busy;
    return (
      <section className="onboard" aria-label="Retrouver mon compte">
        <div className="onboard__panel">
          <h1 className="onboard__title">Bon retour</h1>
          <p className="onboard__lede">
            Entre le code que tu as noté sur ton autre appareil. Tu retrouves ton nom, ton rang, ta
            bourse et tes objets.
          </p>

          <form
            className="onboard__form"
            onSubmit={(event) => {
              event.preventDefault();
              if (canRestore) onRestore(code);
            }}
          >
            <label className="onboard__label" htmlFor="recovery-code">
              Ton code
            </label>
            <input
              id="recovery-code"
              className="onboard__input"
              value={code}
              onChange={(event) => {
                setCode(event.target.value);
              }}
              placeholder="AURA-…"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              enterKeyHint="go"
              disabled={busy}
            />

            {error !== null && (
              <p className="onboard__error" role="alert">
                {error}
              </p>
            )}

            <button type="submit" className="onboard__go" disabled={!canRestore}>
              {busy ? 'Un instant…' : 'Retrouver mon compte'}
            </button>
          </form>

          <button
            type="button"
            className="onboard__skip"
            onClick={() => {
              setMode('name');
            }}
            disabled={busy}
          >
            Retour
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="onboard" aria-label="Choisis ton nom">
      <div className="onboard__panel">
        <h1 className="onboard__title">Bienvenue</h1>
        <p className="onboard__lede">
          Tu joues déjà sous le nom <b>{guestName}</b>. Choisis le tien — il s’affichera au-dessus
          de ton aura à chaque duel.
        </p>

        <form
          className="onboard__form"
          onSubmit={(event) => {
            event.preventDefault();
            if (ready) onSubmit(trimmed);
          }}
        >
          <label className="onboard__label" htmlFor="display-name">
            Ton nom
          </label>
          <input
            id="display-name"
            className="onboard__input"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
            maxLength={DISPLAY_NAME_MAX}
            autoComplete="nickname"
            autoCapitalize="words"
            // `off` : un nom de joueur n est pas une faute a corriger.
            spellCheck={false}
            enterKeyHint="done"
            placeholder={guestName}
            disabled={busy}
          />

          {/* Le compteur ne devient un avertissement qu a l approche de la borne. */}
          <p className={`onboard__count ${trimmed.length > DISPLAY_NAME_MAX - 3 ? 'near' : ''}`}>
            {trimmed.length} / {DISPLAY_NAME_MAX}
          </p>

          {hint !== null && <p className="onboard__hint">{hint}</p>}
          {error !== null && <p className="onboard__error">{error}</p>}

          <button type="submit" className="onboard__go" disabled={!ready}>
            {busy ? 'Un instant…' : 'C’est parti'}
          </button>
        </form>

        <div className="onboard__alts">
          <button type="button" className="onboard__skip" onClick={onSkip} disabled={busy}>
            Plus tard
          </button>
          <button
            type="button"
            className="onboard__skip"
            onClick={() => {
              setMode('restore');
            }}
            disabled={busy}
          >
            J’ai déjà un compte
          </button>
        </div>
      </div>
    </section>
  );
}
