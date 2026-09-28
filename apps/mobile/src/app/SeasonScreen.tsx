import { useEffect, useMemo, useRef, type CSSProperties, type JSX } from 'react';
import type { SeasonTrack } from '@aura/content';
import type { SeasonState } from '@aura/protocol';
import { REDUCED_MOTION_QUERY } from '../platform/reducedMotion.js';
import type { PanelLayout } from './panel.js';
import { seasonView, type SeasonCell } from './season.js';
import type { SeasonCelebration } from './useSeason.js';

/**
 * Le passe de saison.
 *
 * Un panneau de droite, comme la boutique : la moitie gauche garde le
 * personnage, et toucher un cosmetique de la piste l'enfile sur lui. Une
 * recompense qu'on voit porter donne plus envie qu'un nom dans une case.
 *
 * La piste est horizontale, deux rangees — gratuite dessus, premium dessous —
 * et elle DEFILE de cote : c'est un menu, pas un ecran de jeu, et trente
 * paliers ne tiennent pas dans 520 pixels. En hauteur, rien ne defile : en
 * paysage la hauteur est la ressource rare, et les cases s'etirent dans ce
 * qu'il en reste.
 *
 * Aucun calcul de gain ici : ce qui est atteint, ouvert ou deja pris vient de
 * la reponse du serveur, croisee avec le contenu par `season.ts`.
 */

export interface SeasonProps {
  /** `null` : jamais lu (hors ligne, ou pas encore). */
  readonly season: SeasonState | null;
  /** L'inventaire : un cosmetique deja possede se changera en pieces. */
  readonly owned: ReadonlySet<string>;
  /** L'heure, pour les jours restants. */
  readonly now: number;
  readonly busy: boolean;
  readonly error: string | null;
  readonly celebration: SeasonCelebration | null;
  /** Le cosmetique porte a l'essai, ou `null`. */
  readonly trying: string | null;
  readonly layout: PanelLayout;
  readonly onClaim: (tier: number, track: SeasonTrack) => void;
  readonly onClaimAll: () => void;
  readonly onBuyPremium: () => void;
  readonly onTry: (itemId: string) => void;
  readonly onClose: () => void;
}

