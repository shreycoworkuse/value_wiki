#!/usr/bin/env bash
# Fetches SEC's public ticker -> CIK -> company name list and writes it to
# data/company_tickers.json, so the site can look it up same-origin (see
# js/sec.js for why: www.sec.gov doesn't send a CORS header, so browsers
# can't fetch it cross-origin from a page hosted anywhere else).
#
# The GitHub Pages deploy workflow runs this on every deploy, server-side,
# where CORS doesn't apply. Run it once yourself before testing locally.
set -euo pipefail
cd "$(dirname "$0")/.."

mkdir -p data
curl -sS --fail \
  -A "value-wiki (local dev/CI fetch; contact: shrey.cowork.use@gmail.com)" \
  "https://www.sec.gov/files/company_tickers.json" \
  -o data/company_tickers.json

echo "Wrote data/company_tickers.json ($(wc -c < data/company_tickers.json) bytes)"
