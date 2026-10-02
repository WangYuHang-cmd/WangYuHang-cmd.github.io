#!/usr/bin/env bash
# publish.sh - move the OpenLKA CAN showcase between the lab server and this repo.
#
#   publish.sh push     rsync openlka/pipeline/  -> remote Code4Dataset/web_showcase/   (scripts; source of truth is the repo)
#   publish.sh pull     rsync remote site/can/ -> a temp dir, verify SHA256SUMS (fatal), gate du -sb <= 30 MB,
#                       then swap it into openlka/static/can/ (the previous copy is removed only after a good verify)
#   publish.sh          == pull
#
# Needs: sshpass, rsync; the password file (first line) is passed with sshpass -f so it never appears in `ps`.
set -euo pipefail

HOST="henry@100.122.237.116"
PASS_FILE="${PASS_FILE:-$HOME/Desktop/100.122.237.116.txt}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOCAL_PIPELINE="$REPO/openlka/pipeline/"
LOCAL_SITE="$REPO/openlka/static/can"
REMOTE_PIPELINE="/home/henry/Desktop/Drive/Code4Dataset/web_showcase/"
REMOTE_SITE="/data/datasets/temporary/web_showcase/site/can/"
MAX_BYTES=$((30 * 1000 * 1000))

[ -r "$PASS_FILE" ] || { echo "ERROR: password file $PASS_FILE not readable" >&2; exit 1; }
rs() { sshpass -f "$PASS_FILE" rsync -az --info=stats1 -e "ssh -o StrictHostKeyChecking=no" "$@"; }

cmd="${1:-pull}"
case "$cmd" in
  push)
    rs --exclude '__pycache__' --exclude '*.pyc' "$LOCAL_PIPELINE" "$HOST:$REMOTE_PIPELINE"
    echo "pushed $LOCAL_PIPELINE -> $HOST:$REMOTE_PIPELINE"
    ;;
  pull)
    tmp="$(mktemp -d "${LOCAL_SITE}.tmp.XXXXXX")"
    trap 'rm -rf "$tmp"' EXIT
    rs --delete "$HOST:$REMOTE_SITE" "$tmp/"
    if [ ! -s "$tmp/SHA256SUMS" ]; then
      echo "ERROR: no SHA256SUMS in the pulled bundle (run build_index.py on the server first)" >&2
      exit 1
    fi
    if ! (cd "$tmp" && sha256sum --quiet -c SHA256SUMS); then
      echo "ERROR: SHA256SUMS verification failed; local copy left untouched" >&2
      exit 1
    fi
    # every file in the bundle must be listed (no stray files slip through)
    stray=$(cd "$tmp" && find . -type f ! -name SHA256SUMS | sed 's#^\./##' | sort | comm -23 - <(awk '{print $2}' SHA256SUMS | sort))
    if [ -n "$stray" ]; then
      echo "ERROR: files not covered by SHA256SUMS:" >&2; echo "$stray" >&2
      exit 1
    fi
    bytes=$(du -sb "$tmp" | cut -f1)
    if [ "$bytes" -gt "$MAX_BYTES" ]; then
      echo "ERROR: bundle is $bytes bytes > $MAX_BYTES; local copy left untouched" >&2
      exit 1
    fi
    echo "SHA256SUMS verified ($(wc -l < "$tmp/SHA256SUMS") files, $bytes bytes)"
    if [ -d "$LOCAL_SITE" ]; then
      old="${LOCAL_SITE}.old.$$"
      mv "$LOCAL_SITE" "$old"
      mv "$tmp" "$LOCAL_SITE"
      rm -rf "$old"
    else
      mv "$tmp" "$LOCAL_SITE"
    fi
    trap - EXIT
    echo "pulled site -> $LOCAL_SITE ($bytes bytes, $(find "$LOCAL_SITE" -type f | wc -l) files)"
    ;;
  *)
    echo "usage: $0 [push|pull]" >&2
    exit 2
    ;;
esac
