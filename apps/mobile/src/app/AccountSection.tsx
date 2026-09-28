import type { EmailStatusResponse } from '@aura/protocol';
import { useEffect, useState, type FormEvent, type JSX } from 'react';
import type { PasswordProof } from '../net/auth.js';
import { accountNotice, groupsOf } from './account.js';
import { FORGOT_PASSWORD_HINT, emailFormProblem } from './emailAccount.js';

/**
 * La section « Compte » des Reglages.
 *
 * Deux questions, deux colonnes : mettre CE compte a l abri (un email et un
 * mot de passe, ou un code a noter), et en retrouver un autre. C est la
 * reponse au joueur sur ordinateur, dont le compte vit dans un stockage de
 * navigateur qui se vide pour un rien, et a celui qui change de telephone.
 *
 * Un formulaire prend la place des deux colonnes plutot que de s y empiler :
 * en paysage la hauteur est la ressource rare, et rien ne doit defiler au
 * doigt au milieu d un jeu.
 */

export interface AccountSectionProps {
  /** Absent hors ligne : sans serveur, il n y a pas de compte a garder. */
  readonly online: boolean;
  readonly busy: boolean;
  readonly error: string | null;
  /** Le code fraichement delivre, tant que l ecran est ouvert. */
  readonly code: string | null;
  /** Demande un code ; l ancien mot de passe est exige des qu un email est rattache. */
  readonly issue: (currentPassword?: string) => void;
  readonly claim: (code: string) => void;
  /** L adresse rattachee, masquee ; `null` tant qu on ne sait pas. */
  readonly email: EmailStatusResponse | null;
  readonly linkEmail: (email: string, password: string) => Promise<boolean>;
  readonly loginEmail: (email: string, password: string) => void;
  /** Rend le code de recuperation NEUF qui remplace l ancien, ou `null` en cas d echec. */
  readonly changePassword: (proof: PasswordProof, newPassword: string) => Promise<string | null>;
}

type View = 'overview' | 'link' | 'change' | 'issue' | 'login-email' | 'login-code';

const TITLES: Readonly<Record<Exclude<View, 'overview'>, string>> = {
  link: 'Se connecter avec un email',
  change: 'Changer le mot de passe',
  issue: 'Nouveau code de récupération',
  'login-email': 'Rejoindre mon compte',
  'login-code': 'Rejoindre mon compte',
};

