# ADR 0007 — Prisma reste sur la dernière version stable, pas sur `latest`

- Statut : accepté
- Date : 2026-09-17

## Contexte

`pnpm add prisma` installe la version marquée `latest` sur npm, soit **8.0.0-rc.15** :
une *release candidate*. Le CLI de la v8 est entièrement redessiné — `prisma format` et
`prisma validate` n'existent plus, remplacés par `contract`, `db verify/sign/update` et une
plateforme de déploiement (`project`, `deploy`, `service`). Le tag `prev` pointe sur
**7.10.0**, dernière version stable, qui conserve le flux classique `migrate dev`.

## Décision

Épingler `prisma` et `@prisma/client` sur **7.10.0**.

## Conséquences

- Le flux documenté dans `CLAUDE.md` (`pnpm --filter server prisma migrate dev`) reste valable.
- Une RC peut changer de forme entre deux publications ; bâtir le jalon M3 dessus reviendrait à
  accepter une réécriture de la couche données à chaque mise à jour.
- À revisiter quand la 8.x sera stable : la migration demandera de convertir le schéma PSL et
  de reprendre les commandes de migration, donc un jalon à part entière, pas une montée de
  version en passant.
- Même raisonnement que l'ADR 0004 sur TypeScript : `latest` est une information sur la date de
  publication, pas sur la maturité.
