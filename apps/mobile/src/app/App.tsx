import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { useArena, type ArenaControls } from '../arena/useArena.js';
import { useAudio, type AudioControls } from './useAudio.js';
import { lockLandscape } from '../platform/orientation.js';
import {
  danceFor,
  defaultLook,
  equip,
  equipDance,
  type Look,
  type LookSlot,
  type Wardrobe,
} from './wardrobe.js';
import { MatchScreen } from './MatchScreen.jsx';
import { useSoloMatch } from './useMatch.js';
import { canLeave, navigate, openingScreen, type Navigation } from './navigation.js';
import { needsOnboarding } from './onboarding.js';
import { OnboardingScreen } from './OnboardingScreen.jsx';
import { newProfile, type PlayerProfile } from './profile.js';
import { buy, type ShopState } from './shop.js';
import { ShopScreen } from './ShopScreen.jsx';
import { InviteScreen } from './InviteScreen.jsx';
import { QueueScreen } from './QueueScreen.jsx';
import { useOnlineMatch } from './useOnlineMatch.js';
import { useSession } from './useSession.js';
import { memeGallery, stepMeme } from './memes.js';
import { tryOn } from './tryOn.js';
import { leagueLabel } from './leagues.js';
import { inviteFromUrl } from './deepLink.js';
import { browserStore, loadProgress, saveProgress } from './persist.js';
import { HomeScreen, ProfileScreen, WardrobeScreen } from './screens.jsx';

/**
 * La coque de l application.
 *
 * L arene 3D vit sous tous les ecrans et ne se demonte jamais : la reconstruire
 * a chaque navigation couterait une seconde de chargement par appui. Hors
 * match, elle devient une vitrine — un seul personnage, camera rapprochee —
 * ce qui donne au vestiaire une raison d exister : on voit ce qu on change.
 */

