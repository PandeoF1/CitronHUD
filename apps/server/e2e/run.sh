#!/usr/bin/env bash
#
# Monte une base jetable, y applique le schéma, démarre le serveur de
# production et lance les vérifications de bout en bout.
#
#   apps/server/e2e/run.sh
#
# Prérequis : la pile de développement tourne.
#
#   cd infra && docker compose -f docker-compose.yml -f docker-compose.dev.yml \
#       up -d postgres minio createbucket
#
# La base porte un nom distinct de celle de développement et est recréée à
# chaque passage : un test qui dépend de ce qu'un test précédent a laissé
# derrière lui ne prouve rien.

set -euo pipefail

cd "$(dirname "$0")/.."

PORT="${E2E_PORT:-3100}"
DB_NAME="${E2E_DB_NAME:-citronhud_e2e}"
PG_HOST="${E2E_PG_HOST:-127.0.0.1}"
PG_PORT="${E2E_PG_PORT:-5432}"
PG_USER="${E2E_PG_USER:-citron}"

# Garde-fou : ce script supprime la base qu'on lui désigne. Exiger le suffixe
# rend impossible de viser `citronhud` par inattention — une variable
# d'environnement héritée du shell suffirait sinon à effacer le roster.
case "$DB_NAME" in
  *_e2e) ;;
  *)
    echo "Refus : E2E_DB_NAME doit se terminer par _e2e (reçu « $DB_NAME »)." >&2
    exit 1
    ;;
esac

# Les identifiants viennent de infra/.env, source unique des mots de passe.
if [ -f ../../infra/.env ]; then
  set -a
  # shellcheck disable=SC1091
  . ../../infra/.env
  set +a
fi

: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD absent — renseigner infra/.env}"

TEST_URL="postgres://${PG_USER}:${POSTGRES_PASSWORD}@${PG_HOST}:${PG_PORT}/${DB_NAME}"

HINT="  cd infra && docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres minio createbucket"

# Deux façons d'atteindre PostgreSQL : le client `psql` du poste, ou celui du
# conteneur. La chaîne d'intégration a le premier, un poste de développement
# souvent seulement le second — et `set -e` ferait sortir sans un mot si aucun
# des deux n'est là.
if command -v psql >/dev/null 2>&1; then
  psql_admin() {
    PGPASSWORD="$POSTGRES_PASSWORD" psql -v ON_ERROR_STOP=1 \
      -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d postgres -c "$1" >/dev/null
  }
elif docker exec infra-postgres-1 true >/dev/null 2>&1; then
  psql_admin() {
    docker exec -i -e PGPASSWORD="$POSTGRES_PASSWORD" infra-postgres-1 \
      psql -v ON_ERROR_STOP=1 -U "$PG_USER" -d postgres -c "$1" >/dev/null
  }
else
  echo "Ni le client psql ni le conteneur infra-postgres-1 ne sont disponibles." >&2
  echo "Démarrer la pile de développement :" >&2
  echo "$HINT" >&2
  exit 1
fi

SERVER_PID=""
cleanup() {
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null || true
}
trap cleanup EXIT

psql_admin() {
  docker exec -i -e PGPASSWORD="$POSTGRES_PASSWORD" infra-postgres-1 \
    psql -v ON_ERROR_STOP=1 -U "$PG_USER" -d postgres -c "$1" >/dev/null
}

echo "→ Base jetable ${DB_NAME}"
psql_admin "DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)"
psql_admin "CREATE DATABASE ${DB_NAME}"

export DATABASE_URL="$TEST_URL"
export AUTH_SECRET="${AUTH_SECRET:-secret-de-test-suffisamment-long-pour-passer}"
export PUBLIC_URL="http://localhost:${PORT}"
export SEED_ADMIN_EMAIL="${SEED_ADMIN_EMAIL:-admin@citron.gg}"
export SEED_ADMIN_PASSWORD="${SEED_ADMIN_PASSWORD:-mot-de-passe-de-test}"
export S3_ENDPOINT="${S3_ENDPOINT:-http://127.0.0.1:9000}"
export S3_BUCKET="${S3_BUCKET:-citronhud}"
export S3_ACCESS_KEY="${MINIO_ROOT_USER:-citronhud}"
export S3_SECRET_KEY="${MINIO_ROOT_PASSWORD:-}"
export S3_PUBLIC_URL="${S3_ENDPOINT}/${S3_BUCKET}"

# Le stockage est une dépendance du harnais au même titre que la base : sans
# bucket, les téléversements échouent en 500 et la moitié des contrôles ne
# veulent plus rien dire. L'opération est idempotente.
echo "→ Bucket de stockage"
node e2e/ensure-bucket.mjs

echo "→ Migrations"
pnpm exec tsx src/db/migrate.ts

echo "→ Amorçage"
SEED_OUTPUT="$(pnpm exec tsx src/db/seed.ts)"
E2E_API_KEY="$(printf '%s' "$SEED_OUTPUT" | grep -o 'citron_[A-Za-z0-9_-]*' | head -1)"
if [ -z "$E2E_API_KEY" ]; then
  echo "Aucune clé d'API produite par l'amorçage." >&2
  printf '%s\n' "$SEED_OUTPUT" >&2
  exit 1
fi
export E2E_API_KEY

if [ ! -d .next ]; then
  echo "→ Build"
  pnpm exec next build
fi

echo "→ Serveur sur :${PORT}"
pnpm exec next start --port "$PORT" >/tmp/citronhud-e2e-server.log 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 60); do
  if curl -sf -o /dev/null "http://localhost:${PORT}/login"; then break; fi
  sleep 1
done

if ! curl -sf -o /dev/null "http://localhost:${PORT}/login"; then
  echo "Le serveur n'a pas démarré :" >&2
  tail -30 /tmp/citronhud-e2e-server.log >&2
  exit 1
fi

export E2E_BASE_URL="http://localhost:${PORT}"
node e2e/run.mjs
