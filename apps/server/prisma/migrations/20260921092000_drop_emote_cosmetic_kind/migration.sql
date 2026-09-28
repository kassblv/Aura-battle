-- Retire `EMOTE` de `CosmeticKind`.
--
-- Les emotes ont ete retirees du jeu ; la valeur restait dans l'enum, ou elle
-- laissait croire qu'un genre de cosmetique existait encore. Aucune ligne ne
-- la porte, ni en local ni en production (verifie avant d'ecrire ceci).
--
-- Ecrite a la main : `prisma migrate dev` refuse de generer une migration
-- potentiellement destructrice sans terminal, et ce depot n'en a pas en CI.
--
-- Postgres ne sait pas retirer une valeur d'un type enum : il faut recreer le
-- type et y reconvertir la colonne. Le `USING` echouera bruyamment si une ligne
-- portait encore `EMOTE` — c'est le comportement voulu : mieux vaut une
-- migration qui s'arrete qu'une ligne silencieusement perdue.

ALTER TYPE "CosmeticKind" RENAME TO "CosmeticKind_old";

CREATE TYPE "CosmeticKind" AS ENUM ('ANIMATION', 'AURA_EFFECT', 'AURA_COLOR', 'OUTFIT', 'HAIR', 'BANNER');

ALTER TABLE "CosmeticItem"
  ALTER COLUMN "kind" TYPE "CosmeticKind" USING ("kind"::text::"CosmeticKind");

DROP TYPE "CosmeticKind_old";
