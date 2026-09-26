import { useCallback, useState } from 'react';
import type { AdminApi } from '../api/client.js';
import type { AdminPlayerDetail } from '../api/types.js';
import { dateTime, number } from '../app/format.js';
import {
  BAN_DURATIONS,
  banUntil,
  describeBan,
  REASON_MAX,
  requiredReason,
  type BanDuration,
} from '../app/forms.js';
import { useResource, useWrite, type Notice, type Resource } from '../app/resource.js';
import { href } from '../app/router.js';
import { ConfirmDialog, type ConfirmRequest } from '../ui/ConfirmDialog.js';
import { Empty, ErrorBox, Loading, NoticeBar } from '../ui/states.js';

const MODES: Readonly<Record<AdminPlayerDetail['recentMatches'][number]['mode'], string>> = {
  RANKED: 'Classé',
  CASUAL: 'Amical',
  INVITE: 'Invitation',
  SOLO: 'Solo',
};

function outcome(won: boolean | null): { readonly label: string; readonly tone: string } {
  if (won === true) return { label: 'Gagné', tone: 'pill pill--ok' };
  if (won === false) return { label: 'Perdu', tone: 'pill pill--down' };
  return { label: 'Nul ou inachevé', tone: 'pill pill--muted' };
}

/** Le bannissement est-il en cours a cet instant ? Une date passee n'est plus un bannissement. */
export function banActive(ban: AdminPlayerDetail['ban'], nowMs: number): boolean {
  if (ban === null) return false;
  return ban.until === null || Date.parse(ban.until) > nowMs;
}

