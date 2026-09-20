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

cd /repo
echo "aura: demarrage du serveur"
exec "$@"
