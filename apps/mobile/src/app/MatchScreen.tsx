import { AMPLIFIER_LEVELS, amplifierName, styleName, tierName, TIERS } from '@aura/content';
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
import {
  chargeClock,
  gaugeBands,
  needlePosition,
  percent,
  resolveZones,
  type MeterZones,
} from '../ui/gauge.js';
import { betFor, levelFill, type Bet } from '../ui/bet.js';
import { chunkEvenly, pickNameClass, STYLE_COLUMNS } from '../ui/layout.js';

/**
 * L ecran de match.
 *
 * Il ne decide rien et ignore contre qui il joue : `view.ts` lui donne une
 * forme unique pour le solo et l en-ligne, `reach.ts` place les orbes. Ici on
 * lit une horloge, on dessine, et on transmet des intentions.
 */

/**
 * Pictogramme par style.
 *
 * La **liste** des styles et leurs contres viennent de `BALANCE` : les
 * recopier ici, c etait promettre que le catalogue en compte trois pour
 * toujours, et prendre le risque qu un contre affiche contredise celui que le
 * serveur applique. Un style sans pictogramme reste jouable — il prend le
 * repli plutot que de disparaitre de l ecran.
 */
const STYLE_ICONS: Partial<Record<Style, string>> = {
  calme: '🧊',
  hype: '🔥',
  provoc: '😏',
};

const FALLBACK_ICON = '✨';

const STYLE_ROWS: readonly (readonly Style[])[] = chunkEvenly(BALANCE.styles, STYLE_COLUMNS);

/** Delai minimal entre l armement de la jauge et l appui (docs/03). */
const MIN_CHARGE_MS = 120;

export interface MatchActions {
  tap(taps: readonly RechargeTap[], inPhaseMs: number): void;
  /**
   * Verrouille le choix.
   *
   * Les deux instants sont **relatifs au debut de la phase**, et le protocole
   * veut les deux : `chargeAtMs` est l armement de la jauge, `tapAtMs` l appui.
   *
   * Ce que le moteur note, lui, est `tapAtMs - chargeAtMs` — c est ce que fait
   * `match.gateway.ts` avant d appeler `evaluateTiming`. Une implementation qui
   * passerait `tapAtMs` tel quel au moteur noterait une autre position que
   * celle dessinee, et, la phase de choix durant quinze secondes contre six a
   * `maxChargeMs`, transformerait tout verrouillage tardif en rate.
   */
  lock(choice: Choice, chargeAtMs: number, tapAtMs: number): boolean;
}

/**
 * Geometrie de la jauge tiree par le moteur, sous les noms plats de `view.ts`.
 *
 * `MatchView` ne publie pour l instant que `meterPeriodMs`, alors que le moteur
 * tire aussi un **centre** par manche (entre 0,30 et 0,70) et que le serveur
 * l envoie dans `choice:start`. Tant que ces trois champs manquent, la jauge se
 * rabat sur une zone centree — un dessin, pas la verite. Le jour ou `view.ts`
 * les porte, la jauge les prend sans qu une ligne change ici.
 */
export interface MeterZonesView {
  readonly meterCenter: number;
  readonly meterZoneWidth: number;
  readonly meterPerfectWidth: number;
}

export interface MatchScreenProps {
  readonly view: MatchView & Partial<MeterZonesView>;
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

