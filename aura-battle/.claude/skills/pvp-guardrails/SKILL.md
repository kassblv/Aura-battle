---
name: pvp-guardrails
description: Garde-fous à appliquer automatiquement dès qu'on écrit ou modifie du code serveur, du protocole réseau, la validation des taps et timings, le matchmaking ou le client réseau d'Aura Battle.
user-invocable: false
---

# Garde-fous PvP

Avant de terminer un changement qui touche au temps réel, vérifie chaque point :

- [ ] Aucune règle réimplémentée hors de `@aura/rules`.
- [ ] Messages entrants et sortants validés par `@aura/protocol`.
- [ ] Aucun envoi du choix, du timing, de la recharge, de l'énergie ou de la jauge adverse avant `round:result` (logs et erreurs compris).
- [ ] Aucune valeur calculée par le client acceptée (score, qualité, points, coût).
- [ ] Phase, échéance, `seq`, appartenance au match vérifiés.
- [ ] Instants client relatifs au début de phase ; tolérances du protocole appliquées ; aucune comparaison directe d'horloges.
- [ ] Taps : orbe vivante, ordre croissant, plafond 12/s, tableau borné.
- [ ] Timers annulés à la fin du match et au forfait ; aucune fuite mémoire d'un match terminé.
- [ ] Reconnexion : `match:rejoin` renvoie un `match:state` sans information cachée.
- [ ] Tests e2e ajoutés ou mis à jour pour le scénario touché.
- [ ] Relecture demandée à `security-reviewer`.
