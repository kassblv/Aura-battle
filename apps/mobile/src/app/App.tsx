import { useCallback, useMemo, useRef, useState, type JSX } from 'react';
import { useArena } from '../arena/useArena.js';
import { defaultLook, equip, type LookSlot, type Wardrobe } from './wardrobe.js';
import { MatchScreen } from './MatchScreen.jsx';
import { canLeave, navigate, openingScreen, type Navigation } from './navigation.js';
import { needsOnboarding } from './onboarding.js';
import { OnboardingScreen } from './OnboardingScreen.jsx';
import type { PlayerProfile } from './profile.js';
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

/**
 * Profil de demonstration.
 *
 * Il viendra du serveur au jalon M5 ; en attendant, ces chiffres sont
 * explicitement fictifs et ne sont jamais presentes comme reels.
 */
const DEMO_PROFILE: PlayerProfile = {
  name: 'Kassim',
  tag: 'KAS#4417',
  league: 'Or II',
  lp: 1240,
  lpForNextLeague: 1500,
  matches: 128,
  wins: 79,
  currentStreak: 3,
  bestStreak: 9,
  roundsByStyle: { calme: 120, hype: 170, provoc: 98 },
  wallet: { soft: 450, hard: 60 },
};

export function App(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const arena = useArena(canvasRef);
  const session = useSession();

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
  const [wardrobe, setWardrobe] = useState<Wardrobe>(() => ({
    look: defaultLook(),
    owned: new Set<string>(),
  }));

  const profile: PlayerProfile = useMemo(
    () => ({
      ...DEMO_PROFILE,
      // Le nom vient du serveur des qu il repond ; le reste est encore fictif
      // et le restera jusqu a ce que M5 apporte un vrai classement.
      name: session.identity?.displayName ?? DEMO_PROFILE.name,
    }),
    [session.identity],
  );

  const looks = useMemo(
    () => ({
      a: wardrobe.look,
      b: { ...defaultLook(), outfit: 'outfit.rouge', hair: 'hair.pics', aura: '#ffcf3f' },
    }),
    [wardrobe.look],
  );

  // Hors match, l arene montre le personnage du joueur, habille en direct.
  if (nav.screen !== 'match') {
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

        {nav.screen === 'match' && <MatchScreen looks={looks} arena={arena} onLeave={leaveMatch} />}

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
