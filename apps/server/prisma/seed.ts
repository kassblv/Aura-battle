import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { allAnimationIds, AURA_COLORS, AURA_EFFECTS, HAIRSTYLES, OUTFITS } from '@aura/content';
import { RULES_VERSION } from '@aura/rules';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type CosmeticKind, type Prisma } from '@prisma/client';
import { SEED_GHOST_PREFIX } from '../src/modules/matchmaking/domain/ghost.js';
import { buildSeedGhosts } from '../src/modules/matchmaking/domain/ghost-seeding.js';

/**
 * Donnees de depart : saison 1, catalogue de cosmetiques, vivier de fantomes.
 *
 * Idempotent — on peut le relancer sans dupliquer quoi que ce soit. Un seed qui
 * ne peut etre joue qu'une fois est un seed qu'on n'ose plus lancer.
 */

try {
  process.loadEnvFile(new URL('../../../.env', import.meta.url));
} catch {
  // En CI, les variables viennent de l'environnement.
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' }),
});

/** Chaque animation porte sa rarete dans son fichier JSON. */
function animationRarity(id: string): string {
  const [, style, tier, slug] = id.split('.');
  const folder = style === 'system' ? 'system' : style;
  const path = fileURLToPath(
    new URL(`../../../packages/content/animations/${folder}/${slug}.json`, import.meta.url),
  );
  const animation = JSON.parse(readFileSync(path, 'utf8')) as { rarity?: string };
  void tier;
  return animation.rarity ?? 'default';
}

async function seedSeason(): Promise<void> {
  const startsAt = new Date('2026-09-01T00:00:00Z');
  await prisma.season.upsert({
    where: { number: 1 },
    update: {},
    create: {
      number: 1,
      startsAt,
      // Huit semaines, le rythme annonce dans docs/07 pour un passe de saison.
      endsAt: new Date(startsAt.getTime() + 8 * 7 * 24 * 60 * 60 * 1_000),
    },
  });
}

async function seedCosmetics(): Promise<number> {
  const items: { id: string; kind: CosmeticKind; rarity: string; priceSoft: number }[] = [
    ...allAnimationIds().map((id) => ({
      id,
      kind: 'ANIMATION' as const,
      rarity: animationRarity(id),
      priceSoft: 0,
    })),
    ...AURA_EFFECTS.map((effect) => ({
      id: effect.id,
      kind: 'AURA_EFFECT' as const,
      rarity: effect.rarity,
      priceSoft: effect.price,
    })),
    ...AURA_COLORS.map((color) => ({
      id: color.id,
      kind: 'AURA_COLOR' as const,
      rarity: color.price === 0 ? 'default' : 'common',
      priceSoft: color.price,
    })),
    ...HAIRSTYLES.map((hair) => ({
      id: hair.id,
      kind: 'HAIR' as const,
      rarity: hair.price === 0 ? 'default' : 'common',
      priceSoft: hair.price,
    })),
    ...OUTFITS.map((outfit) => ({
      id: outfit.id,
      kind: 'OUTFIT' as const,
      rarity: outfit.price === 0 ? 'default' : 'common',
      priceSoft: outfit.price,
    })),
  ];

  for (const item of items) {
    await prisma.cosmeticItem.upsert({
      where: { id: item.id },
      update: { kind: item.kind, rarity: item.rarity, priceSoft: item.priceSoft },
      create: item,
    });
  }
  return items.length;
}

/**
 * Date d'ecriture des enregistrements amorces, volontairement dans le passe.
 *
 * `PrismaGhostStore.candidates` rapatrie les plus **recents** d'abord, dans une
 * limite bornee : dater l'amorcage d'hier suffit a ce que tout enregistrement
 * reel passe devant, et a ce que les amorces sortent d'eux-memes de la fenetre
 * de candidats des que le vivier reel est fourni. C'est le premier des deux
 * mecanismes de retrait ; le second, qui est la vraie garantie, vit dans
 * `selectGhost` — un fantome amorce n'est jamais prefere a un fantome humain.
 */
const SEED_GHOST_CREATED_AT = new Date('2020-01-01T00:00:00Z');

/**
 * Vivier de fantomes de depart (docs/05 § « Fantomes »).
 *
 * Sans lui, la fonctionnalite qui existe pour empecher une file vide ne marche
 * pas le jour du lancement, quand la file est vide : un enregistrement ne nait
 * que d'un match classe entre humains, et il n'y en a encore aucun.
 *
 * Le contenu est **calcule**, pas ecrit a la main : `buildSeedGhosts` fait
 * jouer les profils de l'IA solo par le vrai moteur. Remplacer toute la
 * reserve a chaque passage garde le seed idempotent et rend la mise a jour
 * apres un changement de `RULES_VERSION` triviale — c'est la meme commande.
 */
async function seedGhosts(): Promise<number> {
  const recordings = buildSeedGhosts(RULES_VERSION);

  await prisma.$transaction([
    // Les amorces d'une version precedente n'ont plus d'usage : `selectGhost`
    // exige l'egalite des versions, elles ne seraient plus jamais choisies.
    prisma.ghostRecording.deleteMany({ where: { playerId: { startsWith: SEED_GHOST_PREFIX } } }),
    prisma.ghostRecording.createMany({
      data: recordings.map((recording) => ({
        playerId: recording.playerId,
        mmr: recording.mmr,
        rulesVersion: recording.rulesVersion,
        rounds: recording.rounds as unknown as Prisma.InputJsonValue,
        createdAt: SEED_GHOST_CREATED_AT,
      })),
    }),
  ]);

  return recordings.length;
}

async function main(): Promise<void> {
  await seedSeason();
  const count = await seedCosmetics();
  const ghosts = await seedGhosts();
  console.log(
    `[seed] saison 1, ${count} cosmetiques et ${ghosts} fantomes d'amorcage (regles ${RULES_VERSION}) en place`,
  );
  await prisma.$disconnect();
}

void main();
