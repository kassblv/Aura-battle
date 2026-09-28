import { CanvasTexture, SRGBColorSpace, type Texture } from 'three';
import { withAlpha } from './palette.js';

/**
 * Textures peintes au canvas.
 *
 * Seul module de l arene qui a besoin du DOM : tout le reste se construit et se
 * teste sans navigateur. Les fonctions de rendu recoivent donc leurs textures
 * en parametre plutot que de les fabriquer elles-memes.
 */

export interface ArenaTextures {
  /** Le cercle trace au sol, sur lequel les deux se font face. */
  readonly floor: Texture;
  /** Degrade radial blanc : lueur des ecrans de telephone. */
  readonly glow: Texture;
  /** Anneau diffus : la brume qui trainerait au ras du bitume. */
  readonly haze: Texture;
}

function paintTexture(
  width: number,
  height: number,
  paint: (ctx: CanvasRenderingContext2D, width: number, height: number) => void,
): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error("Le canvas 2D n'est pas disponible sur cet appareil.");
  }
  paint(ctx, width, height);
  const texture = new CanvasTexture(canvas);
  // Ces textures sont peintes avec des couleurs d interface, donc en sRGB.
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/**
 * Suite reproductible, pour que le grain du bitume soit toujours le meme.
 *
 * `Math.random` dessinerait une texture differente a chaque chargement : une
 * eclaboussure malheureuse au milieu du cercle n aurait aucun moyen d etre
 * reproduite, donc aucun moyen d etre corrigee.
 */
function grain(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/**
 * Le cercle trace au sol.
 *
 * Une aura battle ne se joue pas sur une scene : elle se joue dans un cercle
 * que la foule dessine elle-meme, a la craie ou au ruban, et les deux
 * adversaires se placent sur leur marque. La grille neon du portage initial
 * etait jolie et ne disait rien — un quadrillage violet aurait aussi bien fait
 * un menu, un chargement ou une autre arene.
 *
 * Le repere : la texture est appliquee sur un disque couche, `u` suit l axe
 * des x du monde et `v` remonte vers le fond. Les deux marques tombent donc a
 * gauche et a droite du milieu, exactement sous les pieds des combattants.
 */
export function createFloorTexture(): CanvasTexture {
  return paintTexture(512, 512, (ctx, w, h) => {
    const cx = w / 2;
    const cy = h / 2;
    /** Rayon de la plateforme, en pixels de texture. */
    const R = w / 2;
    const rng = grain(20260920);

    ctx.clearRect(0, 0, w, h);

    // Le grain du bitume. Des taches sombres, jamais claires : le sol recoit
    // la lumiere, il ne l emet pas.
    for (let i = 0; i < 1400; i++) {
      const angle = rng() * Math.PI * 2;
      const radius = Math.sqrt(rng()) * R;
      const size = 1 + rng() * 3;
      ctx.fillStyle = `rgba(0,0,0,${(0.05 + rng() * 0.16).toFixed(3)})`;
      ctx.fillRect(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius, size, size);
    }

    // Le cercle de craie. Trace en petits arcs d epaisseur et d opacite
    // inegales : un cercle parfait se lit comme une decalcomanie, pas comme
    // un trait pose par terre a la main.
    const chalk = (radius: number, alpha: number, width: number): void => {
      const steps = 150;
      for (let i = 0; i < steps; i++) {
        const from = (i / steps) * Math.PI * 2;
        const to = ((i + 1.1) / steps) * Math.PI * 2;
        const wobble = radius + (rng() - 0.5) * 4;
        ctx.strokeStyle = withAlpha('#e8dcff', alpha * (0.45 + rng() * 0.55));
        ctx.lineWidth = width * (0.6 + rng() * 0.8);
        ctx.beginPath();
        ctx.arc(cx, cy, wobble, from, to);
        ctx.stroke();
      }
    };

    chalk(R * 0.88, 0.72, 7);
    chalk(R * 0.78, 0.22, 3);

    // La ligne de partage : chacun son cote, et le choc se joue dessus.
    ctx.lineCap = 'round';
    for (let i = 0; i < 16; i++) {
      const y = cy - R * 0.84 + (i / 15) * R * 1.68;
      const reach = Math.sqrt(Math.max(0, (R * 0.86) ** 2 - (y - cy) ** 2));
      if (reach < 6) continue;
      ctx.strokeStyle = withAlpha('#e8dcff', 0.12 + rng() * 0.1);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(cx, y);
      ctx.lineTo(cx, y + Math.min(14, reach));
      ctx.stroke();
    }

    // Les deux marques, sous les pieds. A 1,45 m du centre sur une plateforme
    // de 2,6 m de rayon, soit 0,558 du rayon : c est `scene.ts` qui pose les
    // combattants, et le sol doit tomber d accord avec lui.
    for (const side of [-1, 1]) {
      const mx = cx + side * R * 0.558;
      ctx.strokeStyle = withAlpha('#ffcf3f', 0.5);
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(mx, cy, R * 0.13, 0, Math.PI * 2);
      ctx.stroke();

      // Un chevron tourne vers l adversaire : le sol dit dans quel sens ca se
      // regarde, avant meme que les personnages soient dessines.
      ctx.strokeStyle = withAlpha('#ffcf3f', 0.34);
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(mx + side * R * 0.05, cy - R * 0.06);
      ctx.lineTo(mx - side * R * 0.02, cy);
      ctx.lineTo(mx + side * R * 0.05, cy + R * 0.06);
      ctx.stroke();
    }

    // Le halo du centre : la seule chose claire du sol, la ou l aura tombe.
    const centre = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.42);
    centre.addColorStop(0, withAlpha('#b36bff', 0.24));
    centre.addColorStop(1, withAlpha('#b36bff', 0));
    ctx.fillStyle = centre;
    ctx.fillRect(0, 0, w, h);
  });
}

