# ADR 0001 — Serveur autoritaire et règles partagées

- Statut : acceptée
- Date : 2026-09-16

## Contexte

Le jeu vise d'abord le PvP classé sur mobile. Les scores dépendent de taps et de timings saisis sur le téléphone, faciles à falsifier. Les choix sont simultanés et secrets.

## Décision

- Le serveur calcule tous les résultats. Le client envoie uniquement des intentions horodatées relativement au début de phase.
- La logique vit dans `@aura/rules`, un package pur et déterministe utilisé par le serveur (vérité) et le client (prévisualisation, solo hors ligne, rejeu).
- Pas de lockstep ni de prédiction : le jeu est au tour par tour avec échéances, la latence n'influence que la validation des instants.

## Conséquences

- Une seule implémentation des règles, testable sans réseau, simulable en masse.
- La triche sur les scores devient impossible ; la triche sur la précision reste possible et est traitée par plafonds et détection (voir `06-anti-cheat.md`).
- Chaque changement de règles implique une `rulesVersion`, et le serveur ne mélange jamais deux versions dans un match.
