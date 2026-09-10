#!/usr/bin/env bash
# Paddy installer — Irish-roots super harness.
# Not affiliated with the OpenClaw Foundation or Nous Research.
#
#   curl -fsSL https://raw.githubusercontent.com/coruairc/paddy/main/install.sh | bash
#   curl -fsSL …/install.sh | bash -s -- --no-onboard
#   curl -fsSL …/install.sh | bash -s -- --help
set -euo pipefail

REPO="${PADDY_REPO:-coruairc/paddy}"
REF="${PADDY_REF:-main}"
PREFIX="${PADDY_HOME:-${HOME}/.paddy}"
GIT_DIR="${PADDY_GIT_DIR:-${PREFIX}/src}"
BIN_DIR="${PADDY_BIN_DIR:-${HOME}/.local/bin}"
ONBOARD=1
DRY_RUN=0

usage() {
  cat <<EOF
Paddy installer

Usage:
  curl -fsSL https://raw.githubusercontent.com/coruairc/paddy/main/install.sh | bash
  curl -fsSL https://raw.githubusercontent.com/coruairc/paddy/main/install.sh | bash -s -- [flags]

Windows:
  powershell -c "irm https://raw.githubusercontent.com/coruairc/paddy/main/install.ps1 | iex"

Flags:
  --help            This text
  --no-onboard      Skip paddy onboard
  --ref <ref>       Git branch or tag (default: main)
  --git-dir <path>  Checkout path (default: ~/.paddy/src)
  --bin-dir <path>  Wrapper path (default: ~/.local/bin)
  --dry-run         Print actions, install nothing

Needs git and Node.js 22+. Does not use sudo.
After install:  paddy gateway
EOF
}

log() { printf '==> %s\n' "$*"; }
die() { printf 'paddy install: %s\n' "$*" >&2; exit 1; }
run() {
  if [ "$DRY_RUN" = 1 ]; then
    printf '[dry-run] %s\n' "$*"
    return 0
  fi
  "$@"
}

while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --no-onboard) ONBOARD=0 ;;
    --dry-run) DRY_RUN=1 ;;
    --ref) REF="${2:-}"; shift ;;
    --git-dir) GIT_DIR="${2:-}"; shift ;;
    --bin-dir) BIN_DIR="${2:-}"; shift ;;
    --repo) REPO="${2:-}"; shift ;;
    *) die "unknown flag: $1 (try --help)" ;;
  esac
  shift
done

[ -n "$REF" ] || die "--ref needs a value"
[ -n "$GIT_DIR" ] || die "--git-dir needs a value"

need() {
  command -v "$1" >/dev/null 2>&1 || die "need $1 on PATH. Install it, then re-run."
}

node_major() {
  node -p "parseInt(process.versions.node, 10)" 2>/dev/null || echo 0
}

log "Paddy · $REPO@$REF"

need git
need npm
if ! command -v node >/dev/null 2>&1; then
  die "need Node.js 22+. macOS: brew install node · Debian: see nodejs.org · Windows: winget install OpenJS.NodeJS.LTS"
fi
major="$(node_major)"
if [ "$major" -lt 22 ]; then
  die "Node.js $major is too old. Paddy wants 22+."
fi
log "node $(node -v) · npm $(npm -v | tr -d '\r')"

clone_url="https://github.com/${REPO}.git"
if [ -d "${GIT_DIR}/.git" ]; then
  log "updating ${GIT_DIR}"
  run git -C "$GIT_DIR" fetch --depth 1 origin "$REF"
  run git -C "$GIT_DIR" checkout -q FETCH_HEAD
else
  log "cloning ${clone_url} → ${GIT_DIR}"
  run mkdir -p "$(dirname "$GIT_DIR")"
  run git clone --depth 1 --branch "$REF" "$clone_url" "$GIT_DIR"
fi

if [ ! -f "${GIT_DIR}/bin/paddy.mjs" ] && [ "$DRY_RUN" != 1 ]; then
  die "checkout is missing bin/paddy.mjs — is $REPO the Paddy repo?"
fi

log "npm install"
if [ "$DRY_RUN" = 1 ]; then
  printf '[dry-run] npm install (in %s)\n' "$GIT_DIR"
else
  (cd "$GIT_DIR" && npm install --no-fund --no-audit)
fi

log "wrapper → ${BIN_DIR}/paddy"
if [ "$DRY_RUN" = 1 ]; then
  printf '[dry-run] write %s/paddy\n' "$BIN_DIR"
else
  mkdir -p "$BIN_DIR"
  cat > "${BIN_DIR}/paddy" <<EOF
#!/usr/bin/env bash
exec node "${GIT_DIR}/bin/paddy.mjs" "\$@"
EOF
  chmod +x "${BIN_DIR}/paddy"
fi

path_has_bin=0
case ":${PATH}:" in
  *":${BIN_DIR}:"*) path_has_bin=1 ;;
esac
if [ "$path_has_bin" != 1 ]; then
  export PATH="${BIN_DIR}:${PATH}"
  profile=""
  if [ -n "${ZSH_VERSION:-}" ] || [ -f "${HOME}/.zshrc" ]; then
    profile="${HOME}/.zshrc"
  elif [ -f "${HOME}/.bashrc" ]; then
    profile="${HOME}/.bashrc"
  else
    profile="${HOME}/.profile"
  fi
  marker="# paddy cli"
  if [ "$DRY_RUN" = 1 ]; then
    printf '[dry-run] append PATH to %s\n' "$profile"
  elif ! grep -Fqs "$marker" "$profile" 2>/dev/null; then
    printf '\n%s\nexport PATH="%s:$PATH"\n' "$marker" "$BIN_DIR" >> "$profile"
    log "added ${BIN_DIR} to PATH in ${profile} — open a new terminal, or: export PATH=\"${BIN_DIR}:\$PATH\""
  fi
fi

if [ "$ONBOARD" = 1 ]; then
  log "paddy onboard"
  if [ "$DRY_RUN" = 1 ]; then
    printf '[dry-run] PADDY_HOME=%s paddy onboard --yes\n' "$PREFIX"
  else
    PADDY_HOME="$PREFIX" "${BIN_DIR}/paddy" onboard --yes || log "onboard skipped (run paddy onboard later)"
  fi
fi

cat <<EOF

Paddy is on this machine.

  paddy gateway          # start the control plane
  paddy dashboard        # web console
  paddy chat "hello"
  paddy models
  paddy doctor

Put keys in ${GIT_DIR}/selfhost.env or ${PREFIX}/selfhost.env, then prefer a model.

EOF
