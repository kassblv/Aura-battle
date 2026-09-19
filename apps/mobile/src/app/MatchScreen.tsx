import {
  BALANCE,
  liveOrbs,
  type AmplifierLevel,
  type Choice,
  type LiveOrb,
  type Style,
  type Tier,
} from '@aura/rules';
import { useEffect, useRef, useState, type JSX } from 'react';
import type { ArenaControls } from '../arena/useArena.js';
import { present } from '../match/presentation.js';
import { reachable } from '../match/reach.js';
import { createSoloMatch, type SoloMatch } from '../match/solo.js';
import type { Look } from './wardrobe.js';

/**
 * L ecran de match.
 *
 * Il ne decide rien : le moteur tranche (`solo.ts`), la mise en scene traduit
 * (`presentation.ts`), la zone de pouce est calculee ailleurs (`reach.ts`).
 * Ici on lit une horloge, on dessine, et on transmet des intentions.
 */

const STYLES: readonly { id: Style; icon: string; beats: Style }[] = [
  { id: 'calme', icon: '🧊', beats: 'hype' },
  { id: 'hype', icon: '🔥', beats: 'provoc' },
  { id: 'provoc', icon: '😏', beats: 'calme' },
];

const TIERS: readonly Tier[] = [0, 1, 2, 3, 4];
const AMPS: readonly AmplifierLevel[] = [0, 1, 2, 3, 4];

export interface MatchScreenProps {
  readonly looks: Readonly<Record<'a' | 'b', Look>>;
  readonly arena: ArenaControls;
  readonly onLeave: () => void;
}

export function MatchScreen({ looks, arena, onLeave }: MatchScreenProps): JSX.Element {
  const matchRef = useRef<SoloMatch | null>(null);
  matchRef.current ??= createSoloMatch({
    seed: `solo-${String(Date.now())}`,
    opponent: 'calm',
    startedAtMs: 0,
  });

  const startedAt = useRef(performance.now());
  const [, force] = useState(0);
  const [style, setStyle] = useState<Style | null>(null);
  const [tier, setTier] = useState<Tier>(0);
  const [amplifier, setAmplifier] = useState<AmplifierLevel>(0);
  const [locked, setLocked] = useState(false);
  const nowRef = useRef(0);

  useEffect(() => {
    arena.showcase.current = false;
    let frame = 0;
    const tick = (): void => {
      frame = requestAnimationFrame(tick);
      const match = matchRef.current;
      if (match === null) return;
      nowRef.current = performance.now() - startedAt.current;
      match.advanceTo(nowRef.current);
      arena.presentation.current = present(match.state, looks, {
        showOutcome: match.state.phase === 'reveal',
      });
      force((n) => n + 1);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      arena.showcase.current = true;
    };
  }, [arena, looks]);

  const match = matchRef.current;
  const state = match.state;
  const now = nowRef.current;
  const context = state.roundContext;

  /** Debut de la phase courante : le moteur n annonce que sa fin. */
  const phaseDurations: Record<string, number> = {
    intro: BALANCE.phases.introMs,
    recharge: BALANCE.recharge.durationMs,
    choice: BALANCE.phases.choiceMs,
    reveal: BALANCE.phases.revealMs,
  };
  const duration = phaseDurations[state.phase] ?? 1;
  const phaseStart = state.phaseEndsAtMs - duration;
  const inPhase = Math.max(0, now - phaseStart);
  const left = Math.max(0, state.phaseEndsAtMs - now);

  const cap = Math.min(BALANCE.maxRoundCost, state.seats.a.energy);
  const cost = tier + amplifier;

  const lockIn = (): void => {
    if (locked || style === null || state.phase !== 'choice') return;
    const choice: Choice = { move: { style, tier }, amplifier, useUltimate: false };
    if (match.lock(choice, inPhase, now)) setLocked(true);
  };

  // Une nouvelle manche remet le choix a zero.
  const roundRef = useRef(state.round);
  if (roundRef.current !== state.round) {
    roundRef.current = state.round;
    setStyle(null);
    setTier(0);
    setAmplifier(0);
    setLocked(false);
  }

  return (
    <div className="match">
      <header className="hud">
        <span className="hud__side">
          <b>Toi</b> <span className="pips">{'●'.repeat(state.seats.a.roundsWon)}</span>
          <Energy left={state.seats.a.energy} />
        </span>
        <span className="hud__round">Manche {state.round}</span>
        <span className="hud__side hud__side--right">
          <Energy left={state.seats.b.energy} />
          <span className="pips">{'●'.repeat(state.seats.b.roundsWon)}</span> <b>Nova</b>
        </span>
        <i
          className="hud__timer"
          style={{ width: `${((inPhase / duration) * 100).toFixed(1)}%` }}
        />
      </header>

      {state.phase === 'recharge' && context !== null && (
        <>
          <Banner title="Recharge" sub={`${(left / 1000).toFixed(1)} s`} />
          {liveOrbs(state.pending.a.taps, context.orbs, inPhase).map((slot: LiveOrb) => {
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
                  match.tap([{ atMs: inPhase, orbIndex: slot.orb.index }], now);
                }}
              />
            );
          })}
        </>
      )}

      {state.phase === 'choice' && context !== null && (
        <>
          <Banner title="Choix" sub="Règle ton mouvement, puis touche l’écran au centre" />
          {!locked && <div className="gauge-hit" role="button" tabIndex={0} onClick={lockIn} />}
          <Gauge position={gaugePosition(inPhase, context.gauge.periodMs)} dim={style === null} />
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
                      setStyle(s.id);
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

      {(state.phase === 'reveal' || state.phase === 'ended') && <Verdict state={state} />}

      {state.phase === 'ended' && (
        <button type="button" className="action action--center" onClick={onLeave}>
          {state.result?.winner === 'a' ? 'Victoire — accueil' : 'Défaite — accueil'}
        </button>
      )}
    </div>
  );
}

/** Onde triangulaire : le curseur va et vient, il ne saute pas. */
function gaugePosition(inPhaseMs: number, periodMs: number): number {
  const t = (inPhaseMs % periodMs) / periodMs;
  return t < 0.5 ? t * 2 : (1 - t) * 2;
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

function Verdict({ state }: { readonly state: SoloMatch['state'] }): JSX.Element {
  const round = state.history.at(-1);
  if (round === undefined) return <Banner title="Révélation" sub="" />;
  const won = round.winner === 'a';
  return (
    <div className="verdict">
      <h2 className={won ? 'win' : 'lose'}>
        {round.winner === null ? 'Manche nulle' : won ? 'Manche gagnée' : 'Manche perdue'}
      </h2>
      <p className="verdict__line">
        <span>Toi</span>
        <b>{round.seats.a.score}</b>
      </p>
      <p className="verdict__line">
        <span>Nova</span>
        <b>{round.seats.b.score}</b>
      </p>
    </div>
  );
}