  /**
   * Temps ecoule depuis l armement, ou `null` tant que rien n est arme.
   *
   * C est l horloge de la jauge : celle que le serveur utilisera pour noter.
   */
  const sinceCharge = chargeClock(inPhase, chargeAt.current);
  const armed = style !== null && sinceCharge !== null;
  const canLock = armed && !locked && (sinceCharge ?? 0) >= MIN_CHARGE_MS;
  const bet = betFor(tier, amplifier, cap);

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
                : locked
                  ? 'Choix verrouillé'
                  : armed
                    ? 'Touche l’écran pour verrouiller'
                    : 'Choisis ton mouvement'
            }
          />
          {/*
            La cible d appui n existe qu une fois la jauge armee : avant le
            choix du mouvement il n y a rien a arreter, et un ecran qui accepte
            un appui sans effet apprend a son joueur a ne pas lui faire
            confiance.
          */}
          {armed && !locked && (
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
          {/*
            La jauge vit **dans** la bande de commandes, pas au-dessus d elle.
            Posee en absolu au milieu de l ecran, elle barrait les deux
            combattants a hauteur de poitrine ; ici elle occupe l espace que
            les deux grappes laissent entre elles, dans le dernier cinquieme de
            la hauteur que le cadrage large garde libre. Elle ne peut donc plus
            couvrir ni un personnage ni un bouton : c est la mise en page qui
            l en empeche, pas un reglage.
          */}
          <div className="controls">
            <div className="cluster">
              <p className="cluster__label">Style</p>
              {STYLE_ROWS.map((row) => (
                <div className="row" key={row.join('-')}>
                  {row.map((id) => (
                    <button
                      key={id}
                      type="button"
                      className="pick"
                      aria-pressed={style === id}
                      aria-label={`${styleName(id).fr}, bat ${styleName(BALANCE.styleBeats[id]).fr}`}
                      disabled={locked}
                      onClick={() => {
                        chooseStyle(id);
                      }}
                    >
                      <span className="pick__icon">{STYLE_ICONS[id] ?? FALLBACK_ICON}</span>
                      <span className={pickNameClass(styleName(id).fr)}>{styleName(id).fr}</span>
                      {/* Le contre en pictogramme : « bat Provoc » double la largeur du
                          bouton pour une information que l icone donne d un coup d oeil. */}
                      <small>bat {STYLE_ICONS[BALANCE.styleBeats[id]] ?? FALLBACK_ICON}</small>
                    </button>
                  ))}
                </div>
              ))}
            </div>

            {/*
              La fente garde sa place vide.
              Faire apparaitre la jauge en poussant les deux grappes ferait
              bouger dix boutons sous le pouce du joueur, a l instant precis ou
              il vient d en toucher un.
            */}
            <div className={armed ? 'gauge-slot' : 'gauge-slot gauge-slot--empty'}>
              {armed && sinceCharge !== null && (
                <Gauge
                  zones={resolveZones({
                    center: view.meterCenter,
                    zoneWidth: view.meterZoneWidth,
                    perfectWidth: view.meterPerfectWidth,
                  })}
                  position={needlePosition(sinceCharge, view.meterPeriodMs)}
                />
              )}
            </div>

            <div className="cluster">
              <BetHeader
                bet={bet}
                cap={cap}
                names={`${tierName(tier).fr} · ${amplifierName(amplifier).fr}`}
              />
              <div className="row">
                {TIERS.map((t) => {
                  const name = tierName(t).fr;
                  const affordable = t + amplifier <= cap;
                  return (
                    <button
                      key={t}
                      type="button"
                      className="pick pick--tight"
                      aria-pressed={tier === t}
                      aria-label={`${name}, puissance ${String(BALANCE.tierPower[t])}, ${
                        t === 0 ? 'gratuit' : `coûte ${String(t)} d’énergie`
                      }`}
                      data-afford={String(affordable)}
                      disabled={locked || !affordable}
                      onClick={() => {
                        setTier(t);
                      }}
                    >
                      <Rung fill={levelFill(t, TIERS.length)} tone="tier" />
                      <span className={pickNameClass(name)}>{name}</span>
                      <span className="pick__value">{BALANCE.tierPower[t]}</span>
                      <small>{t === 0 ? 'libre' : `−${String(t)}`}</small>
                    </button>
                  );
                })}
              </div>
              <div className="row">
                {AMPLIFIER_LEVELS.map((a) => {
                  const name = amplifierName(a).fr;
                  const multiplier = BALANCE.amplifierMultiplier[a].toFixed(2).replace('.', ',');
                  const affordable = a + tier <= cap;
                  return (
                    <button
                      key={a}
                      type="button"
                      className="pick pick--tight"
                      aria-pressed={amplifier === a}
                      aria-label={`${name}, multiplicateur ${multiplier}, ${
                        a === 0 ? 'gratuit' : `coûte ${String(a)} d’énergie`
                      }`}
                      data-afford={String(affordable)}
                      disabled={locked || !affordable}
                      onClick={() => {
                        setAmplifier(a);
                      }}
                    >
                      <Rung fill={levelFill(a, AMPLIFIER_LEVELS.length)} tone="amplifier" />
                      <span className={pickNameClass(name)}>{name}</span>
                      <span className="pick__value">×{multiplier}</span>
                      <small>{a === 0 ? 'libre' : `−${String(a)}`}</small>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
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

/**
 * Cran d une echelle : une barre dont la hauteur monte avec le niveau.
 *
 * Cinq pastilles alignees ne disent pas qu elles forment une progression. Cinq
 * barres qui montent le disent d un coup d oeil, sans un mot et sans couter un
 * pixel de hauteur au bouton — c est le fond du bouton qui les porte.
 */
function Rung({
  fill,
  tone,
}: {
  readonly fill: number;
  readonly tone: 'tier' | 'amplifier';
}): JSX.Element {
  return (
    <i
      className={`pick__rung pick__rung--${tone}`}
      style={{ height: percent(fill) }}
      aria-hidden="true"
    />
  );
}

/**
 * L en-tete de mise.
 *
 * Palier et amplificateur se payaient sur la meme energie sans que rien ne le
 * montre. Ici la puissance misee est le plus gros chiffre de la grappe, les
 * deux noms choisis la nomment, et les huit points d energie disent ce qu elle
 * coute — y compris ceux que le joueur n a pas, qui sont barres plutot
 * qu absents. Aucune soustraction a faire.
 */
function BetHeader({
  bet,
  cap,
  names,
}: {
  readonly bet: Bet;
  readonly cap: number;
  readonly names: string;
}): JSX.Element {
  return (
    <div className="bet">
      <span className="bet__left">
        {/* La cle force le remontage : le chiffre rebondit a chaque changement. */}
        <b key={bet.power} className="bet__power">
          {bet.power}
        </b>
        <span className="bet__names">{names}</span>
      </span>
      <span
        className="bet__pips"
        role="img"
        aria-label={`Coût ${String(bet.cost)} énergie sur ${String(cap)} disponibles`}
      >
        {bet.pips.map((state, index) => (
          <i key={index} className={`bet__pip bet__pip--${state}`} />
        ))}
      </span>
    </div>
  );
}

/**
 * La jauge de timing.
 *
 * Les trois elements mobiles — zone « bon », zone « parfait », curseur — sont
 * les enfants d un **seul** bloc positionne, `.gauge__track`. C est la piste
 * qui definit le repere ; aucun d eux ne peut donc etre cale sur une largeur
 * differente d un autre. Les pourcentages viennent tous de `ui/gauge.ts`, la
 * feuille de style ne place plus rien.
 *
 * Le panneau est opaque : la jauge est posee sur la foule 3D, et une bande
 * translucide sur un decor anime n a pas de contraste garanti.
 *
 * Elle n est montee qu une fois le mouvement choisi — son horloge part de la,
 * et avant ca elle n aurait rien de vrai a montrer. Son apparition est donc un
 * evenement, et le signal qu il faut viser maintenant.
 */
function Gauge({
  zones,
  position,
}: {
  readonly zones: MeterZones;
  readonly position: number;
}): JSX.Element {
  const bands = gaugeBands(zones);
  return (
    <div className="gauge">
      <div className="gauge__track">
        <i
          className="gauge__band gauge__band--good"
          style={{ left: percent(bands.good.left), width: percent(bands.good.width) }}
        />
        <i
          className="gauge__band gauge__band--perfect"
          style={{ left: percent(bands.perfect.left), width: percent(bands.perfect.width) }}
        />
        <i className="gauge__needle" style={{ left: percent(position) }} />
      </div>
      <p className="gauge__legend">
        <span className="gauge__key gauge__key--miss">faible</span>
        <span className="gauge__key gauge__key--good">bon</span>
        <span className="gauge__key gauge__key--perfect">parfait</span>
      </p>
    </div>
  );
}