export function App(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const arena = useArena(canvasRef);
  /**
   * Le son vit aussi longtemps que l application, comme l arene.
   *
   * Il se deverrouille au premier geste du joueur, ou qu il soit : le monter a
   * l entree du match arriverait apres ce geste-la, et iOS resterait muet tout
   * le premier duel.
   */
  const audio = useAudio();

  /**
   * Le paysage, impose quand la plateforme le permet (ADR 0008).
   *
   * Deux tentatives, parce qu aucune ne suffit seule : au montage, ce qui
   * marche dans une WebView ou une application installee ; puis au premier
   * geste, parce que les navigateurs mobiles exigent generalement le plein
   * ecran, qu un geste seul peut avoir accorde. Un refus est le cas normal et
   * ne mene nulle part — l avertissement « tourne ton telephone » reste la
   * pour ca.
   */
  useEffect(() => {
    void lockLandscape();
    const onGesture = (): void => {
      void lockLandscape();
    };
    window.addEventListener('pointerdown', onGesture, { once: true, passive: true });
    return () => {
      window.removeEventListener('pointerdown', onGesture);
    };
  }, []);

  const session = useSession();

  /**
   * Ce que le joueur a deja fait, relu une seule fois au demarrage.
   *
   * Sans ce rangement, equiper un meme ou acheter une danse s'oubliait au
   * rechargement — et le joueur n'en conclut pas que c'est provisoire, il en
   * conclut que le jeu ne l'a pas ecoute.
   */
  const store = useMemo(() => browserStore(), []);
  const saved = useMemo(() => loadProgress(store), [store]);

  const [wardrobe, setWardrobe] = useState<Wardrobe>(() => ({
    look: saved?.look ?? defaultLook(),
    owned: new Set(saved?.owned ?? []),
  }));

  const looks = useMemo(
    () => ({
      a: wardrobe.look,
      b: { ...defaultLook(), outfit: 'outfit.rouge', hair: 'hair.pics', aura: '#ffcf3f' },
    }),
    [wardrobe.look],
  );

  /**
   * Le lien de jeu vit aussi longtemps que l application.
   *
   * Le monter a l entree de l ecran d invitation et le demonter a la sortie
   * couperait la socket entre la creation d un code et l arrivee de
   * l adversaire — c est-a-dire exactement pendant l attente.
   */
  const online = useOnlineMatch(
    session.accessToken,
    session.identity?.displayName ?? null,
    looks,
    arena,
    audio,
  );

  /** Le serveur a ouvert un match : on quitte l ecran d invitation pour l arene. */
  const inDuel = online.view.phase !== 'idle';

  /**
   * Un lien d'invitation rejoint des que la connexion le permet.
   *
   * On attend l'etat `online` : envoyer `invite:join` sur une socket qui n'est
   * pas encore etablie le perdrait en silence, et le joueur resterait devant un
   * ecran d'attente sans savoir pourquoi.
   */
  useEffect(() => {
    const code = invited.current;
    if (code === null || online.status !== 'online') return;
    invited.current = null;
    // L'adresse est nettoyee : un rechargement ne doit pas rejouer la jonction,
    // et le code n'a plus rien a faire dans la barre d'adresse.
    window.history.replaceState(null, '', '/');
    setNav((current) => navigate(current, 'invite'));
    online.joinInvite(code);
  }, [online]);

  /**
   * Les recompenses du dernier match, creditees une seule fois.
   *
   * Le serveur fait autorite : le client ne calcule rien, il encaisse ce qu'on
   * lui annonce. Et il efface l'annonce apres l'avoir encaissee — une
   * recompense qui reste posee dans l'etat serait creditee a chaque rendu, et
   * le joueur s'enrichirait en regardant son ecran de resultat.
   */
  useEffect(() => {
    const settled = online.settled;
    if (settled === null) return;
    setShop((current) => ({
      ...current,
      wallet: { ...current.wallet, soft: current.wallet.soft + settled.rewards.softCurrency },
    }));
    setLeague(settled.rating.leagueAfter);
    online.clearSettled();
  }, [online]);

  /**
   * L inscription est facultative et **ne se represente pas**.
   *
   * Une fois passee — nommee ou remise a plus tard — on ne la remontre pas a
   * chaque lancement : un jeu qui redemande la meme chose a chaque ouverture
   * apprend a son joueur a fermer la fenetre sans lire.
   */
  const [greeted, setGreeted] = useState(false);
  const showOnboarding = !greeted && session.phase === 'ready' && needsOnboarding(session.identity);

  const [nav, setNav] = useState<Navigation>(openingScreen);

  /**
   * Le meme montre sur l accueil.
   *
   * Une aura battle est un clash ou deux personnes rejouent des memes : ce que
   * le joueur vient voir, c est SON mouvement joue par son propre personnage.
   * La galerie pilote donc l arene, et non une grille de vignettes — un mème
   * est un mouvement, une vignette ne le montre pas.
   */
  const gallery = useMemo(() => memeGallery(), []);
  const [memeId, setMemeId] = useState(() => gallery[0]?.animationId ?? '');
  const meme = gallery.find((card) => card.animationId === memeId) ?? gallery[0]!;
  /**
   * L'article porte a l'essai dans la boutique.
   *
   * Il ne touche jamais au vestiaire : essayer n'est pas equiper, et refermer
   * la boutique doit rendre le joueur a lui-meme sans qu'il ait rien a
   * annuler.
   */
  const [trying, setTrying] = useState<string | null>(null);

  /**
   * Classe ou partie rapide.
   *
   * Les deux se jouent exactement pareil : seul change ce qu'on risque. Le
   * client demandait `casual` en dur a trois endroits, donc la ligue d'un
   * joueur ne pouvait jamais bouger, quoi qu'il gagne.
   */
  const [mode, setMode] = useState<'ranked' | 'casual'>('ranked');

  /**
   * Le code porte par le lien qui a ouvert l'application.
   *
   * Lu une seule fois : le lien decrit l'intention du LANCEMENT, pas un etat.
   * Le relire a chaque rendu rejouerait la jonction apres chaque partie, et le
   * joueur serait renvoye au meme duel sans jamais pouvoir en chercher un
   * autre.
   */
  const invited = useRef<string | null>(inviteFromUrl(window.location.href));

  /**
   * La ligue, telle que le serveur l'a annoncee au dernier match fini.
   *
   * Le client ne la calcule jamais : il la reçoit dans `match:end` et la
   * garde, faute de quoi elle disparaitrait au rechargement — et le joueur
   * verrait « Non classé » apres avoir gagne sa place.
   */
  const [league, setLeague] = useState<string>(saved?.league ?? '');
  /**
   * La bourse et les possessions vivent ici en attendant le jalon M5.
   *
   * Elles partiront du serveur : un inventaire tenu par le client est un
   * inventaire qu'on s'offre soi-meme.
   */
  const [shop, setShop] = useState<ShopState>(() => ({
    wallet: saved?.wallet ?? { soft: 0, hard: 0 },
    owned: new Set(saved?.owned ?? []),
  }));

  /**
   * On range apres coup, jamais pendant le rendu.
   *
   * Ecrire dans `localStorage` pendant un rendu le rendrait impur, et React
   * rejoue les rendus. L'effet, lui, ne s'execute qu'une fois l'etat arrete.
   */
  useEffect(() => {
    saveProgress(store, {
      look: wardrobe.look,
      owned: [...shop.owned],
      wallet: shop.wallet,
      ...(league === '' ? {} : { league }),
    });
  }, [store, wardrobe.look, shop.owned, shop.wallet, league]);

  /**
   * Le profil.
   *
   * Tout a zero tant que le serveur n'envoie pas de statistiques (jalon M5).
   * Montrer des chiffres inventes a un joueur qui vient de s'inscrire lui
   * apprendrait, des le premier ecran, a ne pas croire ce que le jeu affiche.
   */
  const profile: PlayerProfile = useMemo(() => {
    const fresh = newProfile(
      session.identity?.displayName ?? 'Invité',
      session.identity?.playerId ?? 'anonyme',
    );
    return { ...fresh, wallet: shop.wallet, league: leagueLabel(league) };
  }, [session.identity, shop.wallet, league]);

  /**
   * Hors match, l arene montre le personnage du joueur, habille en direct.
   *
   * « Hors match » se juge sur ce qui se joue, pas sur le nom de l ecran : un
   * duel en ligne tourne sur l ecran d invitation, et n y penser qu a travers
   * `nav.screen` remettait la vitrine par-dessus le duel a chaque rendu — un
   * seul combattant a l ecran pendant que le HUD jouait la manche.
   */
  if (nav.screen !== 'match' && !inDuel) {
    // Ce qu'on essaie prend le pas sur ce qu'on porte, et seulement a l'ecran.
    const shown = tryOn(looks.a, meme.animationId, nav.screen === 'shop' ? trying : null);
    arena.presentation.current = {
      fighters: {
        a: { animationId: shown.animationId, look: shown.look },
        b: { animationId: 'anim.system.none.charge', look: looks.b },
      },
      hype: 0.35,
    };
    arena.showcase.current = true;
  }

  const go = useCallback((screen: Navigation['screen']) => {
    setNav((current) => navigate(current, screen));
  }, []);

  const onEquip = useCallback((slot: LookSlot, id: string) => {
    setWardrobe((current) => equip(current, slot, id));
  }, []);

  const leaveMatch = useCallback(() => {
    setNav((current) => navigate({ ...current, matchRunning: false }, 'home'));
  }, []);

  return (
    <div className="app">
      <div className="rotate">
        <div className="rotate__phone" />
        <h2>Tourne ton téléphone</h2>
        <p>Aura Battle se joue en paysage, à deux mains.</p>
      </div>

      <div className="stage">
        <canvas ref={canvasRef} className="stage__canvas" />

        {showOnboarding && session.identity !== null && (
          <OnboardingScreen
            guestName={session.identity.displayName}
            busy={session.busy}
            error={session.error}
            onSubmit={(displayName) => {
              void session.rename(displayName).then((done) => {
                if (done) setGreeted(true);
              });
            }}
            onSkip={() => {
              setGreeted(true);
            }}
          />
        )}

        {!showOnboarding && nav.screen === 'home' && (
          <HomeScreen
            profile={profile}
            seasonLabel="Saison 1 · démonstration"
            mode={mode}
            onToggleMode={() => {
              setMode((current) => (current === 'ranked' ? 'casual' : 'ranked'));
            }}
            onPlay={() => {
              go('match');
            }}
            onProfile={() => {
              go('profile');
            }}
            onWardrobe={() => {
              go('wardrobe');
            }}
            onShop={() => {
              go('shop');
            }}
            onOnline={() => {
              go('queue');
              online.joinQueue(mode);
            }}
            onInvite={() => {
              go('invite');
            }}
            meme={meme}
            onStepMeme={(delta) => {
              setMemeId((current) => stepMeme(gallery, current, delta));
            }}
            memeOwned={meme.free || wardrobe.owned.has(meme.animationId)}
            memeEquipped={
              danceFor(wardrobe.look, { style: meme.style, tier: meme.tier }) ===
                meme.animationId ||
              (meme.free &&
                danceFor(wardrobe.look, { style: meme.style, tier: meme.tier }) === undefined)
            }
            onEquipMeme={() => {
              setWardrobe((current) => equipDance(current, meme.animationId));
            }}
          />
        )}

        {!showOnboarding && nav.screen === 'shop' && (
          <ShopScreen
            state={shop}
            trying={trying}
            onTry={(id) => {
              // Retoucher l'article qu'on porte deja le repose : on peut
              // comparer avec soi-meme sans quitter l'etalage.
              setTrying((current) => (current === id ? null : id));
            }}
            onBuy={(id) => {
              setShop((current) => {
                const next = buy(current, id);
                // Ce qu'on vient d'acheter devient portable sur-le-champ : la
                // boutique et le vestiaire partagent la meme liste.
                if (next !== current) setWardrobe((w) => ({ ...w, owned: next.owned }));
                return next;
              });
            }}
            onClose={() => {
              setTrying(null);
              go('home');
            }}
          />
        )}

        {!showOnboarding && nav.screen === 'profile' && (
          <ProfileScreen
            profile={profile}
            onClose={() => {
              go('home');
            }}
          />
        )}

        {!showOnboarding && nav.screen === 'wardrobe' && (
          <WardrobeScreen
            wardrobe={wardrobe}
            onEquip={onEquip}
            onClose={() => {
              go('home');
            }}
          />
        )}

        {!showOnboarding && nav.screen === 'queue' && !inDuel && (
          <QueueScreen
            status={online.status}
            elapsedMs={online.queue?.elapsedMs ?? 0}
            searchRange={online.queue?.searchRange ?? 0}
            onCancel={() => {
              online.leaveQueue();
              go('home');
            }}
          />
        )}

        {!showOnboarding && nav.screen === 'queue' && inDuel && (
          <MatchScreen
            view={online.view}
            actions={online.actions}
            nowMs={online.nowMs}
            clock={online.clock}
            opponentName={online.opponentName}
            opponentIsGhost={online.opponentIsGhost}
            onLeave={leaveMatch}
            onRematch={() => {
              // En ligne, « rejouer » c est se remettre en file : l adversaire
              // precedent n a aucune raison d etre encore la.
              online.joinQueue(mode);
            }}
            rematchLabel="Rejouer"
          />
        )}

        {!showOnboarding && nav.screen === 'invite' && !inDuel && (
          <InviteScreen
            status={online.status}
            code={online.inviteCode}
            error={online.error}
            onCreate={online.createInvite}
            onJoin={online.joinInvite}
            onClose={() => {
              go('home');
            }}
          />
        )}

        {!showOnboarding && nav.screen === 'invite' && inDuel && (
          <MatchScreen
            view={online.view}
            actions={online.actions}
            nowMs={online.nowMs}
            clock={online.clock}
            opponentName={online.opponentName}
            opponentIsGhost={online.opponentIsGhost}
            onLeave={() => {
              go('home');
            }}
            onRematch={() => {
              // Depuis une invitation aussi, « rejouer » passe par la file :
              // celui qui avait donne le code n a pas forcement envie d'un
              // second duel, et l attendre laisserait le joueur devant rien.
              go('queue');
              online.joinQueue(mode);
            }}
            rematchLabel="Rejouer"
          />
        )}

        {!showOnboarding && nav.screen === 'match' && (
          <SoloMatchScreen looks={looks} arena={arena} audio={audio} onLeave={leaveMatch} />
        )}

        {!showOnboarding && nav.screen !== 'home' && canLeave(nav) && nav.screen !== 'match' && (
          <button
            type="button"
            className="mini mini--corner"
            onClick={() => {
              go('home');
            }}
          >
            Accueil
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Le match solo.
 *
 * Extrait dans son propre composant parce que `useSoloMatch` demarre une boucle
 * de rendu : monte au niveau de `App`, elle tournerait meme a l accueil.
 */
function SoloMatchScreen({
  looks,
  arena,
  audio,
  onLeave,
}: {
  readonly looks: Readonly<Record<'a' | 'b', Look>>;
  readonly arena: ArenaControls;
  readonly audio: AudioControls;
  readonly onLeave: () => void;
}): JSX.Element {
  const session = useSoloMatch(looks, arena, audio);
  return (
    <MatchScreen
      view={session.view}
      actions={session.actions}
      nowMs={session.nowMs}
      clock={session.clock}
      opponentName="Nova"
      onLeave={onLeave}
      onRematch={session.restart}
      rematchLabel="Rejouer"
    />
  );
}
