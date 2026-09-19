---
name: ship-check
description: Vérifie que le travail est prêt à être commité (format, lint, typecheck, tests, roadmap) et propose un message de commit.
disable-model-invocation: true
---

# Vérification avant commit

1. `pnpm exec prettier --check .` (si échec : `pnpm exec prettier --write .` puis revérifie).
2. `pnpm lint`
3. `pnpm typecheck`
4. `pnpm test`
5. Si des fichiers de `packages/rules` ont changé : `pnpm --filter @aura/rules test -- --coverage` et contrôle que la couverture des lignes reste ≥ 95 %.
6. Si des fichiers de `packages/content` ont changé : `pnpm --filter @aura/content validate`.
7. `git status` et `git diff --stat` : signale tout fichier inattendu (secrets, fichiers générés, `.env`).
8. Vérifie que les cases de `docs/08-roadmap.md` correspondant au travail sont cochées.

Rends un résumé : statut de chaque étape (ok / échec + cause) et un message de commit Conventional Commits. Ne commite pas et ne pousse pas sans ma demande explicite.
