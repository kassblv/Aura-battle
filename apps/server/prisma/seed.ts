import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { allAnimationIds, AURA_COLORS, AURA_EFFECTS, HAIRSTYLES, OUTFITS } from '@aura/content';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type CosmeticKind } from '@prisma/client';

/**
 * Donnees de depart : saison 1 et catalogue de cosmetiques.
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

async function main(): Promise<void> {
  await seedSeason();
  const count = await seedCosmetics();
  console.log(`[seed] saison 1 et ${count} cosmetiques en place`);
  await prisma.$disconnect();
}

void main();
