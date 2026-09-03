#!/usr/bin/env bash
# M0 discovery: dump /v1/models from Vilao and CKey so we can design against
# the real schema instead of guessing.
#
# Usage:
#   VILAO_KEY=xxx CKEY_KEY=yyy ./scripts/discover.sh
#
# Optional overrides if the guessed base URLs are wrong:
#   VILAO_BASE=https://api.vilao.ai/v1 CKEY_BASE=https://api.ckey.vn/v1 ./scripts/discover.sh
#
# Writes raw JSON to docs/samples/. Keys are never written to disk.

set -uo pipefail
cd "$(dirname "$0")/.."
mkdir -p docs/samples

# Base URL is not documented publicly yet, so try the usual shapes in order.
VILAO_CANDIDATES=("${VILAO_BASE:-}" "https://api.vilao.ai/v1" "https://vilao.ai/api/v1" "https://vilao.ai/v1")
CKEY_CANDIDATES=("${CKEY_BASE:-}"  "https://api.ckey.vn/v1"  "https://ckey.vn/api/v1"  "https://ckey.vn/v1")

probe() {
  local name=$1 key=$2; shift 2
  local out="docs/samples/${name}-models.json"

  if [ -z "$key" ]; then
    echo "[$name] skipped: no API key in \$${name^^}_KEY"
    return
  fi

  for base in "$@"; do
    [ -z "$base" ] && continue
    local code
    code=$(curl -sS --max-time 20 -o "$out" -w '%{http_code}' \
             -H "Authorization: Bearer $key" "$base/models" 2>/dev/null) || code=000

    if [ "$code" = "200" ]; then
      echo "[$name] OK  base=$base  ->  $out"
      if command -v jq >/dev/null; then
        echo "  models: $(jq '.data | length' "$out" 2>/dev/null)"
        echo "  fields on one model:"
        jq -r '.data[0] | keys[]' "$out" 2>/dev/null | sed 's/^/    /'
        echo "  sample:"
        jq -c '.data[0]' "$out" 2>/dev/null | cut -c1-400 | sed 's/^/    /'
      else
        head -c 600 "$out"; echo
      fi
      return
    fi
    echo "[$name] $base/models -> HTTP $code"
  done

  rm -f "$out"
  echo "[$name] FAILED: none of the candidate base URLs answered 200."
  echo "         Find the real one in the dashboard and pass ${name^^}_BASE=..."
}

probe vilao "${VILAO_KEY:-}" "${VILAO_CANDIDATES[@]}"
echo
probe ckey  "${CKEY_KEY:-}"  "${CKEY_CANDIDATES[@]}"

echo
echo "Answer from the output above:"
echo "  1. exact base URL for each provider"
echo "  2. does a model object carry pricing?  (fields like pricing/price/input_cost)"
echo "  3. does it carry context length?       (context_length/max_tokens)"
echo "  4. are there non-text models?          (image/video/audio in id or type)"