export function SeasonScreen({
  season,
  owned,
  now,
  busy,
  error,
  celebration,
  trying,
  layout,
  onClaim,
  onClaimAll,
  onBuyPremium,
  onTry,
  onClose,
}: SeasonProps): JSX.Element {
  const view = useMemo(
    () => (season === null ? null : seasonView(season, now, owned)),
    [season, now, owned],
  );

  /*
    L'ouverture tombe sur ce qui compte : la premiere case a prendre, sinon le
    palier qu'on remplit. Une seule fois — recadrer apres chaque encaissement
    arracherait la piste au doigt qui la parcourt.
  */
  const track = useRef<HTMLDivElement>(null);
  const framed = useRef(false);
  const focus = view?.focus ?? null;
  useEffect(() => {
    const node = track.current;
    if (framed.current || node === null || focus === null) return;
    const target = node.querySelector<HTMLElement>(`[data-tier="${String(focus)}"]`);
    if (target === null) return;
    framed.current = true;
    // Un palier avant le centre : on voit d'ou l'on vient, pas seulement ou
    // l'on va.
    const left = target.offsetLeft - node.clientWidth / 2 + target.offsetWidth / 2;
    const smooth = !(window.matchMedia?.(REDUCED_MOTION_QUERY).matches ?? false);
    node.scrollTo({ left: Math.max(0, left), behavior: smooth ? 'smooth' : 'auto' });
  }, [focus]);

  const fresh = new Map(
    (celebration?.cells ?? []).map((cell, index) => [`${String(cell.tier)}:${cell.track}`, index]),
  );

  return (
    <section
      className="season"
      aria-label="Passe de saison"
      style={{ width: `${String(layout.width)}px` }}
    >
      <header className="season__head">
        <h2>{view === null ? 'Saison' : `Saison ${String(view.number)}`}</h2>
        {view !== null && (
          <span className="season__days" data-urgent={view.urgent}>
            {view.daysLeft > 1
              ? `${String(view.daysLeft)} jours`
              : view.daysLeft === 1
                ? 'Dernier jour'
                : 'Terminée'}
          </span>
        )}
        <button type="button" className="mini" onClick={onClose}>
          Fermer
        </button>
      </header>

      {error !== null && (
        <p className="season__note season__note--bad" role="alert">
          {error}
        </p>
      )}

      {/*
        La fin de saison presse : non reclamees, les recompenses sont perdues
        au changement. Dit une fois, ici, et seulement s'il y a quelque chose
        a prendre.
      */}
      {error === null && view?.urgent === true && (
        <p className="season__note season__note--urgent" role="status">
          ⏳ {view.claimable} {view.claimable > 1 ? 'récompenses perdues' : 'récompense perdue'} à
          la fin de la saison : récupère-les !
        </p>
      )}

      {/*
        « Hors ligne » et « pas de saison » sont deux choses differentes, et
        seule la premiere se repare en attendant le reseau.
      */}
      {season === null && (
        <p className="season__note">Passe indisponible hors ligne. Le solo reste jouable.</p>
      )}
      {season !== null && view === null && (
        <p className="season__note">Aucune saison en cours. La prochaine arrive bientôt.</p>
      )}

      {view !== null && (
        <>
          <p className="season__progress">
            <b className="season__tier">
              {view.maxed ? 'Palier max' : `Palier ${String(view.tier)}`}
            </b>
            <span
              className="season__bar"
              role="progressbar"
              aria-label="XP du palier en cours"
              aria-valuemin={0}
              aria-valuemax={view.xpNeeded}
              aria-valuenow={view.xpInto}
            >
              <i style={{ width: `${(view.progress * 100).toFixed(1)}%` }} />
            </span>
            <small className="season__xp">
              {view.maxed
                ? 'Tout est atteint'
                : `${String(view.xpInto)} / ${String(view.xpNeeded)} XP`}
            </small>
          </p>

          <div className="season__actions">
            <button
              type="button"
              className="season__all"
              data-ready={view.claimable > 0}
              disabled={view.claimable === 0 || busy}
              onClick={onClaimAll}
            >
              Tout récupérer ({view.claimable})
            </button>

            {view.premium ? (
              <span className="season__owned">
                <span aria-hidden="true">👑</span> Premium
              </span>
            ) : (
              /*
                Le prix est visible meme hors de portee, avec ce qui manque :
                un bouton grise sans raison ne dit pas quoi faire ensuite.
              */
              <button
                type="button"
                className="season__premium"
                data-sealed={view.sealed > 0}
                disabled={view.premiumShortfall > 0 || busy}
                onClick={onBuyPremium}
              >
                <b>Débloquer le premium · 💎 {view.premiumPrice}</b>
                <small>
                  {view.premiumShortfall > 0
                    ? `Il te manque 💎 ${String(view.premiumShortfall)}`
                    : view.sealed > 0
                      ? `${String(view.sealed)} récompense${view.sealed > 1 ? 's' : ''} t’attend${view.sealed > 1 ? 'ent' : ''}`
                      : 'Des cosmétiques rares, et 💎 200 rendus'}
                </small>
              </button>
            )}
          </div>

          <div className="season__track" ref={track}>
            <div className="season__legend" aria-hidden="true">
              <span className="season__row-name">Gratuit</span>
              <span className="season__row-name" data-track="premium">
                {view.premium ? '👑 Premium' : 'Premium'}
              </span>
            </div>

            <ol className="season__tiers">
              {view.tiers.map((entry) => (
                <li
                  key={entry.tier}
                  className="season__col"
                  data-tier={entry.tier}
                  data-reached={entry.reached}
                  data-next={entry.next}
                >
                  <span className="season__num">{entry.tier}</span>
                  {[entry.free, entry.premium].map((cell) => {
                    const order = fresh.get(`${String(cell.tier)}:${cell.track}`);
                    const unsealed = celebration?.premium === true && cell.track === 'premium';
                    return (
                      <Cell
                        // Une nouvelle cle relance l'animation : deux gains de
                        // suite se fetent deux fois.
                        key={`${cell.track}:${String(order === undefined && !unsealed ? 0 : (celebration?.key ?? 0))}`}
                        cell={cell}
                        premiumOwned={view.premium}
                        fresh={order}
                        unsealed={unsealed}
                        trying={trying !== null && trying === cell.itemId}
                        busy={busy}
                        onClaim={onClaim}
                        onTry={onTry}
                      />
                    );
                  })}
                </li>
              ))}
            </ol>
          </div>
        </>
      )}
    </section>
  );
}

