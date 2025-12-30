#!/usr/bin/env bash
set -euo pipefail

export HOME="${HOME:-/root}"

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required env var: ${name}" >&2
    exit 1
  fi
}

require_env TAKOPI_BOT_TOKEN
require_env TAKOPI_CHAT_ID
require_env TAKOPI_REPO_URL

TAKOPI_REPO_BRANCH="${TAKOPI_REPO_BRANCH:-main}"
TAKOPI_WORKDIR="${TAKOPI_WORKDIR:-/workspace/repo}"
TAKOPI_FINAL_NOTIFY="${TAKOPI_FINAL_NOTIFY:-true}"
TAKOPI_DEBUG="${TAKOPI_DEBUG:-false}"

mkdir -p "${HOME}/.codex"

cat > "${HOME}/.codex/takopi.toml" <<EOF_TAKOPI
bot_token = "${TAKOPI_BOT_TOKEN}"
chat_id = ${TAKOPI_CHAT_ID}
EOF_TAKOPI

if [[ -n "${TAKOPI_CODEX_CONFIG_TOML:-}" ]]; then
  printf "%s" "${TAKOPI_CODEX_CONFIG_TOML}" > "${HOME}/.codex/config.toml"
fi

repo_url="${TAKOPI_REPO_URL}"
if [[ -n "${GITHUB_PAT:-}" && "${repo_url}" =~ ^https://github.com/ ]]; then
  repo_url="https://${GITHUB_PAT}@github.com/${repo_url#https://github.com/}"
fi

if [[ ! -d "${TAKOPI_WORKDIR}/.git" ]]; then
  rm -rf "${TAKOPI_WORKDIR}"
  git clone --depth 1 -b "${TAKOPI_REPO_BRANCH}" "${repo_url}" "${TAKOPI_WORKDIR}"
fi

cd "${TAKOPI_WORKDIR}"

args=()
if [[ "${TAKOPI_FINAL_NOTIFY}" == "false" ]]; then
  args+=("--no-final-notify")
fi
if [[ "${TAKOPI_DEBUG}" == "true" ]]; then
  args+=("--debug")
fi
if [[ -n "${CODEX_PROFILE:-}" ]]; then
  args+=("--profile" "${CODEX_PROFILE}")
fi

exec python -m takopi.exec_bridge "${args[@]}"
