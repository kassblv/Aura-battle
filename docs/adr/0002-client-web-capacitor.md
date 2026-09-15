# ADR 0002 — Client web (React + Three.js) emballé avec Capacitor

- Statut : acceptée pour la phase 1, à réévaluer après les indicateurs de `00-vision.md`
- Date : 2026-09-16

## Contexte

Un prototype web avec rendu Three.js existe déjà. L'objectif est de sortir vite pendant la tendance tout en préservant la possibilité d'une version plus ambitieuse.

## Décision

- Client Vite + React (écrans) + Three.js (arène), emballé avec Capacitor pour iOS et Android.
- Le rendu est isolé dans `apps/mobile/src/arena` et piloté par des événements de match, sans logique de jeu.

## Alternatives écartées pour la phase 1

- **Unity / Godot :** meilleur outillage d'animation et de performance, mais réécriture complète et délai incompatible avec la tendance.
- **React Native + moteur 3D :** complexité d'intégration 3D sans gain décisif.

## Conséquences

- Réutilisation directe du prototype (rig, foule, particules, audio).
- Risque de performance sur appareils modestes : niveaux de qualité obligatoires (M6).
- En cas de migration future vers un moteur de jeu, `@aura/rules`, `@aura/protocol`, `@aura/content` et le serveur restent inchangés ; seul le client est réécrit (les règles pourraient alors être portées en C# ou GDScript avec les mêmes vecteurs de test).
