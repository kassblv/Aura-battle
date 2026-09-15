# 09 — Tests et équilibrage

## Pyramide

| Niveau | Outil | Cible |
|---|---|---|
| Unitaire | Vitest | `@aura/rules` (≥ 95 % lignes), `@aura/protocol`, services du serveur |
| Propriétés | fast-check | Invariants des règles (déterminisme, bornes, fin de match) |
| Contrat | Vitest + zod | Chaque message émis par le serveur passe son schéma |
| Intégration | Testcontainers | Repositories Prisma, file Redis |
| E2E temps réel | Serveur réel + 2 clients Socket.IO | Scénarios de match complets |
| Rendu | Vitest + snapshot numérique | `AnimationPlayer` : positions d'articulations à des instants donnés |
| Charge | k6 (WebSocket) ou Artillery | Matchs simultanés, latence de traitement |
| Manuel | Checklist | Ressenti, lisibilité, sons, haptique |

## Invariants à tester en propriétés

- Même graine + même suite d'événements ⇒ même état final (octet pour octet).
- L'énergie reste dans [0, 14] ; la jauge d'Ultime dans [0, 100].
- Un choix dont le coût dépasse l'énergie est refusé sans modifier l'état.
- Tout match se termine en 3 manches maximum, avec au plus un vainqueur.
- Un message `round:result` n'est émis qu'après verrouillage des deux joueurs ou échéance.
- Aucun message envoyé à un siège avant `round:result` ne contient le choix de l'autre siège.

## Scénarios e2e obligatoires

1. Match complet 2–0 et 2–1.
2. Un joueur ne verrouille pas : action par défaut, pas de blocage.
3. Déconnexion pendant la recharge, reconnexion pendant le choix.
4. Déconnexion définitive : forfait après 45 s.
5. Choix trop cher, Ultime non prête, double verrouillage : erreurs attendues.
6. Taps impossibles (orbe morte, 30 taps/s) : ignorés et signalés.
7. Client d'une version majeure différente : `CLIENT_OUTDATED`.

## Équilibrage par simulation

`pnpm sim` fait jouer des stratégies entre elles et produit :

- Taux de victoire par stratégie et par paire de stratégies.
- Taux de victoire par style joué et par palier, à énergie égale.
- Répartition des matchs 2–0 / 2–1, taux de manches nulles.
- Valeur moyenne d'un point d'énergie selon la manche.
- Impact du timing : écart de taux de victoire entre un joueur « 60 % parfaits » et « 20 % parfaits ».

### Seuils d'alerte

| Mesure | Zone saine |
|---|---|
| Taux de victoire d'un style à niveau égal | 47–53 % |
| Meilleure stratégie contre l'aléatoire | ≤ 80 % |
| Stratégie « tout sur une manche » contre « économe » | 40–60 % |
| Manches nulles | ≤ 3 % |
| Matchs en 3 manches | 30–55 % |
| Avantage d'un bon timeur (60 % vs 20 % de parfaits) | 60–75 % de victoires |

Chaque ajustement de `balance.ts` s'accompagne d'un rapport de simulation avant/après dans `docs/balance/AAAA-MM-JJ-sujet.md`.
