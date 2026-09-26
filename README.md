# Aura Battle — kit de démarrage pour Claude Code

Ce dossier prépare Claude Code à développer **Aura Battle**, un jeu mobile de duels d'aura centré sur le **PvP en ligne**.

## Contenu

| Élément | Rôle |
|---|---|
| `CLAUDE.md` | Mémoire projet chargée à chaque session : règles d'or, stack, commandes, façon de travailler |
| `docs/` | Game design chiffré, architecture, protocole PvP, données, matchmaking, anti-triche, contenu, roadmap, tests, ADR |
| `docs/content/animation.schema.json` | Schéma JSON des animations (danses et poses) |
| `prototype/aura-battle.html` | Prototype jouable actuel, référence de ressenti et de rendu 3D |
| `.claude/settings.json` | Permissions partagées et hook de formatage automatique |
| `.claude/agents/` | 5 sous-agents spécialisés |
| `.claude/skills/` | 6 skills (commandes `/...` et consignes chargées automatiquement) |
| `KICKOFF.md` | Les prompts à utiliser, session par session |

## Démarrer

Prérequis : Node.js 22 LTS, pnpm 11, Docker, Git. Plus tard : Xcode (iOS) et Android Studio (Android).

```bash
pnpm install
cp .env.example .env
docker compose up -d          # Postgres 16 + Redis 7
pnpm dev                      # serveur + client en parallèle
```

Le client de développement écoute sur `0.0.0.0:5173` : il est donc joignable depuis un
téléphone sur le même Wi-Fi, via `http://<IP-du-Mac>:5173`.

### Vérifications

```bash
pnpm build        # compile les 5 packages (turbo respecte l'ordre des dépendances)
pnpm typecheck    # tsc --noEmit partout
pnpm test         # Vitest
pnpm lint         # ESLint à la racine, une seule config pour tout le dépôt
pnpm format:check # Prettier (la doc et le prototype sont exclus)
pnpm sim          # simulateur d'équilibrage (jalon M1)
```

### Organisation du code

| Chemin | Rôle |
|---|---|
| `packages/rules` | Moteur de règles **pur** : ni Node, ni DOM, ni horloge, ni hasard. `src/` compile sans les types Node, et ESLint bloque `Math.random`, `Date.now` et les imports Node. Le CLI de simulation vit à côté, dans `sim/`. |
| `packages/protocol` | Schémas zod des messages client⇄serveur — source de vérité unique des deux côtés |
| `packages/content` | Animations et cosmétiques en JSON + validateur (`cli/`) |
| `apps/server` | API REST et temps réel (NestJS à partir du jalon M3) |
| `apps/mobile` | Client Vite + React + Three.js, puis Capacitor |

Chaque package a deux `tsconfig` : `tsconfig.json` (typecheck, couvre aussi les tests et
les CLI) et `tsconfig.build.json` (émission vers `dist/`, sans les tests).

## Principe de travail

La roadmap (`docs/08-roadmap.md`) est découpée en jalons avec des critères d'acceptation cochables. À chaque session, `/next-milestone` prend la prochaine tâche non cochée, propose un plan, l'implémente avec des tests, vérifie, puis coche la roadmap. Tu restes le décideur : valide les plans et relis les diffs, surtout sur le serveur et le protocole.
# Aura-battle