export function AccountSection({
  online,
  busy,
  error,
  code,
  issue,
  claim,
  email,
  linkEmail,
  loginEmail,
  changePassword,
}: AccountSectionProps): JSX.Element {
  const [view, setView] = useState<View>('overview');
  const [copied, setCopied] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  // Le code delivre par un changement de mot de passe : plus recent que `code`.
  const [freshCode, setFreshCode] = useState<string | null>(null);
  const shownCode = freshCode ?? code;
  const [address, setAddress] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [current, setCurrent] = useState('');
  const [entry, setEntry] = useState('');
  const [forgot, setForgot] = useState(false);

  /** Change d ecran en oubliant la saisie : un mot de passe ne traine pas. */
  const open = (next: View): void => {
    setAddress('');
    setPassword('');
    setConfirm('');
    setCurrent('');
    setEntry('');
    setForgot(false);
    setDone(null);
    setView(next);
  };

  // Le code est arrive : le formulaire qui l a demande n a plus rien a dire.
  useEffect(() => {
    if (view === 'issue' && code !== null) setView('overview');
  }, [view, code]);

  if (!online) {
    return (
      <div className="sheet__col">
        <h3>Compte</h3>
        <p className="sheet__note">Hors ligne : reconnecte-toi pour mettre ton compte à l’abri.</p>
      </div>
    );
  }

  if (view !== 'overview') {
    const mode = view === 'link' ? 'link' : view === 'change' ? 'change' : 'login';
    const problem =
      view === 'login-code' || view === 'issue'
        ? null
        : emailFormProblem(mode, {
            email: view === 'change' ? '' : address,
            password,
            ...(view === 'login-email' ? {} : { confirm }),
          });
    const filled =
      view === 'issue'
        ? current.length > 0
        : view === 'login-code'
          ? entry.trim().length > 0
          : view === 'login-email'
            ? address.trim().length > 0 && password.length > 0
            : view === 'link'
              ? address.trim().length > 0 && password.length > 0 && confirm.length > 0
              : (forgot ? entry.trim().length > 0 : current.length > 0) &&
                password.length > 0 &&
                confirm.length > 0;
    const ready = filled && problem === null && !busy;

    const submit = (event: FormEvent): void => {
      event.preventDefault();
      if (!ready) return;
      if (view === 'issue') issue(current);
      else if (view === 'login-code') claim(entry);
      else if (view === 'login-email') loginEmail(address, password);
      else if (view === 'link') {
        void linkEmail(address, password).then((ok) => {
          if (ok) {
            open('overview');
            setDone('Email rattaché : ce compte s’ouvre désormais partout.');
          }
        });
      } else {
        const proof: PasswordProof = forgot
          ? { recoveryCode: entry }
          : { currentPassword: current };
        void changePassword(proof, password).then((fresh) => {
          if (fresh !== null) {
            open('overview');
            // Le code neuf s'affiche comme a la delivrance : l'ancien vient de
            // tomber avec le mot de passe, et celui-ci ne sera plus reaffiche.
            setFreshCode(fresh);
            setCopied(false);
          }
        });
      }
    };

    return (
      <div className="sheet__col account__wide">
        <h3>{TITLES[view]}</h3>
        <form className="account__form" method="post" onSubmit={submit}>
          <div className="account__fields">
            {(view === 'link' || view === 'login-email') && (
              <label className="account__field account__field--plain">
                <span>Email</span>
                <input
                  type="email"
                  name="email"
                  value={address}
                  onChange={(event) => {
                    setAddress(event.target.value);
                  }}
                  autoComplete="email"
                  inputMode="email"
                  autoCapitalize="none"
                  spellCheck={false}
                  disabled={busy}
                />
              </label>
            )}

            {(view === 'change' || view === 'issue') &&
              (forgot && view === 'change' ? (
                <label className="account__field">
                  <span>Ton code de récupération</span>
                  <input
                    value={entry}
                    onChange={(event) => {
                      setEntry(event.target.value);
                    }}
                    placeholder="AURA-…"
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    disabled={busy}
                  />
                </label>
              ) : (
                <label className="account__field account__field--plain">
                  <span>Mot de passe actuel</span>
                  <input
                    type="password"
                    name="current-password"
                    value={current}
                    onChange={(event) => {
                      setCurrent(event.target.value);
                    }}
                    autoComplete="current-password"
                    disabled={busy}
                  />
                </label>
              ))}

            {view === 'issue' ? null : view === 'login-code' ? (
              <label className="account__field">
                <span>Ton code</span>
                <input
                  value={entry}
                  onChange={(event) => {
                    setEntry(event.target.value);
                  }}
                  placeholder="AURA-…"
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  disabled={busy}
                />
              </label>
            ) : (
              <label className="account__field account__field--plain">
                <span>{view === 'change' ? 'Nouveau mot de passe' : 'Mot de passe'}</span>
                <input
                  type="password"
                  name="password"
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                  }}
                  autoComplete={view === 'login-email' ? 'current-password' : 'new-password'}
                  disabled={busy}
                />
              </label>
            )}

            {(view === 'link' || view === 'change') && (
              <label className="account__field account__field--plain">
                <span>Confirme le mot de passe</span>
                <input
                  type="password"
                  name="confirm-password"
                  value={confirm}
                  onChange={(event) => {
                    setConfirm(event.target.value);
                  }}
                  autoComplete="new-password"
                  disabled={busy}
                />
              </label>
            )}
          </div>

          <div className="account__aside">
            {view === 'link' && (
              <p className="sheet__note">
                Ton email sert d’identifiant : on ne t’écrira jamais. {FORGOT_PASSWORD_HINT}
              </p>
            )}
            {view === 'issue' && (
              <p className="sheet__note sheet__note--warn">
                Ton compte a un email : ton mot de passe prouve que c’est bien toi. Le nouveau code
                annulera l’ancien.
              </p>
            )}
            {view === 'change' && (
              <p className="sheet__note">
                {forgot
                  ? 'Ton code de récupération prouve que ce compte est le tien.'
                  : `Email : ${email?.maskedEmail ?? '—'}`}
              </p>
            )}
            {(view === 'login-email' || view === 'login-code') && (
              <p className="sheet__note sheet__note--warn">{accountNotice('claim')}</p>
            )}
            {view === 'login-email' && <p className="sheet__note">{FORGOT_PASSWORD_HINT}</p>}

            {problem !== null && <p className="sheet__note sheet__note--bad">{problem}</p>}
            {error !== null && (
              <p className="sheet__note sheet__note--bad" role="alert">
                {error}
              </p>
            )}

            <div className="account__actions">
              <button type="submit" className="choice account__submit" disabled={!ready}>
                <b>
                  {busy
                    ? 'Un instant…'
                    : view === 'issue'
                      ? 'Obtenir le code'
                      : view === 'link' || view === 'change'
                        ? 'Valider'
                        : 'Rejoindre'}
                </b>
              </button>
              {view === 'change' ? (
                <button
                  type="button"
                  className="choice"
                  onClick={() => {
                    setForgot(!forgot);
                    setCurrent('');
                    setEntry('');
                  }}
                  disabled={busy}
                >
                  <b>{forgot ? 'Avec l’ancien' : 'Oublié ?'}</b>
                </button>
              ) : null}
              <button
                type="button"
                className="choice"
                onClick={() => {
                  open('overview');
                }}
                disabled={busy}
              >
                <b>Retour</b>
              </button>
            </div>
          </div>
        </form>
      </div>
    );
  }

  return (
    <>
      <div className="sheet__col">
        <h3>Garder mon compte</h3>
        {email?.linked === true ? (
          <button
            type="button"
            className="choice"
            onClick={() => {
              open('change');
            }}
            disabled={busy}
          >
            <b>Changer le mot de passe</b>
            {/* Le code affiche prend la place : sans cela la colonne deborde. */}
            {shownCode === null && <small>Email : {email.maskedEmail}</small>}
          </button>
        ) : (
          <button
            type="button"
            className="choice"
            onClick={() => {
              open('link');
            }}
            disabled={busy}
          >
            <b>Se connecter avec un email</b>
            <small>Un email et un mot de passe pour retrouver ce compte partout.</small>
          </button>
        )}

        {shownCode === null ? (
          <button
            type="button"
            className="choice"
            onClick={() => {
              // Avec un email, une session seule ne suffit plus (ADR 0013).
              // Un code redemande remplace aussi celui du changement de mot de passe.
              setFreshCode(null);
              if (email?.linked === true) open('issue');
              else issue();
            }}
            disabled={busy}
          >
            <b>Code de récupération</b>
            <small>Un code à noter, qui rouvre ce compte sur n’importe quel appareil.</small>
          </button>
        ) : (
          <>
            {/*
              Le code en gros, en groupes, et lisible sans zoom.

              On le recopie souvent d un ecran vers un autre appareil, parfois
              depuis une photo : c est la lisibilite qui decide si le joueur y
              arrive du premier coup.
            */}
            <p className="code" aria-label="Ton code de récupération">
              {groupsOf(shownCode).map((group) => (
                <span key={group} className="code__group">
                  {group}
                </span>
              ))}
            </p>
            <button
              type="button"
              className="choice"
              onClick={() => {
                void navigator.clipboard?.writeText(shownCode).then(
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
              {/* Sans sous-titre : la note juste dessous dit deja quoi en faire, et
                  la colonne debordait de 13 px une fois le code affiche. */}
              <b>{copied ? 'Copié' : 'Copier le code'}</b>
            </button>
            <p className="sheet__note sheet__note--warn">
              {accountNotice(freshCode === null ? 'issued' : 'replaced')}
            </p>
          </>
        )}

        {done !== null && (
          <p className="sheet__note" role="status">
            {done}
          </p>
        )}
      </div>

      <div className="sheet__col">
        <h3>J’ai déjà un compte</h3>
        <p className="sheet__note sheet__note--warn">{accountNotice('claim')}</p>
        <div className="choices choices--one">
          <button
            type="button"
            className="choice"
            onClick={() => {
              open('login-email');
            }}
            disabled={busy}
          >
            <b>Email et mot de passe</b>
            <small>Ce navigateur rejoindra ce compte.</small>
          </button>
          <button
            type="button"
            className="choice"
            onClick={() => {
              open('login-code');
            }}
            disabled={busy}
          >
            <b>Code de récupération</b>
            <small>Le code noté sur ton autre appareil.</small>
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