const TRACK_NAMES: Readonly<Record<SeasonTrack, string>> = { free: 'gratuit', premium: 'premium' };

const STATE_NAMES: Readonly<Record<SeasonCell['state'], string>> = {
  claimed: 'récupéré',
  claimable: 'à récupérer',
  sealed: 'demande la piste premium',
  ahead: 'pas encore atteint',
};

function rewardName(cell: SeasonCell): string {
  switch (cell.kind) {
    case 'coins':
      return `${cell.label} pièces`;
    case 'tokens':
      return `${cell.label} jetons`;
    case 'item':
      return cell.converts ? `${cell.label}, déjà à toi : ${cell.gain}` : cell.label;
  }
}

/** Au-dela, le decalage d'une cascade « Tout recuperer » devient une attente. */
const STAGGER_CAP = 10;

function Cell({
  cell,
  premiumOwned,
  fresh,
  unsealed,
  trying,
  busy,
  onClaim,
  onTry,
}: {
  readonly cell: SeasonCell;
  readonly premiumOwned: boolean;
  /** Rang dans la fournee qui vient d'etre accordee, ou `undefined`. */
  readonly fresh: number | undefined;
  /** La piste premium vient de s'ouvrir. */
  readonly unsealed: boolean;
  readonly trying: boolean;
  readonly busy: boolean;
  readonly onClaim: (tier: number, track: SeasonTrack) => void;
  readonly onTry: (itemId: string) => void;
}): JSX.Element {
  const claimable = cell.state === 'claimable';
  const itemId = cell.itemId;
  return (
    <button
      type="button"
      className="season__cell"
      data-state={cell.state}
      data-track={cell.track}
      data-kind={cell.kind}
      data-fresh={fresh !== undefined}
      data-unsealed={unsealed}
      data-trying={trying}
      style={
        {
          '--i': Math.min(fresh ?? 0, STAGGER_CAP),
        } as CSSProperties
      }
      // Une case a prendre se prend ; un cosmetique s'essaie meme de loin —
      // c'est ce qui donne envie d'y arriver. Le reste ne fait rien.
      disabled={claimable ? busy : itemId === null}
      aria-label={`Palier ${String(cell.tier)}, ${TRACK_NAMES[cell.track]} : ${rewardName(cell)} — ${STATE_NAMES[cell.state]}`}
      onClick={() => {
        if (claimable) onClaim(cell.tier, cell.track);
        // L'objet qu'on prend s'enfile aussitot : on le voit sur soi au moment
        // ou on le gagne.
        if (itemId !== null && !(claimable && trying)) onTry(itemId);
      }}
    >
      <span className="season__icon" aria-hidden="true">
        {cell.icon}
      </span>
      <span className="season__label" aria-hidden="true">
        {cell.label}
      </span>
      {cell.state === 'claimed' && (
        <span className="season__check" aria-hidden="true">
          ✓
        </span>
      )}
      {cell.track === 'premium' && !premiumOwned && (
        <span className="season__lock" aria-hidden="true">
          🔒
        </span>
      )}
      {fresh !== undefined && (
        <span className="season__gain" aria-hidden="true">
          {cell.gain}
        </span>
      )}
    </button>
  );
}
