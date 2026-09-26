import { useState } from 'react';
import type { AdminApi } from '../api/client.js';
import type { AdminPlayerSearchResponse } from '../api/types.js';
import { dateTime } from '../app/format.js';
import { useDebounced, useResource, type Resource } from '../app/resource.js';
import { href } from '../app/router.js';
import { Empty, ErrorBox, Loading } from '../ui/states.js';

export const SEARCH_DEBOUNCE_MS = 300;

export interface PlayersViewProps {
  readonly query: string;
  readonly onQuery: (query: string) => void;
  /** `null` : rien a chercher (saisie vide). */
  readonly results: Resource<AdminPlayerSearchResponse> | null;
  readonly onRetry: () => void;
}

export function PlayersView({ query, onQuery, results, onRetry }: PlayersViewProps) {
  return (
    <div className="page">
      <header className="page__head">
        <h1 className="page__title">Joueurs</h1>
        <p className="page__sub">Recherche par nom ou par identifiant — 20 résultats au plus.</p>
      </header>
      <form className="search" role="search" onSubmit={(e) => e.preventDefault()}>
        <label className="field__label" htmlFor="players-q">
          Nom ou identifiant
        </label>
        <input
          className="field__input search__input"
          id="players-q"
          type="search"
          maxLength={64}
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          autoFocus
        />
      </form>
      {results === null ? (
        <Empty>Saisis au moins un caractère pour chercher.</Empty>
      ) : results.status === 'loading' ? (
        <Loading label="Recherche…" />
      ) : results.status === 'error' ? (
        <ErrorBox message={results.error} onRetry={onRetry} />
      ) : results.data.players.length === 0 ? (
        <Empty>Aucun joueur ne correspond.</Empty>
      ) : (
        <ul className="results" aria-label="Résultats">
          {results.data.players.map((p) => (
            <li key={p.id}>
              <a className="results__item" href={href.player(p.id)}>
                <span className="results__name">
                  {p.displayName === '' ? 'Sans nom' : p.displayName}
                  {p.banned ? <span className="pill pill--down">Banni</span> : null}
                </span>
                <code className="results__id">{p.id}</code>
                <span className="results__meta">
                  Créé le {dateTime(p.createdAt)} · vu le {dateTime(p.lastSeenAt)}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function PlayersPage({ api }: { readonly api: AdminApi }) {
  const [query, setQuery] = useState('');
  const settled = useDebounced(query.trim(), SEARCH_DEBOUNCE_MS);
  const { state, reload } = useResource(
    () => (settled === '' ? Promise.resolve({ players: [] }) : api.searchPlayers(settled)),
    `search:${settled}`,
  );
  return (
    <PlayersView
      query={query}
      onQuery={setQuery}
      results={settled === '' ? null : state}
      onRetry={reload}
    />
  );
}
