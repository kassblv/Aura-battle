import { DISPLAY_NAME_MAX } from '@aura/protocol';
import { useState, type JSX } from 'react';
import { FORGOT_PASSWORD_HINT, emailFormProblem } from './emailAccount.js';
import { nameHint, welcomeStep } from './onboarding.js';

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
 * jouait sous un compte vide, et concluait qu il avait tout perdu. On y entre
 * par email et mot de passe par defaut, ou par le code.
 */

export interface OnboardingProps {
  /** Nom de secours attribue par le serveur, montre comme repli. */
  readonly guestName: string;
  readonly busy: boolean;
  /** Message du serveur quand il a refuse : reseau, session, nom. */
  readonly error: string | null;
  readonly onSubmit: (displayName: string) => void;
  /**
   * Rattache un email et un mot de passe au compte invite deja ouvert : c est
   * ca, s inscrire. Aucun second compte n est cree.
   */
  readonly onLink: (email: string, password: string) => Promise<boolean>;
  readonly onSkip: () => void;
  /** Presente un code de recuperation : ce navigateur rejoint ce compte. */
  readonly onRestore: (code: string) => void;
  /** Presente un email et un mot de passe : meme consequence que le code. */
  readonly onLogin: (email: string, password: string) => void;
}

export function OnboardingScreen({
  guestName,
  busy,
  error,
  onSubmit,
  onLink,
  onSkip,
  onRestore,
  onLogin,
}: OnboardingProps): JSX.Element {
  const [mode, setMode] = useState<'name' | 'restore'>('name');
  // L'email d'abord : c'est ce dont on se souvient. Le code reste a un geste,
  // et c'est aussi la porte du mot de passe oublie.
  const [method, setMethod] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [signupConfirm, setSignupConfirm] = useState('');
  // Rattache lors d un essai precedent dont seul le renommage a echoue.
  const [linked, setLinked] = useState(false);
  const [linkFailed, setLinkFailed] = useState(false);
  const hint = nameHint(name);
  const trimmed = name.trim();
  const step = welcomeStep(
    { name, email: signupEmail, password: signupPassword, confirm: signupConfirm },
    linked,
  );
  const ready = step.ready && !busy;

  /*
    Les identifiants D ABORD, le nom ensuite. Un nom enregistre fait
    disparaitre cet ecran (le joueur n est plus un invite) : rattacher apres
    ne laisserait plus d endroit ou dire que le rattachement a echoue.
  */
  const welcome = async (): Promise<void> => {
    if (step.credentials !== null) {
      const ok = await onLink(step.credentials.email, step.credentials.password);
      setLinkFailed(!ok);
      if (!ok) return;
      setLinked(true);
    }
    if (step.rename !== null) onSubmit(step.rename);
    else onSkip();
  };

  if (mode === 'restore') {
    const loginProblem = emailFormProblem('login', { email, password });
    const canRestore =
      !busy &&
      (method === 'code'
        ? code.trim().length > 0
        : email.trim().length > 0 && password.length > 0 && loginProblem === null);
    return (
      <section className="onboard" aria-label="Retrouver mon compte">
        {/*
          Deux colonnes : a gauche ce qu'on explique, a droite ce qu'on
          remplit. Empile, le formulaire email debordait des 390 pixels du
          paysage — et un ecran d'accueil qui defile au doigt perd le joueur
          avant la premiere partie.
        */}
        <div className="onboard__panel onboard__panel--wide">
          <div className="onboard__cols">
            <div className="onboard__col">
              <h1 className="onboard__title">Bon retour</h1>
              <p className="onboard__lede">
                Tu retrouves ton nom, ton rang, ta bourse et tes objets.
              </p>

              <div className="onboard__tabs" role="group" aria-label="Comment te connecter">
                <button
                  type="button"
                  className="onboard__tab"
                  aria-pressed={method === 'email'}
                  onClick={() => {
                    setMethod('email');
                  }}
                  disabled={busy}
                >
                  Email
                </button>
                <button
                  type="button"
                  className="onboard__tab"
                  aria-pressed={method === 'code'}
                  onClick={() => {
                    setMethod('code');
                  }}
                  disabled={busy}
                >
                  Code de récupération
                </button>
              </div>

              <p className="onboard__hint">
                {method === 'email'
                  ? FORGOT_PASSWORD_HINT
                  : 'Le code que tu as noté sur ton autre appareil.'}
              </p>

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

            <form
              className="onboard__form onboard__col"
              method="post"
              onSubmit={(event) => {
                event.preventDefault();
                if (!canRestore) return;
                if (method === 'code') onRestore(code);
                else onLogin(email, password);
              }}
            >
              {method === 'email' ? (
                <>
                  <label className="onboard__label" htmlFor="login-email">
                    Email
                  </label>
                  <input
                    id="login-email"
                    className="onboard__input"
                    type="email"
                    name="email"
                    value={email}
                    onChange={(event) => {
                      setEmail(event.target.value);
                    }}
                    autoComplete="email"
                    inputMode="email"
                    autoCapitalize="none"
                    spellCheck={false}
                    enterKeyHint="next"
                    disabled={busy}
                  />
                  <label className="onboard__label" htmlFor="login-password">
                    Mot de passe
                  </label>
                  <input
                    id="login-password"
                    className="onboard__input"
                    type="password"
                    name="password"
                    value={password}
                    onChange={(event) => {
                      setPassword(event.target.value);
                    }}
                    autoComplete="current-password"
                    enterKeyHint="go"
                    disabled={busy}
                  />
                  {loginProblem !== null && <p className="onboard__hint">{loginProblem}</p>}
                </>
              ) : (
                <>
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
                </>
              )}

              {error !== null && (
                <p className="onboard__error" role="alert">
                  {error}
                </p>
              )}

              <button type="submit" className="onboard__go" disabled={!canRestore}>
                {busy ? 'Un instant…' : 'Retrouver mon compte'}
              </button>
            </form>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="onboard" aria-label="Choisis ton nom">
      {/*
        Deux colonnes : le nom a gauche, le compte a droite. Empiles, trois
        champs de plus debordaient des 390 pixels du paysage.
      */}
      <div className="onboard__panel onboard__panel--wide">
        <form
          className="onboard__cols"
          method="post"
          onSubmit={(event) => {
            event.preventDefault();
            if (ready) void welcome();
          }}
        >
          <div className="onboard__col">
            <h1 className="onboard__title">Bienvenue</h1>
            <p className="onboard__lede">
              Tu joues déjà sous le nom <b>{guestName}</b>. Choisis le tien — il s’affichera
              au-dessus de ton aura à chaque duel.
            </p>

            <div className="onboard__form">
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
                enterKeyHint="next"
                placeholder={guestName}
                disabled={busy}
              />

              {/* Le compteur ne devient un avertissement qu a l approche de la borne. */}
              <p
                className={`onboard__count ${trimmed.length > DISPLAY_NAME_MAX - 3 ? 'near' : ''}`}
              >
                {trimmed.length} / {DISPLAY_NAME_MAX}
              </p>
              {hint !== null && <p className="onboard__hint">{hint}</p>}

              <button type="submit" className="onboard__go" disabled={!ready}>
                {busy
                  ? 'Un instant…'
                  : step.credentials !== null
                    ? 'Créer mon compte'
                    : 'C’est parti'}
              </button>
            </div>

            <div className="onboard__alts">
              <button
                type="button"
                className="onboard__skip"
                onClick={() => {
                  // Apres un rattachement refuse, on garde au moins le nom
                  // choisi : le joueur ne doit pas payer l'echec de l'email.
                  if (linkFailed && step.rename !== null) onSubmit(step.rename);
                  else onSkip();
                }}
                disabled={busy}
              >
                {linkFailed ? 'Continuer sans email' : 'Plus tard'}
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

          <div className="onboard__col onboard__form">
            <p className="onboard__pitch">
              {linked
                ? 'Email rattaché : ton compte te suivra sur tous tes appareils.'
                : 'Crée ton compte pour jouer sur tous tes appareils.'}
            </p>
            {!linked && (
              <>
                <label className="onboard__label" htmlFor="signup-email">
                  Email <small>(facultatif)</small>
                </label>
                <input
                  id="signup-email"
                  className="onboard__input"
                  type="email"
                  name="email"
                  value={signupEmail}
                  onChange={(event) => {
                    setSignupEmail(event.target.value);
                  }}
                  autoComplete="email"
                  inputMode="email"
                  autoCapitalize="none"
                  spellCheck={false}
                  enterKeyHint="next"
                  disabled={busy}
                />
                <label className="onboard__label" htmlFor="signup-password">
                  Mot de passe
                </label>
                <input
                  id="signup-password"
                  className="onboard__input"
                  type="password"
                  name="password"
                  value={signupPassword}
                  onChange={(event) => {
                    setSignupPassword(event.target.value);
                  }}
                  autoComplete="new-password"
                  enterKeyHint="next"
                  disabled={busy}
                />
                <label className="onboard__label" htmlFor="signup-confirm">
                  Confirme le mot de passe
                </label>
                <input
                  id="signup-confirm"
                  className="onboard__input"
                  type="password"
                  name="confirm-password"
                  value={signupConfirm}
                  onChange={(event) => {
                    setSignupConfirm(event.target.value);
                  }}
                  autoComplete="new-password"
                  enterKeyHint="done"
                  disabled={busy}
                />
              </>
            )}

            {step.problem !== null && <p className="onboard__hint">{step.problem}</p>}
            {error !== null && (
              <p className="onboard__error" role="alert">
                {error}
              </p>
            )}
          </div>
        </form>
      </div>
    </section>
  );
}
