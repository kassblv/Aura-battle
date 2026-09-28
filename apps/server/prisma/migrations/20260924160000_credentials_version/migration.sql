-- Un compteur remplace la date : une date se compare a la seconde pres (`iat`)
-- et laissait une fenetre a l'intrus chasse (ADR 0013). La colonne supprimee
-- n'a jamais quitte le developpement.
ALTER TABLE "Player" DROP COLUMN "credentialsChangedAt";
ALTER TABLE "Player" ADD COLUMN "credentialsVersion" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "RefreshToken" ADD COLUMN "credentialsVersion" INTEGER NOT NULL DEFAULT 0;
