#!/usr/bin/env bash
#
# rent-refresh-reminder.sh — the monthly "time to refresh the rent data" nudge.
# Twin of lotcheck's market-refresh-reminder.sh (same house pattern).
#
# Run by launchd (see tools/launchd/com.charles.sunchaser-rent-refresh.plist), NOT by
# you directly (though you can, to test). It does NOT refresh or deploy anything:
#   1. reads latest_month from the committed data/rents.json,
#   2. cheaply peeks Zillow's latest ZORI month (header line only, a few KB — the
#      last column name IS the latest month; head -1 closes the pipe via SIGPIPE),
#   3. pops a macOS dialog: newer month out (run the refresh) or already current.
# Zillow usually drops the new month around the ~16th; launchd fires on the 18th.
# Every run is logged to ~/Library/Logs/sunchaser-rent-refresh.log.
#
# The actual refresh stays manual and in your control:
#   node tools/fetch-rents.js   then commit + deploy per the reverse-proxy procedure.
set -uo pipefail
cd "$(dirname "$0")/.."

DATA="data/rents.json"
LOG="$HOME/Library/Logs/sunchaser-rent-refresh.log"
# Keep in sync with ZORI_URL in tools/fetch-rents.js.
ZORI_URL="https://files.zillowstatic.com/research/public_csvs/zori/City_zori_uc_sfrcondomfr_sm_month.csv"

# latest_month of what's committed ("YYYY-MM", or "?" if unreadable). grep, NOT node:
# launchd runs with a bare PATH that usually lacks node; depend only on /usr/bin tools.
CURRENT="$(grep -o '"latest_month": *"[0-9]\{4\}-[0-9]\{2\}"' "$DATA" 2>/dev/null | head -1 | grep -o '[0-9]\{4\}-[0-9]\{2\}')"
: "${CURRENT:=?}"

# Zillow's latest month = last header column (a date like 2026-06-30); trim to YYYY-MM
# so the comparison is month-to-month, never date-to-month.
LATEST="$(curl -s --max-time 30 "$ZORI_URL" 2>/dev/null | head -1 | awk -F, '{print $NF}' | tr -d '[:space:]')"
LATEST="${LATEST:0:7}"

# Modal dialog, not a banner (banners are suppressed on this Mac); auto-dismisses so the
# launchd job never hangs when nobody's at the machine.
notify() { osascript -e "display dialog \"$2\" with title \"$1\" buttons {\"OK\"} default button \"OK\" with icon note giving up after 600" >/dev/null 2>&1 || true; }

if ! printf '%s' "$LATEST" | grep -Eq '^[0-9]{4}-[0-9]{2}$'; then
  MSG="Couldn't reach Zillow to check. Deployed rents as of ${CURRENT}. Run: node tools/fetch-rents.js to check manually."
  notify "Sunchaser rent data" "$MSG"
elif [[ "$LATEST" > "$CURRENT" ]]; then
  MSG="New month available: ${LATEST} (deployed: ${CURRENT}). Run: node tools/fetch-rents.js, then commit + deploy."
  notify "Sunchaser rent data — refresh available" "$MSG"
else
  MSG="Up to date (${CURRENT}). Nothing to do this month."
  notify "Sunchaser rent data — current" "$MSG"
fi

printf '%s  current=%s latest=%s  ->  %s\n' "$(date '+%Y-%m-%d %H:%M')" "$CURRENT" "${LATEST:-unreachable}" "$MSG" >> "$LOG"
