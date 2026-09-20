import { useCallback, useMemo, useRef, useState, type JSX } from 'react';
import { useArena, type ArenaControls } from '../arena/useArena.js';
import { defaultLook, equip, type Look, type LookSlot, type Wardrobe } from './wardrobe.js';
import { MatchScreen } from './MatchScreen.jsx';
import { useSoloMatch } from './useMatch.js';
import { canLeave, navigate, openingScreen, type Navigation } from './navigation.js';
import { needsOnboarding } from './onboarding.js';
import { OnboardingScreen } from './OnboardingScreen.jsx';
import { defaultEmotes, equipEmote, type EmoteLoadout } from './emotes.js';
import { newProfile, type PlayerProfile } from './profile.js';
import { buy, type ShopState } from './shop.js';
import { ShopScreen } from './ShopScreen.jsx';
import { InviteScreen } from './InviteScreen.jsx';
import { useOnlineMatch } from './useOnlineMatch.js';
import { useSession } from './useSession.js';
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
  const session = useSession();

  const [wardrobe, setWardrobe] = useState<Wardrobe>(() => ({
    look: defaultLook(),
    owned: new Set<string>(),
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
  const online = useOnlineMatch(session.accessToken, looks, arena);

  /** Le serveur a ouvert un match : on quitte l ecran d invitation pour l arene. */
  const inDuel = online.view.phase !== 'idle';

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
  const [emotes, setEmotes] = useState<EmoteLoadout>(() => ({
    slots: defaultEmotes(),
    owned: new Set<string>(),
  }));
  /**
   * La bourse et les possessions vivent ici en attendant le jalon M5.
   *
   * Elles partiront du serveur : un inventaire tenu par le client est un
   * inventaire qu'on s'offre soi-meme.
   */
  const [shop, setShop] = useState<ShopState>(() => ({
    wallet: { soft: 0, hard: 0 },
    owned: new Set<string>(),
  }));

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
    return { ...fresh, wallet: shop.wallet };
  }, [session.identity, shop.wallet]);

  /**
   * Hors match, l arene montre le personnage du joueur, habille en direct.
   *
   * « Hors match » se juge sur ce qui se joue, pas sur le nom de l ecran : un
   * duel en ligne tourne sur l ecran d invitation, et n y penser qu a travers
   * `nav.screen` remettait la vitrine par-dessus le duel a chaque rendu — un
   * seul combattant a l ecran pendant que le HUD jouait la manche.
   */
  if (nav.screen !== 'match' && !inDuel) {
    arena.presentation.current = {
      fighters: {
        a: { animationId: 'anim.system.none.victory', look: looks.a },
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
              go('invite');
            }}
            emotes={emotes.slots}
          />
        )}

        {!showOnboarding && nav.screen === 'shop' && (
          <ShopScreen
            state={shop}
            emotes={emotes}
            onBuy={(id) => {
              setShop((current) => {
                const next = buy(current, id);
                // Ce qu'on vient d'acheter devient portable sur-le-champ : la
                // boutique et le vestiaire partagent la meme liste.
                if (next !== current) {
                  setWardrobe((w) => ({ ...w, owned: next.owned }));
                  setEmotes((e) => ({ ...e, owned: next.owned }));
                }
                return next;
              });
            }}
            onEquipEmote={(slot, id) => {
              setEmotes((current) => equipEmote(current, slot, id));
            }}
            onClose={() => {
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
            opponentName={online.opponentName}
            onLeave={() => {
              go('home');
            }}
          />
        )}

        {!showOnboarding && nav.screen === 'match' && (
          <SoloMatchScreen looks={looks} arena={arena} onLeave={leaveMatch} />
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
  onLeave,
}: {
  readonly looks: Readonly<Record<'a' | 'b', Look>>;
  readonly arena: ArenaControls;
  readonly onLeave: () => void;
}): JSX.Element {
  const session = useSoloMatch(looks, arena);
  return (
    <MatchScreen
      view={session.view}
      actions={session.actions}
      nowMs={session.nowMs}
      opponentName="Nova"
      onLeave={onLeave}
    />
  );
}
