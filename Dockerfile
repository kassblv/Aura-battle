# Image de production d'Aura Battle : le serveur de match, qui sert aussi le
# client. Un seul conteneur — voir docs/adr/0012-deploiement-coolify.md.

# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# 1. Dependances
# ---------------------------------------------------------------------------
# Node 22 : le `engines` du depot l'exige, et `process.loadEnvFile` — dont
# dependent `main.ts` et `prisma.config.ts` — est natif depuis Node 20.
FROM node:22-slim AS deps
WORKDIR /repo

# OpenSSL : le moteur de requetes Prisma en a besoin, et l'image `slim` ne
# l'embarque pas. Sans lui, `prisma migrate deploy` echoue au demarrage sur un
# message de bibliotheque manquante, loin de la cause.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# pnpm par corepack, a la version que le depot epingle : `packageManager` fait
# foi, ici comme sur la machine de chacun.
RUN corepack enable

# pnpm 11 refuse de purger `node_modules` sans terminal, et une construction
# Docker n'en a pas : sans cette variable, l'etape des dependances de
# production s'arrete sur une question que personne ne peut lire.
ENV CI=true

# Seuls les manifestes d'abord : tant qu'aucune dependance ne bouge, Docker
# reutilise cette couche et l'installation complete est sautee.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/mobile/package.json apps/mobile/
COPY packages/rules/package.json packages/rules/
COPY packages/protocol/package.json packages/protocol/
COPY packages/content/package.json packages/content/

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
  pnpm config set store-dir /pnpm/store \
  && pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# 2. Construction
# ---------------------------------------------------------------------------
FROM deps AS build
WORKDIR /repo

COPY . .

# Le client d'abord, le serveur ensuite : `turbo run build` suit les
# dependances de l'espace de travail, donc les paquets partages sont compiles
# avant ceux qui les consomment.
# `prisma generate` ne touche aucune base — il lit le schema et ecrit un
# client. Mais `prisma.config.ts` evalue `env('DATABASE_URL')` a l'import, donc
# la commande refuse de demarrer sans elle.
#
# L'URL est donc donnee POUR CETTE COMMANDE SEULE, jamais en `ENV` : une URL
# de construction restee dans l'image serait une valeur par defaut credible et
# fausse, exactement le genre que `loadConfig` refuse d'inventer. Et elle
# pointe volontairement vers nulle part — si quoi que ce soit essayait de s'en
# servir, l'echec serait immediat et bruyant plutot que silencieux.
RUN DATABASE_URL='postgresql://build:build@127.0.0.1:1/build' \
  pnpm --filter server exec prisma generate
RUN pnpm build

# Le client construit n'a aucune adresse de serveur en dur : il parle a
# l'origine qui l'a servi. C'est ce qui permet a la meme image de tourner
# derriere n'importe quel domaine sans etre reconstruite.

# ---------------------------------------------------------------------------
# 3. Dependances de production seules
# ---------------------------------------------------------------------------
# Base PROPRE, et non `FROM deps`.
#
# Une installation `--prod` faite par-dessus une installation complete ne
# rend pas l'image plus petite : pnpm defait les liens du dossier
# `node_modules`, mais les paquets eux-memes restent dans `node_modules/.pnpm`,
# qui appartient deja a la couche precedente. Turbo, TypeScript et Three.js
# pesaient ainsi cent megaoctets dans une image qui ne les execute jamais.
# Repartir de zero est la seule facon de ne pas les embarquer.
FROM node:22-slim AS prod-deps
WORKDIR /repo

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable
ENV CI=true

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/mobile/package.json apps/mobile/
COPY packages/rules/package.json packages/rules/
COPY packages/protocol/package.json packages/protocol/
COPY packages/content/package.json packages/content/

# `--filter server...` : le serveur et les paquets de l'espace de travail dont
# il depend, rien d'autre. Le client est livre deja construit, ses dependances
# n'ont aucune raison d'etre la.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
  pnpm config set store-dir /pnpm/store \
  && pnpm install --frozen-lockfile --prod --ignore-scripts --filter server...

# Le client Prisma est genere ICI plutot que repris de l'etape de
# construction.
#
# pnpm le depose au fond du magasin
# (`node_modules/.pnpm/@prisma+client@<version>_<hachage>/node_modules/.prisma`),
# un chemin qui contient le hachage des dependances et change des qu'elles
# bougent : le copier d'une etape a l'autre reviendrait a coder ce hachage en
# dur dans le Dockerfile. Le regenerer sur l'arbre de production, en revanche,
# le met exactement la ou ce meme arbre ira le chercher.
COPY apps/server/prisma apps/server/prisma
COPY apps/server/prisma.config.ts apps/server/

RUN DATABASE_URL='postgresql://build:build@127.0.0.1:1/build' \
  pnpm --filter server exec prisma generate

# ---------------------------------------------------------------------------
# 4. Image finale
# ---------------------------------------------------------------------------
FROM node:22-slim AS runtime
WORKDIR /repo

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable

ENV NODE_ENV=production
ENV PORT=3000
# Le client vit a cote du serveur dans l'image : `main.ts` le sert depuis la.
ENV CLIENT_DIR=/repo/client

COPY --from=prod-deps /repo/node_modules ./node_modules
COPY --from=prod-deps /repo/apps/server/node_modules ./apps/server/node_modules
COPY --from=prod-deps /repo/packages ./packages

COPY package.json pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/prisma.config.ts apps/server/
COPY apps/server/prisma apps/server/prisma
# Les sources du serveur, pour le SEUL amorcage.
#
# `prisma/seed.ts` importe la politique de fantomes depuis `src/` et tourne
# sous `tsx`, donc sur les sources. Compiler le seed a part demanderait une
# seconde configuration TypeScript dont le seul role serait de diverger de la
# premiere ; sept cents kilo-octets de sources a cote de six cents megaoctets
# d'image est le meilleur des deux echanges, et ca garantit que l'amorcage se
# comporte en production exactement comme en developpement.
COPY apps/server/src apps/server/src

COPY --from=build /repo/apps/server/dist apps/server/dist
COPY --from=build /repo/packages/rules/dist packages/rules/dist
COPY --from=build /repo/packages/protocol/dist packages/protocol/dist
COPY --from=build /repo/packages/content/dist packages/content/dist
# Le catalogue d'animations est de la DONNEE, pas du code : il n'est pas
# compile et doit etre copie tel quel (regle d'or n°5).
COPY --from=build /repo/packages/content/animations packages/content/animations
COPY --from=build /repo/apps/mobile/dist ./client

COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Pas de root. Le noeud n'ecrit rien sur le disque : tout son etat vit dans
# Postgres et Redis.
USER node

EXPOSE 3000

# Le healthcheck interroge la meme route que Coolify : si la base ou Redis
# manquent, le conteneur se declare malade au lieu de servir des erreurs.
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["node", "apps/server/dist/main.js"]
