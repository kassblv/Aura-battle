import { AMPLIFIER_LEVELS, amplifierName, styleName, tierName, TIERS } from '@aura/content';
import {
  BALANCE,
  type AmplifierLevel,
  type Choice,
  type RechargeTap,
  type Style,
  type Tier,
} from '@aura/rules';
import { memo, useCallback, useEffect, useRef, useState, type JSX, type RefObject } from 'react';
import type { MatchView } from '../match/view.js';
import {
  chargeClock,
  gaugeBands,
  needlePosition,
  percent,
  resolveZones,
  type MeterZones,
} from '../ui/gauge.js';
import { countdownLabel, orbPaint, ORB_SLOTS, phaseClock, progressTransform } from '../ui/frame.js';
import { renderKey, type MeterZonesView } from '../ui/renderKey.js';
import { betFor, levelFill, type Bet } from '../ui/bet.js';
import { chunkEvenly, pickNameClass, STYLE_COLUMNS } from '../ui/layout.js';

/**
 * L ecran de match.
 *
 * Il ne decide rien et ignore contre qui il joue : `view.ts` lui donne une
 * forme unique pour le solo et l en-ligne, `reach.ts` place les orbes. Ici on
 * lit une horloge, on dessine, et on transmet des intentions.
 *
 * **Deux rythmes, deux mecaniques.** L aiguille, les orbes et le compte a
 * rebours suivent l horloge ; les boutons, les paliers, l energie et le
 * bandeau ne bougent qu au doigt du joueur ou a un message du serveur. Tout
 * passait par le meme rendu React soixante fois par seconde : deplacer
 * l aiguille redessinait trente boutons, et la phase de choix tombait a 25 i/s
 * sous ralenti x4. Depuis :
 *
 * - React ne redessine que quand `renderKey` change (`ui/renderKey.ts`) ;
 * - une boucle d animation ecrit les styles mobiles sur des references, a
 *   partir des fonctions pures de `ui/frame.ts`.
 *
 * **Qui possede quoi.** Une propriete appartient a React **ou** a la boucle,
 * jamais aux deux : une valeur ecrite hors React sur une propriete que React
 * rend aussi serait effacee au rendu suivant, et le symptome serait un
 * tremblement, pas une erreur. La boucle possede `transform` de la barre de
 * phase, le texte du compte a rebours, `left`/`top`/`opacity`/`data-live`/
 * `data-kind` des orbes et `left` de l aiguille. React ne rend aucune de ces
 * proprietes.
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
/** Jauge pleine : en deca, le serveur refuse l activation (`docs/01` §6). */
const ULTIMATE_FULL = BALANCE.ultimate.gaugeMax;

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

export type { MeterZonesView };

export interface MatchScreenProps {
  readonly view: MatchView & Partial<MeterZonesView>;
  readonly actions: MatchActions;
  /**
   * Heure locale au dernier rendu, dans le repere de `view.phaseEndsAtMs`.
   *
   * Elle ne sert plus a dessiner — la boucle lit `clock` — mais a **caler** le
   * repere : l ecran en deduit l ecart avec `performance.now()` quand le parent
   * ne fournit pas d horloge vive.
   */
  readonly nowMs: number;
  /**
   * Horloge vive du parent, lue a chaque image et a chaque geste.
   *
   * Sans elle, l ecran se rabat sur `nowMs` plus l ecart mesure au dernier
   * rendu. Le repli est exact tant que l ecart est constant — c est le cas du
   * solo, dont l horloge est `performance.now()` moins un debut fixe — mais il
   * vieillit des que le parent decale son repere. La fournir supprime la
   * question, et elle est **indispensable pour dater un geste** : un tap et un
   * verrouillage sont confrontes cote serveur a leur instant d arrivee
   * (docs/06), et une horloge figee au dernier rendu les daterait faux.
   */
  readonly clock?: () => number;
  readonly opponentName: string;
  /**
   * L adversaire est un enregistrement.
   *
   * Le jeu le dit, discretement mais sans ambiguite (`docs/05`, § Fantomes).
   * Remplir une file en laissant croire a un humain absent est un mensonge qui
   * decredibiliserait tout le reste de ce que l ecran affiche.
   */
  readonly opponentIsGhost?: boolean;
  readonly onLeave: () => void;
  /**
   * Rejouer tout de suite.
   *
   * Ce que le mot recouvre depend du mode — relancer une partie solo, ou se
   * remettre en file — et l ecran n a pas a le savoir : il sait seulement que
   * c est le geste le plus probable juste apres un resultat.
   */
  readonly onRematch: () => void;
  readonly rematchLabel: string;
}

