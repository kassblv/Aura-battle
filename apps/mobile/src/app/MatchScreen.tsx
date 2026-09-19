import {
  BALANCE,
  liveOrbs,
  type AmplifierLevel,
  type Choice,
  type LiveOrb,
  type RechargeTap,
  type Style,
  type Tier,
} from '@aura/rules';
import { useEffect, useRef, useState, type JSX } from 'react';
import { reachable } from '../match/reach.js';
import type { MatchView } from '../match/view.js';

/**
 * L ecran de match.
 *
 * Il ne decide rien et ignore contre qui il joue : `view.ts` lui donne une
 * forme unique pour le solo et l en-ligne, `reach.ts` place les orbes. Ici on
 * lit une horloge, on dessine, et on transmet des intentions.
 */

const STYLES: readonly { id: Style; icon: string; beats: Style }[] = [
  { id: 'calme', icon: '🧊', beats: 'hype' },
  { id: 'hype', icon: '🔥', beats: 'provoc' },
  { id: 'provoc', icon: '😏', beats: 'calme' },
];

const TIERS: readonly Tier[] = [0, 1, 2, 3, 4];
const AMPS: readonly AmplifierLevel[] = [0, 1, 2, 3, 4];

/** Delai minimal entre l armement de la jauge et l appui (docs/03). */
const MIN_CHARGE_MS = 120;

export interface MatchActions {
  tap(taps: readonly RechargeTap[], inPhaseMs: number): void;
  /** `chargeAtMs` : instant ou la jauge s est armee. Le protocole veut les deux. */
  lock(choice: Choice, chargeAtMs: number, tapAtMs: number): boolean;
}

export interface MatchScreenProps {
  readonly view: MatchView;
  readonly actions: MatchActions;
  /** Heure locale courante, fournie par la boucle du parent. */
  readonly nowMs: number;
  readonly opponentName: string;
  readonly onLeave: () => void;
}

