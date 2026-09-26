import { useState } from 'react';

export interface LoginViewProps {
  readonly busy: boolean;
  readonly error: string | null;
  readonly onSubmit: (secret: string) => void;
}

/**
 * La porte du panneau. Le secret ne passe jamais par l'URL : formulaire sans
 * `action`, soumission interceptee, `autocomplete="off"` — et il n'est garde
 * que dans `sessionStorage`, le temps de l'onglet.
 */
export function LoginView({ busy, error, onSubmit }: LoginViewProps) {
  const [secret, setSecret] = useState('');
  return (
    <main className="login">
      <form
        className="login__panel"
        onSubmit={(e) => {
          e.preventDefault();
          const value = secret.trim();
          if (value !== '') onSubmit(value);
        }}
      >
        <p className="login__brand">Aura Battle</p>
        <h1 className="login__title">Administration</h1>
        <p className="login__text">
          Saisis le secret d’administration. Il est gardé le temps de cet onglet seulement.
        </p>
        <div className="field">
          <label className="field__label" htmlFor="login-secret">
            Secret d’administration
          </label>
          <input
            className="field__input"
            id="login-secret"
            type="password"
            autoComplete="off"
            autoFocus
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            aria-invalid={error === null ? undefined : true}
            aria-describedby={error === null ? undefined : 'login-error'}
          />
        </div>
        {error === null ? null : (
          <p className="field__error" id="login-error" role="alert">
            {error}
          </p>
        )}
        <button
          type="submit"
          className="btn btn--primary btn--block"
          disabled={busy || secret.trim() === ''}
        >
          {busy ? 'Vérification…' : 'Entrer'}
        </button>
      </form>
    </main>
  );
}
