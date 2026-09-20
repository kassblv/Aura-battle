#!/bin/sh
# Point d'entree du conteneur de production.
#
# Les migrations tournent ICI, pas dans l'image : une image est construite une
# fois et peut demarrer sur n'importe quelle base. Les jouer a la construction
# figerait l'etat d'une base dans un artefact censé etre reutilisable.
set -eu

echo "aura: migration de la base"
cd /repo/apps/server

# `migrate deploy`, jamais `migrate dev` : `deploy` applique les migrations
# deja ecrites et ne genere rien. `dev` peut decider de REINITIALISER la base
# quand l'historique ne correspond pas — sur une base de production, c'est la
# perte de tout.
node_modules/.bin/prisma migrate deploy

# Le seed tourne a CHAQUE demarrage, et c'est voulu.
#
# Il est idempotent : upserts pour la saison et le catalogue, suppression
# ciblee des seuls fantomes d'amorcage avant de les reecrire. Le jouer une
# seule fois, a la main, laisserait tout nouvel environnement demarrer sans
# saison, sans catalogue et surtout sans vivier de fantomes — et les premiers
# joueurs attendraient un adversaire qui ne vient jamais, parce que la file est
# vide le jour du lancement. C'est precisement le cas que le vivier existe pour
# couvrir (docs/05, jalon M5).
echo "aura: amorcage des donnees"
node_modules/.bin/prisma db seed

cd /repo
echo "aura: demarrage du serveur"
exec "$@"
