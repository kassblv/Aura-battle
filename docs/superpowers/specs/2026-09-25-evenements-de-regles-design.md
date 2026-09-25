# Événements de règles — chantier n°7 (M10)

Date : 2026-09-25 · Statut : décidé sur recommandation (« continue jusqu'au
bout ») ; relisible.

## Pourquoi

Une semaine ressemble à la précédente : c'est ce qui use un jeu. Un
**événement de la semaine** change une règle de la partie rapide, et donne une
raison de revenir voir « ce qu'il y a cette semaine ». Le classé n'y touche pas :
il reste la référence.

## Règles

- **Une variante = des valeurs de `BalanceConfig`, déclarées en donnée**
  (`RULE_VARIANTS`, `@aura/rules`). Aucune variante ne change la forme du jeu (pas
  de famille interdite en v1) : elles jouent sur des nombres que l'écran sait
  déjà afficher.
  - ~~Énergie débordante~~ : **écartée après mesure** — plus d'énergie faisait
    passer « toujours le plus gros » de 75 % à 84 %. Remplacée par **Ultime
    express** : la jauge d'Ultime se remplit à 60 au lieu de 100.
  - **Semaine brillante** : la carte brillante vaut ×1,5 au lieu de ×1,2.
  - **Contres tranchants** : le contre vaut ×1,6 au lieu de ×1,35 — lire
    l'adversaire paie plus.
- **Rotation hebdomadaire déterministe** depuis le numéro de semaine UTC
  (lundi), comme la vitrine du jour : rien à stocker, rien à planifier. Une
  semaine sur deux est normale, pour que les événements restent un évènement.
- **Partie rapide seulement.** Classé et invitations jouent les règles
  normales.
- **Le serveur fait autorité** : il crée le match avec la variante de la semaine
  et l'annonce dans `match:found.rulesVariant` (protocole 2.4.0), rappelée par
  `match:state.rulesVariant` à la reprise (2.4.1). Le client
  affiche les coûts et l'énergie de CETTE variante — jamais une valeur qu'il
  aurait calculée seul.
- **Les parties à variante ne nourrissent pas le vivier de fantômes** : un
  fantôme joué avec 10 d'énergie n'a rien à faire dans une partie normale.

## Architecture

- `@aura/rules` : `RULE_VARIANTS`, `variantConfig(id)`, `weekIndexOf(ms)`,
  `variantForWeek(week)` ; correction de `match.ts:295`, qui lisait
  `BALANCE.ultimate.gaugeMax` au lieu de la config. Tests, et un passage du
  simulateur par variante (règle d'or n° 6).
- `@aura/protocol` : `match:found.rulesVariant` facultatif (2.4.0).
- Serveur : une config par match (`MatchRuntime.createMatch`), la variante de la
  semaine pour CASUAL, `rulesVariant` dans `match:found`, pas d'enregistrement
  de fantôme pour une partie à variante.
- Mobile : une config de règles portée par l'écran de match (coûts, énergie,
  multiplicateurs) au lieu de `BALANCE` importé ; bandeau « Cette semaine » à
  l'accueil, sur le choix « Partie rapide ».

## Critères d'acceptation

- [x] Variantes et rotation testées ; simulateur passé sur chaque variante (`docs/balance/2026-09-25-evenements.md`).
- [x] Une partie rapide pendant une semaine d'événement se joue avec la variante
  côté serveur (test) et l'écran montre ses coûts (test de rendu).
- [x] Classé et invitations inchangés (test).
- [x] Pas de fantôme enregistré d'une partie à variante (test).
- [x] Vérifié à l'écran (bandeau d'accueil, badge « Partie rapide », étiquette
  du HUD et bandeau d'intro contre un fantôme) ; lint, typecheck, 3 385 tests ;
  relecture de sécurité : deux points importants corrigés — la variante survit
  à une reprise (`match:state.rulesVariant`, 2.4.1), et le client ignore les
  champs inconnus (`lenient`), ce que `version.ts` promettait à tort depuis 2.1.
- [x] Relecture finale (opus) : aucun point critique ni important. Mineur
  corrigé : les nombres des événements vivent dans `EVENT_BALANCE`
  (`balance.ts`, règle d'or n° 6) et les annonces les citent (test).

## Limites connues

- Un client antérieur à 2.4.1 analyse en strict et ne comprend pas
  `match:found.rulesVariant` : sa partie rapide ne s'ouvre pas une semaine
  d'événement. Sans joueur installé, rien n'est gardé pour lui.
- Le bandeau d'accueil calcule la semaine sur l'heure serveur estimée par
  ping/pong (2026-09-26) ; avant la première mesure seulement, sur l'horloge du
  téléphone. Le match, lui, affiche toujours la variante du serveur.
