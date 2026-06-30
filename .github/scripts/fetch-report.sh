#!/usr/bin/env bash
#
# Fetch an enterprise "ai_credit" (AI usage) report from the GitHub billing REST
# API and write it (and, optionally, the previous calendar month) into public/ so
# it is preloaded into the built site.
#
# Invoked by .github/workflows/auto-report-pages.yml. Required environment:
#   BILLING_TOKEN    Enterprise admin / billing manager token.
#   ENTERPRISE       Enterprise slug.
#   IN_MONTH         Target month as MM-YY (e.g. 06-26); empty = current month.
#   INCLUDE_PREVIOUS "true" to also fetch the previous calendar month.
#
# API reference:
# https://docs.github.com/en/enterprise-cloud@latest/rest/billing/usage-reports
set -euo pipefail

: "${BILLING_TOKEN:?BILLING_TOKEN is required}"
: "${ENTERPRISE:?ENTERPRISE is required}"
IN_MONTH="${IN_MONTH:-}"
INCLUDE_PREVIOUS="${INCLUDE_PREVIOUS:-false}"

api="https://api.github.com/enterprises/${ENTERPRISE}/settings/billing/reports"

# Report type is always 'ai_credit' (the AI usage report); the API version is
# pinned here and updated from this repository when needed.
report_type="ai_credit"
api_version="2026-03-10"
poll_interval_seconds=15
poll_timeout_minutes=20

# Resolve the target month from the MM-YY input (or the current month, UTC),
# then derive the primary and comparison calendar-month windows.
if [ -n "$IN_MONTH" ]; then
  if ! printf '%s' "$IN_MONTH" | grep -Eq '^(0[1-9]|1[0-2])-[0-9]{2}$'; then
    echo "::error::Invalid 'month' input '$IN_MONTH'; expected MM-YY (e.g. 06-26)."
    exit 1
  fi
  month_start="20${IN_MONTH##*-}-${IN_MONTH%%-*}-01"
else
  month_start="$(date -u +%Y-%m-01)"
fi
start="$month_start"
end="$(date -u -d "$month_start +1 month -1 day" +%Y-%m-%d)"
prev_start="$(date -u -d "$month_start -1 month" +%Y-%m-%d)"
prev_end="$(date -u -d "$month_start -1 day" +%Y-%m-%d)"
echo "Primary report window:    $start .. $end"
echo "Comparison report window: $prev_start .. $prev_end"

# Create an export, poll until it completes, then download the CSV
# (concatenating multi-part exports and dropping the repeated header).
fetch_report() {
  local report_type="$1" start="$2" end="$3" out="$4"

  echo "Requesting '${report_type}' report ${start}..${end}"
  local body create id
  body="$(jq -nc \
    --arg rt "$report_type" --arg s "$start" --arg e "$end" \
    '{report_type:$rt, start_date:$s, end_date:$e}')"
  create="$(curl -sS -X POST "$api" \
    -H "Accept: application/vnd.github+json" \
    -H "Authorization: Bearer ${BILLING_TOKEN}" \
    -H "X-GitHub-Api-Version: ${api_version}" \
    -d "$body")"
  id="$(printf '%s' "$create" | jq -r '.id // empty')"
  if [ -z "$id" ]; then
    # Surface the API message but not any URLs/tokens.
    echo "::error::Failed to create export: $(printf '%s' "$create" | jq -rc '{message, errors, status}')"
    return 1
  fi
  echo "Export id: $id"

  local deadline status detail
  deadline=$(( $(date +%s) + poll_timeout_minutes * 60 ))
  while :; do
    detail="$(curl -sS "$api/$id" \
      -H "Accept: application/vnd.github+json" \
      -H "Authorization: Bearer ${BILLING_TOKEN}" \
      -H "X-GitHub-Api-Version: ${api_version}")"
    status="$(printf '%s' "$detail" | jq -r '.status // empty')"
    echo "Status: ${status:-unknown}"
    case "$status" in
      completed) break ;;
      failed)
        echo "::error::Export $id failed."
        return 1 ;;
    esac
    if [ "$(date +%s)" -ge "$deadline" ]; then
      echo "::error::Timed out after ${poll_timeout_minutes}m waiting for export $id."
      return 1
    fi
    sleep "$poll_interval_seconds"
  done

  # Download URLs are short-lived, pre-signed links; keep them out of logs.
  local urls first=1
  urls="$(printf '%s' "$detail" | jq -r '.download_urls[]?')"
  if [ -z "$urls" ]; then
    echo "::error::Completed export $id had no download URLs."
    return 1
  fi
  : > "$out"
  while IFS= read -r url; do
    [ -z "$url" ] && continue
    if [ "$first" -eq 1 ]; then
      curl -sSL "$url" >> "$out"
      first=0
    else
      # Subsequent parts repeat the header row; drop it.
      curl -sSL "$url" | tail -n +2 >> "$out"
    fi
  done <<< "$urls"

  if [ ! -s "$out" ]; then
    echo "::error::Downloaded report '$out' is empty."
    return 1
  fi
  echo "Wrote $(wc -l < "$out") line(s) to $out"
}

mkdir -p public
fetch_report "$report_type" "$start" "$end" "public/preloaded-report.csv"

if [ "$INCLUDE_PREVIOUS" = "true" ]; then
  fetch_report "$report_type" "$prev_start" "$prev_end" "public/preloaded-report-previous.csv"
fi
