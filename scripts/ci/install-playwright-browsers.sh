#!/usr/bin/env bash
# Shared Playwright browser setup for every CI workflow that installs Playwright browsers (#1872).
#
# Usage: scripts/ci/install-playwright-browsers.sh chromium [firefox webkit]
# Needs `playwright` installed first (the workflows run `npm i --no-save playwright@<version>`).
#
# What it does, so one Ubuntu package-mirror outage cannot block every pull request:
#   1. System libraries (apt, through `playwright install-deps`): up to 3 tries, each time-limited, with apt's own
#      retries and network timeouts turned on so a dead mirror fails fast instead of hanging.
#   2. Browser downloads (Playwright's CDN, not the Ubuntu mirror): up to 3 tries, each time-limited.
#   3. If step 1 never succeeded, every requested browser is launched once. The runner image usually has the
#      libraries already, so the jobs carry on with a warning. If a browser cannot start, the step fails with a
#      plain "package mirror unreachable" message naming the browser.
#
# PLAYWRIGHT_SETUP_SIMULATE_MIRROR_OUTAGE=1 points apt at an unresolvable mirror first, to rehearse an outage.
set -uo pipefail

if [ "$#" -eq 0 ]; then
  echo "Usage: $0 <browser> [browser ...]  (for example: chromium firefox webkit)" >&2
  exit 2
fi
browsers=("$@")

ATTEMPTS="${PLAYWRIGHT_SETUP_ATTEMPTS:-3}"
DEPS_TIMEOUT="${PLAYWRIGHT_SETUP_DEPS_TIMEOUT:-600}"
DOWNLOAD_TIMEOUT="${PLAYWRIGHT_SETUP_DOWNLOAD_TIMEOUT:-600}"
SUDO=""
if [ "$(id -u)" -ne 0 ]; then SUDO="sudo"; fi

# Run "$@" up to ATTEMPTS times, each limited to $1 seconds, waiting 10s, 20s, ... between tries.
retry_with_timeout() {
  local limit="$1" label="$2"
  shift 2
  local attempt
  for attempt in $(seq 1 "$ATTEMPTS"); do
    echo "::group::${label} (attempt ${attempt} of ${ATTEMPTS})"
    timeout --kill-after=30 "$limit" "$@"
    local status=$?
    echo "::endgroup::"
    if [ "$status" -eq 0 ]; then return 0; fi
    if [ "$status" -eq 124 ] || [ "$status" -eq 137 ]; then
      echo "${label}: attempt ${attempt} stopped after ${limit}s."
    else
      echo "${label}: attempt ${attempt} failed (exit ${status})."
    fi
    if [ "$attempt" -lt "$ATTEMPTS" ]; then sleep $((attempt * 10)); fi
  done
  return 1
}

# apt: retry each download and give up on an unreachable mirror quickly rather than waiting on it.
printf '%s\n' 'Acquire::Retries "3";' 'Acquire::http::Timeout "30";' 'Acquire::https::Timeout "30";' \
  | $SUDO tee /etc/apt/apt.conf.d/80-imsda-ci-retries > /dev/null

if [ "${PLAYWRIGHT_SETUP_SIMULATE_MIRROR_OUTAGE:-}" = "1" ]; then
  echo "Simulating a package-mirror outage: apt now points at an unresolvable host."
  for f in /etc/apt/sources.list /etc/apt/sources.list.d/*.list /etc/apt/sources.list.d/*.sources; do
    [ -f "$f" ] || continue
    $SUDO sed -i -E 's#https?://[^ /]+#http://package-mirror-outage.invalid#g' "$f"
  done
  $SUDO rm -rf /var/lib/apt/lists/*
fi

deps_ok=1
if ! retry_with_timeout "$DEPS_TIMEOUT" "System libraries for ${browsers[*]}" \
  npx playwright install-deps "${browsers[@]}"; then
  deps_ok=0
  echo "::warning title=Ubuntu package mirror unreachable::Could not install the system libraries for ${browsers[*]} after ${ATTEMPTS} tries. Carrying on with the libraries already on the runner image; each browser is test-launched next."
fi

if ! retry_with_timeout "$DOWNLOAD_TIMEOUT" "Download ${browsers[*]}" npx playwright install "${browsers[@]}"; then
  echo "::error title=Browser download failed::Could not download ${browsers[*]} from Playwright's download server after ${ATTEMPTS} tries. This is a network problem, not a test failure; re-run the job."
  exit 1
fi

if [ "$deps_ok" -eq 1 ]; then
  echo "Playwright browsers ready: ${browsers[*]}."
  exit 0
fi

# The libraries were not installed: prove each browser starts before any test runs.
missing=()
for browser in "${browsers[@]}"; do
  if timeout 120 node -e '
    const name = process.argv[1];
    require("playwright")[name].launch().then((b) => b.close()).then(
      () => process.exit(0),
      (error) => { console.error(String(error && error.message || error).split("\n").slice(0, 12).join("\n")); process.exit(1); },
    );
  ' "$browser"; then
    echo "${browser} starts with the runner image's own libraries."
  else
    missing+=("$browser")
  fi
done

if [ "${#missing[@]}" -gt 0 ]; then
  echo "::error title=Ubuntu package mirror unreachable::The Ubuntu package mirror could not be reached, and ${missing[*]} cannot start without the libraries it would have installed. This is a runner network problem, not a test failure; re-run the job when the mirror is back."
  exit 1
fi

echo "Playwright browsers ready without new system libraries: ${browsers[*]}."
