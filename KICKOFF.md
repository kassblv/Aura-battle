# Prompts de lancement

Copie ces prompts dans Claude Code, un par session. Lance chaque session à la racine du dépôt. Pour les tâches importantes, passe en **mode plan** avant d'envoyer le prompt, puis valide le plan.

## Session 1 — Mise en place (jalon M0)

```
Lis CLAUDE.md puis docs/08-roadmap.md (jalon M0) et docs/02-architecture.md.
Mets en place le monorepo décrit : pnpm workspaces, Turborepo, TypeScript strict, ESLint, Prettier, Vitest,
docker-compose (Postgres 16 + Redis 7), CI GitHub Actions (lint, typecheck, test).
Crée les packages vides @aura/rules, @aura/protocol, @aura/content et les apps server et mobile avec un test qui passe dans chacun.
Propose d'abord le plan, puis implémente. Termine par /ship-check et coche M0 dans la roadmap.
```

## Session 2 — Moteur de règles (jalon M1)

```
/next-milestone
```
Le jalon M1 est le plus important : tout le PvP repose dessus. Exige une couverture de tests élevée et des tests de propriétés. Demande ensuite :
```
Utilise l'agent balance-analyst pour lancer /balance-sim sur 10 000 matchs et résume les déséquilibres.
```

## Session 3 — Protocole et contenu (jalon M2)

```
/next-milestone
```
puis
```
/port-prototype animations
```

## Session 4 et suivantes

```
/next-milestone
```
Après chaque jalon qui touche au serveur ou au protocole :
```
Demande à l'agent security-reviewer de relire les changements de cette branche et corrige ce qui est bloquant.
```

## Prompts utiles à tout moment

- Tester le PvP en local à deux : `Lance le serveur et deux clients mobiles dans le navigateur, et donne-moi les étapes pour jouer un match par code d'invitation.`
- Nouvelle danse tendance : `/add-dance` puis décris la danse (style, palier, mouvement).
- Vérifier l'équilibre après un changement : `/balance-sim`
- Avant un commit : `/ship-check`
