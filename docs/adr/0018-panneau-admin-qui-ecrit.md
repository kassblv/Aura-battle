# 0018 — Le panneau d'administration écrit, et chaque écriture laisse une trace

Date : 2026-09-26 · Statut : accepté.

## Contexte

Le panneau `/admin` était **en lecture seule par principe** : « un panneau qui
agit est une porte de plus, et celle-ci serait la plus intéressante du
système ». Ce principe a tenu tant qu'il n'y avait rien à régler. Il y a
maintenant des expériences (drapeaux), un événement hebdomadaire, des joueurs à
écarter, et bientôt un catalogue vivant : sans écriture, chaque réglage demande
un redéploiement — ou n'existe pas (`Player.bannedUntil` n'était lu nulle part).

## Décision

- **Le panneau écrit**, derrière le même secret `ADMIN_TOKEN` (404 sans lui,
  comparaison à temps constant), avec des **essais limités en débit**.
- **Application séparée `apps/admin`** (Vite + React), servie par Nest sous
  `/admin`. Le code d'administration n'entre jamais dans le paquet des joueurs.
- **Toute écriture est journalisée** dans `AdminAction` (action, cible, avant,
  après, motif, instant), **dans la même transaction** que l'écriture : une
  écriture sans trace n'a pas lieu.
- **Contrat zod partagé** (`@aura/protocol`, `admin.ts`) : validé à l'entrée,
  utilisé par l'application.
- **Les écritures passent par les règles du jeu**, jamais à côté : une variante
  forcée est une de `RULE_VARIANTS`, une part est bornée, un changement de part
  ouvre une nouvelle mesure.

## Conséquences

- La porte existe : le secret admin devient la clé la plus précieuse du
  système. Il doit être long, unique et rangé comme les autres secrets
  (`docs/10`) ; sa fuite permettrait de bannir des joueurs et de régler le jeu —
  pas de créditer de l'argent (aucune route ne touche aux portefeuilles).
- Un seul secret : le journal dit **quoi**, pas **qui**. Des comptes
  administrateurs nommés viendront quand il y aura plus d'une personne.
- Une application de plus à construire dans l'image (`Dockerfile`).