function BanForm({
  busy,
  nowMs,
  onBan,
}: {
  readonly busy: boolean;
  readonly nowMs: number;
  readonly onBan: (until: string | null, reason: string) => void;
}) {
  const [duration, setDuration] = useState<BanDuration>('1d');
  const [at, setAt] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    const until = banUntil(duration, Date.now(), at);
    if (!until.ok) return setError(until.error);
    const checked = requiredReason(reason);
    if (!checked.ok) return setError(checked.error);
    setError(null);
    onBan(until.value, checked.value);
  };

  return (
    <form
      className="ban"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      noValidate
    >
      <fieldset className="ban__durations">
        <legend className="field__label">Durée</legend>
        {BAN_DURATIONS.map((d) => (
          <label className="choice" key={d.id}>
            <input
              className="choice__input"
              type="radio"
              name="ban-duration"
              value={d.id}
              checked={duration === d.id}
              onChange={() => setDuration(d.id)}
            />
            <span className="choice__label">{d.label}</span>
          </label>
        ))}
      </fieldset>
      {duration === 'date' ? (
        <div className="field field--narrow">
          <label className="field__label" htmlFor="ban-at">
            Fin du bannissement (heure locale)
          </label>
          <input
            className="field__input"
            id="ban-at"
            type="datetime-local"
            min={new Date(nowMs - new Date(nowMs).getTimezoneOffset() * 60_000)
              .toISOString()
              .slice(0, 16)}
            value={at}
            onChange={(e) => setAt(e.target.value)}
          />
        </div>
      ) : null}
      <div className="field">
        <label className="field__label" htmlFor="ban-reason">
          Motif <span className="field__hint">(obligatoire, journalisé)</span>
        </label>
        <input
          className="field__input"
          id="ban-reason"
          type="text"
          required
          aria-required="true"
          maxLength={REASON_MAX}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          autoComplete="off"
        />
      </div>
      {error === null ? null : (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="btn btn--danger" disabled={busy}>
        Bannir…
      </button>
    </form>
  );
}

function UnbanForm({
  busy,
  onUnban,
}: {
  readonly busy: boolean;
  readonly onUnban: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="ban"
      onSubmit={(e) => {
        e.preventDefault();
        const checked = requiredReason(reason);
        if (!checked.ok) return setError(checked.error);
        setError(null);
        onUnban(checked.value);
      }}
      noValidate
    >
      <div className="field">
        <label className="field__label" htmlFor="unban-reason">
          Motif de la levée <span className="field__hint">(obligatoire, journalisé)</span>
        </label>
        <input
          className="field__input"
          id="unban-reason"
          type="text"
          required
          aria-required="true"
          maxLength={REASON_MAX}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          autoComplete="off"
        />
      </div>
      {error === null ? null : (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="btn btn--primary" disabled={busy}>
        Lever le bannissement…
      </button>
    </form>
  );
}

function Profile({
  player,
  nowMs,
  busy,
  onBan,
  onUnban,
}: {
  readonly player: AdminPlayerDetail;
  readonly nowMs: number;
  readonly busy: boolean;
  readonly onBan: (until: string | null, reason: string) => void;
  readonly onUnban: (reason: string) => void;
}) {
  const active = banActive(player.ban, nowMs);
  return (
    <div className="profile">
      <section className="card" aria-labelledby="player-card">
        <h2 className="card__title" id="player-card">
          Fiche
        </h2>
        <dl className="stats">
          <div className="stat">
            <dt className="stat__label">Identifiant</dt>
            <dd className="stat__value">
              <code>{player.id}</code>
            </dd>
          </div>
          <div className="stat">
            <dt className="stat__label">Créé le</dt>
            <dd className="stat__value">{dateTime(player.createdAt)}</dd>
          </div>
          <div className="stat">
            <dt className="stat__label">Dernière venue</dt>
            <dd className="stat__value">{dateTime(player.lastSeenAt)}</dd>
          </div>
          <div className="stat">
            <dt className="stat__label">Niveau</dt>
            <dd className="stat__value">
              {player.level} · {number(player.xp, 0)} XP
            </dd>
          </div>
          <div className="stat">
            <dt className="stat__label">Portefeuille</dt>
            <dd className="stat__value">
              {number(player.wallet.soft, 0)} pièces · {number(player.wallet.hard, 0)} jetons
            </dd>
          </div>
          <div className="stat">
            <dt className="stat__label">Ligue</dt>
            <dd className="stat__value">{player.league ?? 'Non classé'}</dd>
          </div>
        </dl>
      </section>

      <section className={active ? 'card card--alert' : 'card'} aria-labelledby="player-ban">
        <h2 className="card__title" id="player-ban">
          Bannissement
          {active ? (
            <span className="pill pill--down">En cours</span>
          ) : (
            <span className="pill pill--ok">Aucun</span>
          )}
        </h2>
        {player.ban !== null && active ? (
          <>
            <p className="ban__current">
              Banni {describeBan(player.ban.until)} — depuis le {dateTime(player.ban.at)}.
            </p>
            <p className="ban__reason">
              Motif : {player.ban.reason === '' ? '—' : player.ban.reason}
            </p>
            <UnbanForm busy={busy} onUnban={onUnban} />
          </>
        ) : (
          <>
            {player.ban === null ? null : (
              <p className="note">
                Dernier bannissement terminé ({describeBan(player.ban.until)}) : {player.ban.reason}
              </p>
            )}
            <BanForm busy={busy} nowMs={nowMs} onBan={onBan} />
          </>
        )}
      </section>

      <section className="card profile__matches" aria-labelledby="player-matches">
        <h2 className="card__title" id="player-matches">
          Matchs récents
        </h2>
        {player.recentMatches.length === 0 ? (
          <Empty>Aucun match.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Début</th>
                  <th scope="col">Mode</th>
                  <th scope="col">Issue</th>
                  <th scope="col">Fin</th>
                  <th scope="col">Match</th>
                </tr>
              </thead>
              <tbody>
                {player.recentMatches.map((m) => {
                  const o = outcome(m.won);
                  return (
                    <tr key={m.id}>
                      <td>{dateTime(m.startedAt)}</td>
                      <td>
                        {MODES[m.mode]}
                        {m.ghost ? <span className="table__muted"> · fantôme</span> : null}
                      </td>
                      <td>
                        <span className={o.tone}>{o.label}</span>
                      </td>
                      <td className="table__muted">{m.endReason ?? '—'}</td>
                      <td>
                        <code className="table__muted">{m.id}</code>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

export interface PlayerDetailViewProps {
  readonly state: Resource<AdminPlayerDetail>;
  readonly nowMs: number;
  readonly busy: boolean;
  readonly notice: Notice;
  readonly onDismiss: () => void;
  readonly onRetry: () => void;
  readonly onBan: (until: string | null, reason: string) => void;
  readonly onUnban: (reason: string) => void;
}

export function PlayerDetailView({
  state,
  nowMs,
  busy,
  notice,
  onDismiss,
  onRetry,
  onBan,
  onUnban,
}: PlayerDetailViewProps) {
  const title = state.status === 'ready' ? state.data.displayName || 'Sans nom' : 'Joueur';
  return (
    <div className="page">
      <header className="page__head">
        <a className="back" href={href.players}>
          ← Joueurs
        </a>
        <h1 className="page__title">{title}</h1>
      </header>
      <NoticeBar notice={notice} onDismiss={onDismiss} />
      {state.status === 'loading' ? (
        <Loading />
      ) : state.status === 'error' ? (
        <ErrorBox message={state.error} onRetry={onRetry} />
      ) : (
        <Profile player={state.data} nowMs={nowMs} busy={busy} onBan={onBan} onUnban={onUnban} />
      )}
    </div>
  );
}

export function PlayerDetailPage({ api, id }: { readonly api: AdminApi; readonly id: string }) {
  const { state, reload } = useResource(() => api.player(id), `player:${id}`);
  const write = useWrite(reload);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const cancel = useCallback(() => setConfirm(null), []);
  const name = state.status === 'ready' ? state.data.displayName || id : id;

  const onBan = (until: string | null, reason: string) =>
    setConfirm({
      title: 'Bannir ce joueur ?',
      body: (
        <>
          <p>
            <strong>{name}</strong> sera banni <strong>{describeBan(until)}</strong>.
          </p>
          <p>Motif : « {reason} »</p>
          <p className="confirm__warn">
            Sa session est refusée dès maintenant et un match en cours se termine par forfait.
          </p>
        </>
      ),
      confirmLabel: 'Bannir',
      tone: 'danger',
      onConfirm: () => {
        void write
          .run(() => api.ban(id, { until, reason }), `${name} est banni ${describeBan(until)}.`)
          .then(() => setConfirm(null));
      },
    });

  const onUnban = (reason: string) =>
    setConfirm({
      title: 'Lever le bannissement ?',
      body: (
        <>
          <p>
            <strong>{name}</strong> pourra de nouveau jouer.
          </p>
          <p>Motif : « {reason} »</p>
        </>
      ),
      confirmLabel: 'Lever le bannissement',
      onConfirm: () => {
        void write
          .run(() => api.unban(id, { reason }), `Bannissement de ${name} levé.`)
          .then(() => setConfirm(null));
      },
    });

  return (
    <>
      <PlayerDetailView
        state={state}
        nowMs={Date.now()}
        busy={write.busy}
        notice={write.notice}
        onDismiss={write.dismiss}
        onRetry={reload}
        onBan={onBan}
        onUnban={onUnban}
      />
      <ConfirmDialog request={confirm} busy={write.busy} onCancel={cancel} />
    </>
  );
}