export function MatchScreen({
  view,
  actions,
  nowMs,
  opponentName,
  onLeave,
}: MatchScreenProps): JSX.Element {
  const [style, setStyle] = useState<Style | null>(null);
  const [tier, setTier] = useState<Tier>(0);
  const [amplifier, setAmplifier] = useState<AmplifierLevel>(0);
  const [locked, setLocked] = useState(false);
  /** Instant ou la jauge s est armee, c est-a-dire ou un style a ete choisi. */
  const chargeAt = useRef<number | null>(null);

  // Une nouvelle manche remet le choix a zero.
  const round = useRef(view.round);
  useEffect(() => {
    if (round.current === view.round) return;
    round.current = view.round;
    setStyle(null);
    setTier(0);
    setAmplifier(0);
    setLocked(false);
    chargeAt.current = null;
  }, [view.round]);

  const phaseStart = view.phaseEndsAtMs - view.phaseDurationMs;
  const inPhase = Math.max(0, nowMs - phaseStart);
  const left = Math.max(0, view.phaseEndsAtMs - nowMs);
  const cap = Math.min(BALANCE.maxRoundCost, view.me.energy ?? BALANCE.maxRoundCost);
  const cost = tier + amplifier;

  const armed = style !== null && chargeAt.current !== null;
  const canLock = armed && !locked && inPhase - (chargeAt.current ?? 0) >= MIN_CHARGE_MS;

  const chooseStyle = (next: Style): void => {
    setStyle(next);
    // La jauge s arme au premier choix de style, pas au debut de la phase :
    // c est l instant ou le joueur commence reellement a viser.
    chargeAt.current ??= inPhase;
  };

  const lockIn = (): void => {
    if (!canLock || style === null) return;
    const choice: Choice = { move: { style, tier }, amplifier, useUltimate: false };
    if (actions.lock(choice, chargeAt.current ?? 0, inPhase)) setLocked(true);
  };

  return (
    <div className="match">
      <header className="hud">
        <span className="hud__side">
          <b>Toi</b> <Pips won={view.me.roundsWon} />
          {view.me.energy !== null && <Energy left={view.me.energy} />}
        </span>
        <span className="hud__round">Manche {view.round}</span>
        <span className="hud__side hud__side--right">
          <Pips won={view.opponent.roundsWon} /> <b>{opponentName}</b>
        </span>
        <i
          className="hud__timer"
          style={{ width: `${((inPhase / view.phaseDurationMs) * 100).toFixed(1)}%` }}
        />
      </header>

      {view.phase === 'recharge' && (
        <>
          <Banner title="Recharge" sub={`${(left / 1000).toFixed(1)} s`} />
          <div className="field">
            {liveOrbs(view.taps, view.orbs, inPhase).map((slot: LiveOrb) => {
              const at = reachable(slot.orb.x, slot.orb.y);
              return (
                <button
                  key={`${String(slot.slot)}-${String(slot.orb.index)}`}
                  type="button"
                  className={`orb orb--${slot.orb.kind}`}
                  style={{
                    left: `${(at.left * 100).toFixed(2)}%`,
                    top: `${(at.top * 100).toFixed(2)}%`,
                    opacity: 0.4 + slot.remaining * 0.6,
                  }}
                  aria-label={slot.orb.kind === 'golden' ? 'Orbe dorée' : 'Orbe'}
                  onClick={() => {
                    actions.tap([{ atMs: inPhase, orbIndex: slot.orb.index }], inPhase);
                  }}
                />
              );
            })}
          </div>
        </>
      )}

      {view.phase === 'choice' && (
        <>
          <Banner
            title="Choix"
            sub={
              view.opponentLocked
                ? `${opponentName} a verrouillé`
                : 'Règle ton mouvement, puis touche l’écran au centre'
            }
          />
          {!locked && (
            <div
              className="gauge-hit"
              role="button"
              tabIndex={0}
              aria-label="Verrouiller et arrêter la jauge"
              onClick={lockIn}
              onKeyDown={(event) => {
                if (event.key === ' ' || event.key === 'Enter') {
                  event.preventDefault();
                  lockIn();
                }
              }}
            />
          )}
          <Gauge position={gaugePosition(inPhase, view.meterPeriodMs)} dim={!armed} />
          <div className="controls">
            <div className="cluster">
              <p className="cluster__label">Style</p>
              <div className="row">
                {STYLES.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className="pick"
                    aria-pressed={style === s.id}
                    disabled={locked}
                    onClick={() => {
                      chooseStyle(s.id);
                    }}
                  >
                    <span className="pick__icon">{s.icon}</span>
                    <span>{s.id}</span>
                    <small>bat {s.beats}</small>
                  </button>
                ))}
              </div>
            </div>
            <div className="cluster">
              <p className="cluster__label">Palier · amplificateur</p>
              <div className="row">
                {TIERS.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className="pick pick--tight"
                    aria-pressed={tier === t}
                    disabled={locked || t + amplifier > cap}
                    onClick={() => {
                      setTier(t);
                    }}
                  >
                    <span>{BALANCE.tierPower[t]}</span>
                    <small>{t === 0 ? 'libre' : `−${String(t)}`}</small>
                  </button>
                ))}
              </div>
              <div className="row">
                {AMPS.map((a) => (
                  <button
                    key={a}
                    type="button"
                    className="pick pick--tight"
                    aria-pressed={amplifier === a}
                    disabled={locked || a + tier > cap}
                    onClick={() => {
                      setAmplifier(a);
                    }}
                  >
                    <span>×{BALANCE.amplifierMultiplier[a].toFixed(2).replace('.', ',')}</span>
                    <small>{a === 0 ? 'libre' : `−${String(a)}`}</small>
                  </button>
                ))}
              </div>
            </div>
          </div>
          <p className="budget">
            Coût <b className={cost > cap ? 'over' : ''}>{`${String(cost)} / ${String(cap)}`}</b>
          </p>
        </>
      )}

      {(view.phase === 'reveal' || view.phase === 'ended') && view.lastRound !== null && (
        <div className="verdict">
          <h2 className={view.lastRound.winner === 'moi' ? 'win' : 'lose'}>
            {view.lastRound.winner === null
              ? 'Manche nulle'
              : view.lastRound.winner === 'moi'
                ? 'Manche gagnée'
                : 'Manche perdue'}
          </h2>
          <p className="verdict__line">
            <span>Toi</span>
            <b>{view.lastRound.myScore}</b>
          </p>
          <p className="verdict__line">
            <span>{opponentName}</span>
            <b>{view.lastRound.opponentScore}</b>
          </p>
        </div>
      )}

      {view.ended !== null && (
        <button type="button" className="action--center" onClick={onLeave}>
          {view.ended.winner === 'moi' ? 'Victoire — accueil' : 'Défaite — accueil'}
        </button>
      )}
    </div>
  );
}

/** Onde triangulaire : le curseur va et vient, il ne saute pas. */
function gaugePosition(inPhaseMs: number, periodMs: number): number {
  if (periodMs <= 0) return 0;
  const t = (inPhaseMs % periodMs) / periodMs;
  return t < 0.5 ? t * 2 : (1 - t) * 2;
}

function Pips({ won }: { readonly won: number }): JSX.Element {
  return (
    <span className="pips" aria-label={`${String(won)} manche(s) gagnée(s)`}>
      {'●'.repeat(won)}
      {'○'.repeat(Math.max(0, 2 - won))}
    </span>
  );
}

function Energy({ left }: { readonly left: number }): JSX.Element {
  return (
    <span className="energy" aria-label={`Énergie ${String(left)}`}>
      {Array.from({ length: BALANCE.match.startingEnergy }, (_, i) => (
        <i key={i} className={i >= left ? 'spent' : ''} />
      ))}
    </span>
  );
}

function Banner({ title, sub }: { readonly title: string; readonly sub: string }): JSX.Element {
  return (
    <div className="banner">
      <h2>{title}</h2>
      <p>{sub}</p>
    </div>
  );
}

function Gauge({
  position,
  dim,
}: {
  readonly position: number;
  readonly dim: boolean;
}): JSX.Element {
  return (
    <div className="gauge" style={{ opacity: dim ? 0.45 : 1 }}>
      <i className="gauge__good" />
      <i className="gauge__perfect" />
      <i className="gauge__needle" style={{ left: `${(position * 100).toFixed(2)}%` }} />
      <span className="gauge__legend">faible · bon · parfait · bon · faible</span>
    </div>
  );
}
