# ADR 0004 — Le dépôt reste sur TypeScript 6 jusqu'au support de TS 7 par typescript-eslint

- Statut : accepté
- Date : 2026-09-16

## Contexte

`pnpm add typescript` installe aujourd'hui **TypeScript 7.0**, le compilateur natif.
Le monorepo compile sans problème avec, mais `typescript-eslint` (8.70) refuse de se
charger :

```
Error: typescript-eslint does not support TS 7.0.
```

Le support est annoncé pour TS ≥ 7.1 (issue typescript-eslint#10940). Or nos règles de
lint **typées** ne sont pas décoratives : ce sont elles qui font respecter mécaniquement
la règle d'or n°2 (`packages/rules` pur et déterministe) via `no-restricted-imports`,
`no-restricted-properties` et `no-restricted-globals`. Sans elles, la contrainte redevient
une simple consigne écrite.

## Décision

Épingler `typescript@^6` à la racine du monorepo. Le gain de vitesse de TS 7 ne compense
pas la perte de l'analyse statique qui protège l'architecture.

## Conséquences

- `tsconfig.base.json` reste écrit pour l'API TS 6 ; aucune option TS 7 n'est utilisée.
- À revisiter dès que `typescript-eslint` annonce le support de TS ≥ 7.1 : il suffira alors
  de relever la version et de relancer `pnpm lint`.
- Alternative écartée : installer TS 6 en parallèle uniquement pour ESLint (deux versions
  du compilateur à maintenir, risque de divergence entre ce que voit l'éditeur, le build et
  le lint).
