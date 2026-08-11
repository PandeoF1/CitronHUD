#!/usr/bin/env bash
#
# Vérifie la jonction client ↔ serveur.
#
#   apps/client/e2e/run.sh
#
# Prérequis :
#   - la pile de développement tourne
#       cd infra && docker compose -f docker-compose.yml -f docker-compose.dev.yml \
#           up -d postgres minio createbucket
#   - le serveur a été migré et amorcé (apps/server : pnpm db:migrate && pnpm db:seed)
#   - une clé d'API valide dans LINK_API_KEY
#
# Contrairement au harnais du serveur, celui-ci ne tourne pas en intégration
# continue : il lance un vrai Electron et écrit dans le dossier utilisateur du
# client. C'est une vérification de poste, pas une barrière de merge.

set -euo pipefail

cd "$(dirname "$0")/.."

if [ -z "${LINK_API_KEY:-}" ]; then
  echo "LINK_API_KEY absent. La clé vient de « pnpm db:seed » ou de la page Clés de l'admin." >&2
  exit 1
fi

export LINK_SERVER_URL="${LINK_SERVER_URL:-http://localhost:3000}"
export LINK_CLIENT_DIR="$PWD"
export LINK_CLIENT_PORT="${LINK_CLIENT_PORT:-3477}"

if [ -f ../server/.env ]; then
  set -a
  # shellcheck disable=SC1091
  . ../server/.env
  set +a
fi

# Le client `sqlite3` lit la base locale du client : `better-sqlite3` est
# compilé pour l'ABI d'Electron et ne se charge pas sous Node.
if [ -z "${LINK_SQLITE:-}" ]; then
  if command -v sqlite3 >/dev/null 2>&1; then
    LINK_SQLITE=sqlite3
  else
    echo "Le client sqlite3 est introuvable. L'installer, ou pointer LINK_SQLITE dessus." >&2
    exit 1
  fi
fi
export LINK_SQLITE

if ! curl -sf -o /dev/null -H "x-citron-key: ${LINK_API_KEY}" \
  "${LINK_SERVER_URL}/api/v1/health"; then
  echo "Le serveur ne répond pas sur ${LINK_SERVER_URL} (ou la clé est refusée)." >&2
  echo "  cd apps/server && pnpm start" >&2
  exit 1
fi

# Le client est lancé depuis `out/`, pas depuis les sources.
if [ ! -f out/main/index.js ]; then
  echo "→ Build du client"
  pnpm build
fi

# Un client déjà lancé occuperait le port et fausserait tout.
#
# Les crochets autour de la première lettre sont indispensables : `pkill -f`
# compare la ligne de commande complète de chaque processus, y compris celle du
# shell qui exécute ce script — sans eux, le script se tue lui-même.
pkill -f "[e]lectron out/main/index.js" >/dev/null 2>&1 || true
sleep 1

node e2e/link.mjs
