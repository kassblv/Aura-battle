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
  et l'annonce dans `match:found.rulesVariant` (protocole 2.4.0). Le client
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
- [ ] Une partie rapide pendant une semaine d'événement se joue avec la variante
  côté serveur (test) et l'écran montre ses coûts (test de rendu).
- [ ] Classé et invitations inchangés (test).
- [ ] Pas de fantôme enregistré d'une partie à variante (test).
- [ ] Vérifié à l'écran ; lint, typecheck, tests ; relecture de sécurité
  (serveur et protocole) et relecture finale.
