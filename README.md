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

1. Installe Claude Code en suivant la documentation officielle : https://code.claude.com/docs/en/overview
2. Crée le dépôt à partir de ce dossier :
   ```bash
   cd aura-battle
   git init && git add . && git commit -m "chore: bootstrap Claude Code kit"
   ```
3. Lance `claude` à la racine du dossier, puis suis `KICKOFF.md`.

Prérequis sur ta machine : Node.js 22 LTS, pnpm, Docker, Git. Plus tard : Xcode (iOS) et Android Studio (Android).

## Principe de travail

La roadmap (`docs/08-roadmap.md`) est découpée en jalons avec des critères d'acceptation cochables. À chaque session, `/next-milestone` prend la prochaine tâche non cochée, propose un plan, l'implémente avec des tests, vérifie, puis coche la roadmap. Tu restes le décideur : valide les plans et relis les diffs, surtout sur le serveur et le protocole.
# Aura-battle