function MatchScreenBody({
  view,
  actions,
  nowMs,
  clock,
  opponentName,
  opponentIsGhost = false,
  onLeave,
  onRematch,
  rematchLabel,
}: MatchScreenProps): JSX.Element {
  const [style, setStyle] = useState<Style | null>(null);
  const [tier, setTier] = useState<Tier>(0);
  const [amplifier, setAmplifier] = useState<AmplifierLevel>(0);
  const [locked, setLocked] = useState(false);
  /**
   * L Ultime, arme pour cette manche.
   *
   * Il etait envoye a `false` en dur : la jauge se remplissait et ne servait
   * jamais. C est pourtant la mecanique qui decide d une manche — ×1,5 et
   * **impossible a contrer** (`docs/01` §6) — et la depenser au bon moment est
   * la decision la plus interessante du jeu.
   */
  const [ultimate, setUltimate] = useState(false);
  /** Instant ou la jauge s est armee, c est-a-dire ou un style a ete choisi. */
  const chargeAt = useRef<number | null>(null);

  /**
   * La vue que la boucle doit peindre.
   *
   * La boucle vit hors du rendu : elle ne peut pas fermer sur `view`, qui
   * serait celle du montage. `renderKey` garantit en retour qu aucun champ lu
   * ici ne peut changer sans rendu.
   */
  const viewRef = useRef(view);
  viewRef.current = view;

  /**
   * Horloge vive, ou son repli.
   *
   * `performance.now()` et `nowMs` ne comptent pas depuis le meme instant : on
   * mesure l ecart au rendu, et on le rejoue entre deux rendus.
   */
  const offset = useRef(0);
  if (clock === undefined) offset.current = nowMs - performance.now();
  const now = useRef<() => number>(() => 0);
  now.current = clock ?? ((): number => performance.now() + offset.current);

  /**
   * Temps ecoule dans la phase, a l instant precis ou on le demande.
   *
   * Stable d un rendu a l autre — elle ne lit que des references —, pour que
   * les gestes qu elle date puissent l etre aussi.
   */
  const inPhaseNow = useCallback((): number => {
    const current = viewRef.current;
    return phaseClock(current.phaseEndsAtMs, current.phaseDurationMs, now.current()).inPhaseMs;
  }, []);

  // Elements peints par la boucle. Aucun ne recoit de style de React.
  const timerRef = useRef<HTMLElement | null>(null);
  const countdownRef = useRef<HTMLParagraphElement | null>(null);
  const needleRef = useRef<HTMLElement | null>(null);
  const orbRefs = useRef<(HTMLButtonElement | null)[]>([]);
  /** Orbe posee sur chaque emplacement : c est elle que le clic vise. */
  const orbOn = useRef<(number | null)[]>(Array.from({ length: ORB_SLOTS }, () => null));

  // Une nouvelle manche remet le choix a zero.
  const round = useRef(view.round);
  useEffect(() => {
    if (round.current === view.round) return;
    round.current = view.round;
    setStyle(null);
    setTier(0);
    setAmplifier(0);
    setLocked(false);
    // L Ultime se rearme a chaque manche : l activation vide la jauge, et le
    // garder arme ferait croire qu on le relance avec une jauge vide.
    setUltimate(false);
    chargeAt.current = null;
  }, [view.round]);

  /**
   * La boucle de peinture.
   *
   * Elle est montee une fois pour toute la duree de l ecran et ne depend de
   * rien : tout ce qu elle lit passe par une reference. Elle n alloue rien
   * d autre que le tableau des orbes pendant la recharge, et n ecrit une
   * propriete que si sa valeur a change.
   */
  useEffect(() => {
    let frame = 0;
    let countdownNode: Element | null = null;
    let countdownText = '';

    const paint = (): void => {
      frame = requestAnimationFrame(paint);
      const current = viewRef.current;
      const phase = phaseClock(current.phaseEndsAtMs, current.phaseDurationMs, now.current());

      const timer = timerRef.current;
      if (timer !== null) timer.style.transform = progressTransform(phase.progress);

      const countdown = countdownRef.current;
      if (countdown !== null) {
        const label = countdownLabel(phase.leftMs);
        // Le noeud change quand le bandeau est remonte : la chaine deja posee
        // ne dit alors rien de ce que porte le nouveau.
        if (label !== countdownText || countdown !== countdownNode) {
          countdown.textContent = label;
          countdownText = label;
          countdownNode = countdown;
        }
      }

      if (current.phase === 'recharge') {
        const slots = orbPaint(current.taps, current.orbs, phase.inPhaseMs);
        for (let slot = 0; slot < ORB_SLOTS; slot += 1) {
          const node = orbRefs.current[slot];
          const paintSlot = slots[slot];
          if (node === null || node === undefined || paintSlot === undefined) continue;

          if (paintSlot.orbIndex !== orbOn.current[slot]) {
            orbOn.current[slot] = paintSlot.orbIndex;
            node.dataset.live = paintSlot.orbIndex === null ? 'false' : 'true';
            node.dataset.kind = paintSlot.golden ? 'golden' : 'normal';
            node.setAttribute('aria-label', paintSlot.label);
            if (paintSlot.orbIndex !== null) replay(node);
          }
          if (paintSlot.orbIndex === null) continue;

          node.style.left = paintSlot.left;
          node.style.top = paintSlot.top;
          node.style.opacity = paintSlot.opacity;
        }
      }

      const needle = needleRef.current;
      if (needle !== null) {
        const since = chargeClock(phase.inPhaseMs, chargeAt.current);
        if (since !== null) {
          needle.style.left = percent(needlePosition(since, current.meterPeriodMs));
        }
      }
    };

    frame = requestAnimationFrame(paint);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, []);

  const cap = Math.min(BALANCE.maxRoundCost, view.me.energy ?? BALANCE.maxRoundCost);
  const armed = style !== null;

  /**
   * Stable d un rendu a l autre : c est ce qui permet a `ControlBand` de se
   * reconnaitre. Une fonction recreee a chaque rendu suffirait a lui faire
   * redessiner ses trente boutons.
   */
  const chooseStyle = useCallback(
    (next: Style): void => {
      setStyle(next);
      // La jauge s arme au premier choix de style, pas au debut de la phase :
      // c est l instant ou le joueur commence reellement a viser.
      chargeAt.current ??= inPhaseNow();
    },
    [inPhaseNow],
  );

  const tapSlot = (slot: number): void => {
    const orbIndex = orbOn.current[slot];
    // Un emplacement vide n est pas tapable : la feuille de style le masque et
    // ce garde-fou evite qu un appui retarde ne parte quand meme.
    if (orbIndex === null || orbIndex === undefined) return;
    const at = inPhaseNow();
    actions.tap([{ atMs: at, orbIndex }], at);
  };

  const lockIn = (): void => {
    if (locked || style === null || chargeAt.current === null) return;
    const at = inPhaseNow();
    // Le delai minimal se juge a l instant de l appui, pas au dernier rendu :
    // c est le meme ecart que le serveur recalculera.
    if (at - chargeAt.current < MIN_CHARGE_MS) return;
    const choice: Choice = { move: { style, tier }, amplifier, useUltimate: ultimate };
    if (actions.lock(choice, chargeAt.current, at)) setLocked(true);
  };

  return (
    <div className="match">
      <header className="hud">
        <span className="hud__side">
          <b>Toi</b> <Pips won={view.me.roundsWon} />
          {view.me.energy !== null && <Energy left={view.me.energy} />}
          {view.me.ultimate !== null && <UltimeGauge filled={view.me.ultimate} />}
        </span>
        <span className="hud__round">Manche {view.round}</span>
        <span className="hud__side hud__side--right">
          <Pips won={view.opponent.roundsWon} />{' '}
          <b>
            {opponentName}
            {opponentIsGhost && <em className="hud__ghost">en différé</em>}
          </b>
        </span>
        <i className="hud__timer" ref={timerRef} />
      </header>

      {view.phase === 'recharge' && (
        <>
          <Banner title="Recharge" subRef={countdownRef} />
          {/*
            Les emplacements sont montes une fois pour toute la recharge.
            Auparavant chaque orbe etait un element neuf, remonte des qu elle
            changeait : React reconstruisait alors trois noeuds par image. Ici
            les trois boutons vivent le temps de la phase et la boucle les
            deplace — l orbe qu ils portent est une donnee, plus une identite.
          */}
          <div className="field">
            {Array.from({ length: ORB_SLOTS }, (_, slot) => (
              <button
                key={slot}
                type="button"
                className="orb"
                ref={(node) => {
                  orbRefs.current[slot] = node;
                }}
                onClick={() => {
                  tapSlot(slot);
                }}
              />
            ))}
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
        </>
      )}

      {/*
        La bande de commandes vit le match entier, meme hors de la phase de
        choix.

        C est trente boutons, une echelle de crans et huit pastilles : les
        monter au passage en phase de choix coutait deux images — 45 ms puis
        67 ms, mesurees au ralenti x4 — a l instant **precis** ou la jauge
        apparait et ou le joueur doit commencer a viser. Le pire endroit du
        match pour une saccade. Montee une fois pour toutes, la bande est
        disposee et peinte pendant l intro, ou rien ne se joue ; la montrer
        n est plus qu un changement d opacite, que le compositeur absorbe.

        Cachee, elle est `inert` : ni tapable, ni focalisable, ni lue a voix
        haute. Sans cela les deux grappes avaleraient les orbes de la recharge,
        qui vivent exactement dans les memes arcs de pouce (ADR 0008).

        La jauge, elle, reste conditionnelle : c est trois elements, et son
        apparition est un evenement qui doit se voir.
      */}
      <div
        className="controls"
        data-shown={view.phase === 'choice'}
        inert={view.phase !== 'choice'}
      >
        <ControlBand
          style={style}
          tier={tier}
          amplifier={amplifier}
          locked={locked}
          cap={cap}
          meterCenter={view.meterCenter}
          meterZoneWidth={view.meterZoneWidth}
          meterPerfectWidth={view.meterPerfectWidth}
          needleRef={needleRef}
          ultimate={ultimate}
          ultimateReady={(view.me.ultimate ?? 0) >= ULTIMATE_FULL}
          onUltimate={() => {
            setUltimate((current) => !current);
          }}
          onStyle={chooseStyle}
          onTier={setTier}
          onAmplifier={setAmplifier}
        />
      </div>

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

          {/*
            Le verdict du MATCH vit dans la carte de la manche, pas a cote.

            Les deux panneaux etaient poses separement — la carte centree, le
            mot « Defaite » ancre au bas de l'ecran — et a 844x390 ils se
            recouvraient de huit pixels : le mot mordait le bord arrondi de la
            carte. Deux boites centrees independamment se chevauchent des que
            l'ecran raccourcit, et aucun decalage fixe ne repare ca pour de
            bon. Dans la meme boite, la question ne se pose plus.
          */}
          {view.ended !== null && (
            <p className="outcome__verdict" data-won={view.ended.winner === 'moi'}>
              {view.ended.winner === 'moi'
                ? 'Victoire'
                : view.ended.winner === null
                  ? 'Égalité'
                  : 'Défaite'}
            </p>
          )}
        </div>
      )}

      {view.ended !== null && (
        /*
          Les deux gestes, dans l'arc du pouce droit.

          Ils etaient centres — `left: 50%` — c'est-a-dire dans la zone morte
          entre les deux pouces que l'ADR 0008 nomme lui-meme. Et « Rejouer »
          est le bouton le plus presse du jeu : on y revient apres CHAQUE
          match, et c'est ce moment-la qui decide si le joueur lance une
          seconde partie ou ferme le jeu.

          Le commentaire de la feuille de style promettait deja « le premier
          sous le pouce droit ». Il decrivait une intention, pas la regle
          ecrite juste en dessous.
        */
        <div className="outcome">
          <button type="button" className="outcome__home" onClick={onLeave}>
            Accueil
          </button>
          <button type="button" className="outcome__again" onClick={onRematch}>
            {rematchLabel}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Rejoue l animation d entree d un element.
 *
 * Les emplacements d orbes ne sont plus remontes a chaque orbe — c est tout
 * l interet — donc le depli, qui partait du montage, ne repartirait plus.
 * `prefers-reduced-motion` reste respecte : la duree vient de la feuille de
 * style, que la regle globale ramene a 0,01 ms.
 */
function replay(node: Element): void {
  for (const animation of node.getAnimations()) {
    animation.cancel();
    animation.play();
  }
}

/**
 * Deux images de suite ne changent pas l arbre : on ne le redessine pas.
 *
 * `nowMs` est volontairement absent — c est **le** point : l heure change a
 * chaque image et ne decide plus rien de ce que React dessine. Le reste des
 * proprietes est compare par identite, `view` par sa cle de rendu.
 *
 * Un parent qui recree `onRematch` ou `onLeave` a chaque image annule cette
 * protection. Le vrai remede est en amont — `useMatch` et `useOnlineMatch` ne
 * doivent plus provoquer de rendu par image — et cette barriere reste la pour
 * que l ecran tienne son budget quoi qu il arrive au-dessus de lui.
 */
function sameFrame(previous: MatchScreenProps, next: MatchScreenProps): boolean {
  return (
    renderKey(previous.view) === renderKey(next.view) &&
    previous.actions.tap === next.actions.tap &&
    previous.actions.lock === next.actions.lock &&
    previous.clock === next.clock &&
    previous.opponentName === next.opponentName &&
    previous.rematchLabel === next.rematchLabel &&
    previous.onLeave === next.onLeave &&
    previous.onRematch === next.onRematch
  );
}

export const MatchScreen = memo(MatchScreenBody, sameFrame);

/**
 * La bande de commandes : style a gauche, jauge au milieu, mise a droite.
 *
 * Memoisee, et c est la seule raison de son existence separee. Elle compte une
 * trentaine de boutons, et chaque changement de phase — trois par manche —
 * faisait reconcilier tout ce sous-arbre par React alors que rien n y
 * changeait. Mesure : 45 ms puis 67 ms au ralenti x4, a l instant precis ou la
 * jauge apparait.
 *
 * Ses proprietes sont donc toutes primitives, ou stables par construction :
 * `onStyle` est un `useCallback`, `onTier` et `onAmplifier` sont les
 * modificateurs d etat de React, `needleRef` une reference. La geometrie de la
 * jauge arrive en trois nombres plutot qu en objet — un objet recree a chaque
 * rendu annulerait la memoisation sans rien changer a l ecran.
 */
const ControlBand = memo(function ControlBand({
  style,
  tier,
  amplifier,
  locked,
  cap,
  meterCenter,
  meterZoneWidth,
  meterPerfectWidth,
  needleRef,
  ultimate,
  ultimateReady,
  onUltimate,
  onStyle,
  onTier,
  onAmplifier,
}: {
  readonly style: Style | null;
  readonly tier: Tier;
  readonly amplifier: AmplifierLevel;
  readonly locked: boolean;
  readonly cap: number;
  readonly meterCenter: number | undefined;
  readonly meterZoneWidth: number | undefined;
  readonly meterPerfectWidth: number | undefined;
  readonly needleRef: RefObject<HTMLElement | null>;
  /** L Ultime est arme pour cette manche. */
  readonly ultimate: boolean;
  /** La jauge est pleine : sans cela le serveur refuserait le choix. */
  readonly ultimateReady: boolean;
  readonly onUltimate: () => void;
  readonly onStyle: (next: Style) => void;
  readonly onTier: (next: Tier) => void;
  readonly onAmplifier: (next: AmplifierLevel) => void;
}): JSX.Element {
  const armed = style !== null;
  const bet = betFor(tier, amplifier, cap);
  return (
    <>
      {/*
        L'Ultime, a cote du reste de la mise.

        Il ne coute pas d'energie — il se paie en jauge — donc il ne rentre pas
        dans la grappe palier/amplificateur, qui affiche un budget. Mais il se
        decide au meme instant, alors il se touche au meme endroit.
      */}
      <button
        type="button"
        className="ultimate"
        disabled={!ultimateReady || locked}
        aria-pressed={ultimate}
        onClick={onUltimate}
        aria-label={
          ultimateReady
            ? 'Ultime : ×1,5 et impossible à contrer'
            : 'Ultime : jauge pas encore pleine'
        }
      >
        <b>Ultime</b>
        <small>{ultimateReady ? '×1,5 · incontrable' : 'jauge à remplir'}</small>
      </button>

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
                  onStyle(id);
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
        Faire apparaitre la jauge en poussant les deux grappes ferait bouger
        dix boutons sous le pouce du joueur, a l instant precis ou il vient
        d en toucher un.
      */}
      <div className={armed ? 'gauge-slot' : 'gauge-slot gauge-slot--empty'}>
        {armed && (
          <Gauge
            zones={resolveZones({
              center: meterCenter,
              zoneWidth: meterZoneWidth,
              perfectWidth: meterPerfectWidth,
            })}
            needleRef={needleRef}
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
                  onTier(t);
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
                  onAmplifier(a);
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
    </>
  );
});

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

/**
 * La jauge d Ultime.
 *
 * Le bouton disait « jauge a remplir » sans jamais dire ou l on en etait : un
 * joueur a 95 voyait la meme chose qu un joueur a 10, et ne pouvait donc pas
 * decider s il valait la peine d attendre une manche de plus. Une decision qui
 * se prend sans information n en est pas une.
 */
function UltimeGauge({ filled }: { readonly filled: number }): JSX.Element {
  const ratio = Math.max(0, Math.min(1, filled / BALANCE.ultimate.gaugeMax));
  const ready = ratio >= 1;
  return (
    <span
      className="ultgauge"
      data-ready={ready}
      role="img"
      aria-label={ready ? 'Ultime prêt' : `Ultime à ${String(Math.round(ratio * 100))} %`}
    >
      <i style={{ transform: `scaleX(${String(ratio)})` }} />
    </span>
  );
}

/**
 * Le bandeau de phase.
 *
 * Sa ligne du bas dit soit un etat — « Choix verrouille » —, soit un compte a
 * rebours. Le premier appartient a React, le second a la boucle : d ou les
 * deux formes, exclusives. Quand la boucle ecrit, React ne rend **aucun**
 * enfant, sinon il l effacerait au rendu suivant.
 */
type BannerProps =
  | { readonly title: string; readonly sub: string }
  | { readonly title: string; readonly subRef: RefObject<HTMLParagraphElement | null> };

function Banner(props: BannerProps): JSX.Element {
  return (
    <div className="banner">
      <h2>{props.title}</h2>
      {'sub' in props ? <p>{props.sub}</p> : <p ref={props.subRef} />}
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
 * Les deux zones ne bougent pas de la manche : elles restent rendues par
 * React. Le curseur, lui, bouge a chaque image — il est peint par la boucle,
 * qui possede son `left`. React ne lui en donne aucun, sans quoi il
 * l effacerait au rendu suivant.
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
  needleRef,
}: {
  readonly zones: MeterZones;
  readonly needleRef: RefObject<HTMLElement | null>;
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
        <i className="gauge__needle" ref={needleRef} />
      </div>
      <p className="gauge__legend">
        <span className="gauge__key gauge__key--miss">faible</span>
        <span className="gauge__key gauge__key--good">bon</span>
        <span className="gauge__key gauge__key--perfect">parfait</span>
      </p>
    </div>
  );
}
