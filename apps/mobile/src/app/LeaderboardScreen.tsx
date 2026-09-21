import { useEffect, useState, type JSX } from 'react';
import type { LeaderboardPayload, LeaderboardRowPayload } from '@aura/protocol';
import { readLeaderboard } from '../net/leaderboard.js';
import { currentPageLocation, resolveServerUrl } from '../net/serverUrl.js';
import { leagueLabel } from './leagues.js';

/**
 * Le classement general (docs/05, derniere case de M5).
 *
 * Deux colonnes, sur toute la largeur : en paysage la hauteur est la ressource
 * rare et la largeur ne manque pas. La tete a gauche, sa propre place a
 * droite — parce que la question qu'on se pose en ouvrant un classement est
 * « ou suis-je », pas « qui est premier ».
 */

export interface LeaderboardProps {
  readonly accessToken: string | null;
  readonly onClose: () => void;
}

function Row({ row }: { readonly row: LeaderboardRowPayload }): JSX.Element {
  return (
    <li className={row.isMe ? 'rank rank--me' : 'rank'}>
      <span className="rank__pos">{row.rank}</span>
      <span className="rank__name">{row.displayName}</span>
      <span className="rank__league">{leagueLabel(row.league)}</span>
      <span className="rank__lp">{row.leaguePoints}</span>
    </li>
  );
}

export function LeaderboardScreen({ accessToken, onClose }: LeaderboardProps): JSX.Element {
  const [data, setData] = useState<LeaderboardPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (accessToken === null) {
      setError('Hors ligne : le classement vit sur le serveur.');
      return;
    }
    let cancelled = false;

    void (async () => {
      try {
        const base = resolveServerUrl(
          import.meta.env.VITE_SERVER_URL,
          window.location.hostname,
          currentPageLocation(),
        );
        const fresh = await readLeaderboard(base, accessToken);
        if (!cancelled) setData(fresh);
      } catch {
        if (!cancelled) setError('Classement indisponible pour le moment.');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  return (
    <section className="sheet sheet--wide" aria-label="Classement">
      <header className="sheet__head">
        <h2>Classement</h2>
        <button type="button" className="mini" onClick={onClose}>
          Fermer
        </button>
      </header>

      {error !== null && <p className="sheet__note sheet__note--bad">{error}</p>}
      {error === null && data === null && <p className="sheet__note">Chargement…</p>}

      {data !== null && (
        <div className="sheet__cols sheet__cols--rank">
          <div className="sheet__col">
            <h3>Les meilleurs</h3>
            <ol className="ranks">
              {data.top.map((row) => (
                <Row key={row.playerId} row={row} />
              ))}
            </ol>
          </div>

          <div className="sheet__col">
            <h3>Ta place</h3>
            {data.me === null ? (
              /*
                Ne jamais inventer un rang. Quelqu'un qui n'a pas fini de match
                classe n'est nulle part au classement — et lui montrer une
                position le ferait douter de tout le reste de l'ecran.
              */
              <p className="sheet__note">
                Tu n’as pas encore terminé de match classé. Joue un duel classé pour entrer au
                classement.
              </p>
            ) : (
              <>
                <ol className="ranks">
                  {(data.around.length > 0 ? data.around : [data.me]).map((row) => (
                    <Row key={row.playerId} row={row} />
                  ))}
                </ol>
                {data.around.length === 0 && (
                  <p className="sheet__note">Tu es déjà dans les meilleurs.</p>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
