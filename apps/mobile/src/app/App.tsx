import { useCallback, useMemo, useRef, useState, type JSX } from 'react';
import { useArena } from '../arena/useArena.js';
import { defaultLook, equip, type LookSlot, type Wardrobe } from './wardrobe.js';
import { MatchScreen } from './MatchScreen.jsx';
import { canLeave, navigate, openingScreen, type Navigation } from './navigation.js';
import type { PlayerProfile } from './profile.js';
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

  const [nav, setNav] = useState<Navigation>(openingScreen);
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

        {nav.screen === 'home' && (
          <HomeScreen
            profile={DEMO_PROFILE}
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

        {nav.screen === 'profile' && (
          <ProfileScreen
            profile={DEMO_PROFILE}
            onClose={() => {
              go('home');
            }}
          />
        )}

        {nav.screen === 'wardrobe' && (
          <WardrobeScreen
            wardrobe={wardrobe}
            onEquip={onEquip}
            onClose={() => {
              go('home');
            }}
          />
        )}

        {nav.screen === 'match' && <MatchScreen looks={looks} arena={arena} onLeave={leaveMatch} />}

        {nav.screen !== 'home' && canLeave(nav) && nav.screen !== 'match' && (
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
