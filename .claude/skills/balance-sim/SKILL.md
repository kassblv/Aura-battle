---
name: balance-sim
description: Lance la simulation d'équilibrage de packages/rules et compare les résultats aux seuils de docs/09-testing.md.
---

# Simulation d'équilibrage

Argument optionnel : nombre de matchs (défaut 10000) et stratégies (défaut `all`).

1. Lance `pnpm sim --matches <N> --strategy <S> --seed 42 --out docs/balance/last-run.json`.
2. Lis le rapport et remplis ce tableau :

| Mesure | Valeur | Zone saine | Statut |
| ------ | ------ | ---------- | ------ |

3. Compare aux seuils de « Équilibrage par simulation » dans `docs/09-testing.md`.
4. Si un seuil est dépassé, délègue l'analyse à l'agent `balance-analyst` et rapporte ses propositions sans modifier `balance.ts`.
5. Si `pnpm sim` n'existe pas encore, indique que le jalon M1 doit d'abord être terminé.
