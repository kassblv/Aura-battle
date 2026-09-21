#!/bin/sh
# Sauvegarde de la base d'Aura Battle.
#
# Pose par cron sur le serveur qui heberge la pile (ADR 0012). Ce fichier est
# la source : il vit dans le depot pour etre relu, et se reinstalle avec
# `docker/install-backup.sh`.
#
# UNE SAUVEGARDE QUI ECHOUE EN SILENCE EST PIRE QUE PAS DE SAUVEGARDE : on
# croit etre protege. Chaque etape echoue donc bruyamment, et le resultat est
# verifie avant d'etre garde.
set -eu

DEST="${AURA_BACKUP_DIR:-/var/backups/aura}"
KEEP_DAYS="${AURA_BACKUP_KEEP_DAYS:-14}"
# Un dump de cette base pese plusieurs kilo-octets des la premiere migration.
# En dessous, ce n'est pas une petite base : c'est un dump rate.
MIN_BYTES="${AURA_BACKUP_MIN_BYTES:-2048}"

log() { echo "[aura-backup] $(date -Iseconds) $*"; }
fail() { log "ECHEC : $*"; exit 1; }

# Le conteneur est nomme par Coolify avec un suffixe qui CHANGE a chaque
# deploiement : le chercher par son nom exact casserait a la premiere mise en
# ligne, et la sauvegarde s'arreterait sans que personne ne le remarque.
container=$(docker ps --filter 'name=^postgres-' --format '{{.Names}}' \
  | grep -- '-crrszaajyehq0tqnzv1ccpnf-' || true)
[ -n "$container" ] || fail "conteneur Postgres d'Aura Battle introuvable"

mkdir -p "$DEST"
stamp=$(date -u +%Y%m%d-%H%M%S)
tmp="$DEST/.aura-$stamp.sql.gz.part"
out="$DEST/aura-$stamp.sql.gz"

log "dump depuis $container"
# `--clean --if-exists` : le dump sait se reposer sur une base non vide, ce qui
# est le cas d'une restauration d'urgence.
if ! docker exec "$container" pg_dump -U aura --clean --if-exists aura | gzip -9 > "$tmp"; then
  rm -f "$tmp"
  fail "pg_dump a echoue"
fi

size=$(wc -c < "$tmp")
if [ "$size" -lt "$MIN_BYTES" ]; then
  rm -f "$tmp"
  fail "dump trop petit ($size octets) — la base est-elle joignable ?"
fi

# Le gzip est relu en entier : un fichier tronque par un disque plein se lit
# comme un fichier valide jusqu'a son dernier octet.
gzip -t "$tmp" || { rm -f "$tmp"; fail "archive illisible"; }

mv "$tmp" "$out"
log "sauvegarde $out ($size octets)"

# Purge APRES le succes, jamais avant : une purge d'abord laisserait, le jour
# ou le dump echoue, une machine sans aucune sauvegarde.
find "$DEST" -name 'aura-*.sql.gz' -type f -mtime "+$KEEP_DAYS" -delete
kept=$(find "$DEST" -name 'aura-*.sql.gz' -type f | wc -l)
log "conservees : $kept"

# Marqueur du dernier succes : c'est lui qu'une supervision lit, parce qu'un
# fichier recent prouve qu'une sauvegarde a REUSSI, pas qu'un cron a tourne.
date -Iseconds > "$DEST/derniere-reussite"