/**
 * Degrade radial blanc, du centre opaque au bord transparent.
 *
 * Teinte a l affichage : une seule texture fait la lueur de tous les ecrans de
 * la foule, quelle que soit leur couleur.
 */
export function createGlowTexture(): CanvasTexture {
  return paintTexture(128, 128, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    /*
      Un coeur serre, une retombee longue.

      Un degrade lineaire du centre au bord donne une boule laiteuse : la
      lueur n a plus de source, elle n est plus qu une tache. Le palier
      rapproche garde un point net — l ecran — que le reste enveloppe.
    */
    const gradient = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.16, 'rgba(255,255,255,0.8)');
    gradient.addColorStop(0.34, 'rgba(255,255,255,0.22)');
    gradient.addColorStop(0.62, 'rgba(255,255,255,0.05)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
  });
}

/**
 * Anneau diffus, vide au centre.
 *
 * Il se pose a plat autour du cercle : la brume ne monte pas au milieu, la ou
 * les deux se tiennent, sinon elle voile ce qu on regarde. Le trou central
 * n est donc pas une economie, c est le sujet.
 */
export function createHazeTexture(): CanvasTexture {
  return paintTexture(256, 256, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    /*
      Les paliers sont donnes en part du **cote** de la texture, pas du rayon :
      un disque couche n en utilise que le cercle inscrit, donc 0,5 est le bord
      du disque et tout ce qui suit ne sera jamais echantillonne. Sur un disque
      de sept metres, le voile monte a partir du cercle (0,19), culmine a trois
      metres et demi (0,25) et s eteint avant les gradins (0,46).
    */
    const gradient = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gradient.addColorStop(0, 'rgba(255,255,255,0)');
    gradient.addColorStop(0.15, 'rgba(255,255,255,0)');
    gradient.addColorStop(0.19, 'rgba(255,255,255,0.35)');
    gradient.addColorStop(0.25, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.36, 'rgba(255,255,255,0.45)');
    gradient.addColorStop(0.46, 'rgba(255,255,255,0)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
  });
}

export function createArenaTextures(): ArenaTextures {
  return {
    floor: createFloorTexture(),
    glow: createGlowTexture(),
    haze: createHazeTexture(),
  };
}
