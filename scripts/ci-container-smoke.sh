#!/usr/bin/env bash
# Container smoke tests for the Paddy CI pipeline.
#
# Exercises the built image through its real entrypoints:
#   - openclaw --version
#   - openclaw --help
#   - openclaw doctor --non-interactive
#   - gateway start with an explicit OPENCLAW_GATEWAY_TOKEN, verified through
#     the image's own healthcheck, then a clean stop
#   - gateway start without any auth configuration, which must fail fast with
#     the missing-token error (src/gateway/auth.ts owns that behavior)
#
# Tool-agnostic: honors $CONTAINER_RUNTIME (docker or podman) and defaults to
# docker when available, podman otherwise. The image itself is built for
# Docker, Buildx, and Podman (see the root Dockerfile).
#
# Usage: scripts/ci-container-smoke.sh <image>
set -euo pipefail

image="${1:?usage: $0 <image>}"

runtime="${CONTAINER_RUNTIME:-}"
if [[ -z "$runtime" ]]; then
  if command -v docker >/dev/null 2>&1; then
    runtime="docker"
  elif command -v podman >/dev/null 2>&1; then
    runtime="podman"
  else
    echo "smoke: no container runtime found (docker or podman)" >&2
    exit 1
  fi
fi

fail() {
  echo "SMOKE FAIL: $*" >&2
  exit 1
}
note() {
  echo "smoke: $*"
}

# The image's docker-compose.yml pins HOME=/home/node; keep the same contract.
home_env=(-e HOME=/home/node)

note "using runtime: $runtime"

note "check 1/5: --version"
version_out="$("$runtime" run --rm "${home_env[@]}" "$image" openclaw --version)"
echo "  -> ${version_out}"
expected_version="$(node -p "require('./package.json').version")"
grep -Eq "[0-9]+\.[0-9]+\.[0-9]+" <<<"$version_out" || fail "--version output has no version"
grep -Fq "$expected_version" <<<"$version_out" ||
  fail "--version does not report package.json version $expected_version"

note "check 2/5: --help"
help_out="$("$runtime" run --rm "${home_env[@]}" "$image" openclaw --help)"
grep -qE "Usage|Commands" <<<"$help_out" || fail "--help output lacks usage text"

note "check 3/5: doctor --non-interactive"
set +e
doctor_out="$("$runtime" run --rm "${home_env[@]}" "$image" openclaw doctor --non-interactive 2>&1)"
doctor_code=$?
set -e
echo "  -> doctor exited $doctor_code"
if [[ $doctor_code -ne 0 ]]; then
  echo "$doctor_out" | tail -n 20 >&2
  fail "doctor --non-interactive exited $doctor_code"
fi

note "check 4/5: gateway starts with an explicit OPENCLAW_GATEWAY_TOKEN"
token="smoke-$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
cid="$("$runtime" run -d -e OPENCLAW_GATEWAY_TOKEN="$token" "${home_env[@]}" "$image")"
cleanup() {
  [[ -n "${cid:-}" ]] && "$runtime" rm -f "$cid" >/dev/null 2>&1 || true
}
trap cleanup EXIT
ready=""
for _ in $(seq 1 45); do
  # The image's own HEALTHCHECK probe is the readiness contract.
  if "$runtime" exec "$cid" node dist/docker-healthcheck.js >/dev/null 2>&1; then
    ready=1
    break
  fi
  if ! "$runtime" inspect -f '{{.State.Running}}' "$cid" 2>/dev/null | grep -qx true; then
    break # container exited early; report below
  fi
  sleep 2
done
if [[ -z "$ready" ]]; then
  "$runtime" logs "$cid" 2>&1 || true
  fail "gateway never became healthy within 90s (may have exited early)"
fi
"$runtime" stop "$cid" >/dev/null
"$runtime" rm "$cid" >/dev/null
cid=""
note "  -> gateway became healthy and stopped cleanly"

note "check 5/5: gateway fails fast when auth configuration is missing"
set +e
missing_out="$(timeout 120 "$runtime" run --rm "${home_env[@]}" "$image" node openclaw.mjs gateway 2>&1)"
missing_code=$?
set -e
echo "  -> gateway exited $missing_code"
if [[ $missing_code -eq 0 ]]; then
  echo "$missing_out" | tail -n 20 >&2
  fail "gateway started without any auth configuration (expected missing-token failure)"
fi
grep -qiE "token|auth" <<<"$missing_out" ||
  fail "gateway failed without auth ($missing_code) but gave no token/auth explanation"

note "all container smoke checks passed"
