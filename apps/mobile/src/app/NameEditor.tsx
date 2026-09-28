import { DISPLAY_NAME_MAX } from '@aura/protocol';
import { useState, type FormEvent, type JSX } from 'react';
import { renameStep } from './onboarding.js';

/**
 * Changer de nom, depuis le profil.
 *
 * L'accueil « Choisis ton nom » ne revient plus apres « Plus tard » : sans ce
 * formulaire, un joueur presse resterait « Invite 4417 » pour toujours, devant
 * chaque adversaire et dans chaque classement. Memes regles que l'accueil.
 */
export interface NameEditorProps {
  readonly name: string;
  readonly busy: boolean;
  /** Message du serveur quand il a refuse. */
  readonly error: string | null;
  readonly onRename: (name: string) => Promise<boolean>;
}

export function NameEditor({ name, busy, error, onRename }: NameEditorProps): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState(name);
  const step = renameStep(input, name);

  if (!editing) {
    return (
      <button
        type="button"
        className="name-editor__open"
        onClick={() => {
          setInput(name);
          setEditing(true);
        }}
      >
        ✏️ Changer de nom
      </button>
    );
  }

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (!step.ready || busy) return;
    void onRename(step.name).then((done) => {
      if (done) setEditing(false);
    });
  };

  return (
    <form className="name-editor" onSubmit={submit}>
      <input
        className="name-editor__input"
        aria-label="Ton nom"
        value={input}
        maxLength={DISPLAY_NAME_MAX + 4}
        autoComplete="nickname"
        spellCheck={false}
        disabled={busy}
        onChange={(event) => {
          setInput(event.target.value);
        }}
      />
      <button type="submit" className="name-editor__save" disabled={!step.ready || busy}>
        {busy ? '…' : 'Valider'}
      </button>
      <button
        type="button"
        className="name-editor__cancel"
        disabled={busy}
        onClick={() => {
          setEditing(false);
        }}
      >
        Annuler
      </button>
      {(step.problem ?? error) !== null && (
        <small className="name-editor__problem" role="alert">
          {step.problem ?? error}
        </small>
      )}
    </form>
  );
}
