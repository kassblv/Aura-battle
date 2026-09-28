---
name: next-milestone
description: Prend la prochaine tâche non cochée de la roadmap, la planifie, l'implémente avec tests, vérifie et coche la roadmap.
disable-model-invocation: true
---

# Livrer la prochaine tâche de la roadmap

Argument optionnel : identifiant de jalon (ex. `M3`). Sans argument, prends le premier jalon non terminé de `docs/08-roadmap.md`.

1. **Choisir.** Lis le jalon dans `docs/08-roadmap.md`. Sélectionne un lot cohérent de cases non cochées (une demi-journée de travail humain au plus). Annonce le lot choisi.
2. **Se documenter.** Lis uniquement les documents de référence cités par le jalon et le code existant concerné.
3. **Planifier.** Présente un plan court : fichiers créés ou modifiés, tests prévus, risques, questions ouvertes. Si le lot touche plus de 3 fichiers ou implique un choix d'architecture, **attends ma validation**.
4. **Déléguer si pertinent.**
   - Règles de jeu → agent `rules-engineer`.
   - Serveur, protocole, matchmaking → agent `netcode-engineer`.
   - Rendu, animation, écrans → agent `client-3d-engineer`.
5. **Implémenter** en commençant par les tests quand le jalon concerne `packages/rules`, `packages/protocol` ou le module match.
6. **Vérifier** avec le skill `ship-check`. Corrige jusqu'à ce que tout passe.
7. **Relire.** Si des fichiers de `apps/server`, `packages/protocol` ou la validation des taps ont changé, fais relire par l'agent `security-reviewer` et corrige les points bloquants.
8. **Clore.** Coche les cases terminées dans `docs/08-roadmap.md`. Mets à jour le document de référence si le comportement a changé, et crée un ADR pour toute décision d'architecture.
9. **Résumer** en 5 lignes au plus : ce qui est livré, ce qui reste dans le jalon, la prochaine tâche suggérée, et un message de commit au format Conventional Commits.
