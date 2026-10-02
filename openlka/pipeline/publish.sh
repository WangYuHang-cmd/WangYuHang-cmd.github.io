#!/usr/bin/env bash
# publish.sh - move the OpenLKA CAN showcase between the lab server and this repo.
#
#   publish.sh push     rsync openlka/pipeline/  -> remote Code4Dataset/web_showcase/   (scripts; source of truth is the repo)
#   publish.sh pull     rsync remote site/can/    -> openlka/static/can/  then verify SHA256SUMS and gate du -sb <= 30 MB
#   publish.sh          == pull
#
# Needs: sshpass, rsync; password = first line of ~/Desktop/100.122.237.116.txt
set -euo pipefail

HOST="henry@100.122.237.116"
PASS_FILE="${PASS_FILE:-$HOME/Desktop/100.122.237.116.txt}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOCAL_PIPELINE="$REPO/openlka/pipeline/"
LOCAL_SITE="$REPO/openlka/static/can/"
REMOTE_PIPELINE="/home/henry/Desktop/Drive/Code4Dataset/web_showcase/"
REMOTE_SITE="/data/datasets/temporary/web_showcase/site/can/"
MAX_BYTES=$((30 * 1000 * 1000))

pass() { head -1 "$PASS_FILE"; }
rs() { sshpass -p "$(pass)" rsync -az --info=stats1 -e "ssh -o StrictHostKeyChecking=no" "$@"; }

cmd="${1:-pull}"
case "$cmd" in
  push)
    rs --exclude '__pycache__' --exclude '*.pyc' "$LOCAL_PIPELINE" "$HOST:$REMOTE_PIPELINE"
    echo "pushed $LOCAL_PIPELINE -> $HOST:$REMOTE_PIPELINE"
    ;;
  pull)
    mkdir -p "$LOCAL_SITE"
    rs --delete "$HOST:$REMOTE_SITE" "$LOCAL_SITE"
    ( cd "$LOCAL_SITE" && sha256sum --quiet -c SHA256SUMS ) && echo "SHA256SUMS verified"
    bytes=$(du -sb "$LOCAL_SITE" | cut -f1)
    if [ "$bytes" -gt "$MAX_BYTES" ]; then
      echo "ERROR: $LOCAL_SITE is $bytes bytes > $MAX_BYTES" >&2
      exit 1
    fi
    echo "pulled site -> $LOCAL_SITE ($bytes bytes, $(find "$LOCAL_SITE" -type f | wc -l) files)"
    ;;
  *)
    echo "usage: $0 [push|pull]" >&2
    exit 2
    ;;
esac
