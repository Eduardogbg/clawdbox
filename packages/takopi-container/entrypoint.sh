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

is_truthy() {
  local value="${1:-}"
  [[ "${value}" == "true" || "${value}" == "1" ]]
}

is_falsey() {
  local value="${1:-}"
  [[ "${value}" == "false" || "${value}" == "0" ]]
}

strip_wrapping_quotes() {
  local value="${1:-}"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  while [[ ${#value} -ge 2 ]]; do
    local first="${value:0:1}"
    local last="${value: -1}"
    if [[ ("${first}" == "'" && "${last}" == "'") || ("${first}" == "\"" && "${last}" == "\"") ]]; then
      value="${value:1:${#value}-2}"
      value="${value#"${value%%[![:space:]]*}"}"
      value="${value%"${value##*[![:space:]]}"}"
      continue
    fi
    break
  done
  printf "%s" "${value}"
}

require_env TAKOPI_BOT_TOKEN
require_env TAKOPI_CHAT_ID
require_env TAKOPI_REPO_URL

if [[ -n "${OPENAI_API_KEY:-}" && -z "${CODEX_API_KEY:-}" ]]; then
  export CODEX_API_KEY="${OPENAI_API_KEY}"
fi
if [[ -n "${CODEX_API_KEY:-}" && -z "${OPENAI_API_KEY:-}" ]]; then
  export OPENAI_API_KEY="${CODEX_API_KEY}"
fi

TAKOPI_REPO_BRANCH="${TAKOPI_REPO_BRANCH:-main}"
TAKOPI_WORKDIR="${TAKOPI_WORKDIR:-/workspace/repo}"
TAKOPI_FINAL_NOTIFY="${TAKOPI_FINAL_NOTIFY:-true}"
TAKOPI_DEBUG="${TAKOPI_DEBUG:-false}"
TAKOPI_DEBUG_TELEGRAM="${TAKOPI_DEBUG_TELEGRAM:-false}"
TAKOPI_ALLOW_GROUP="${TAKOPI_ALLOW_GROUP:-false}"
TAKOPI_DELETE_WEBHOOK="${TAKOPI_DELETE_WEBHOOK:-true}"
TAKOPI_STRIP_COMMANDS="${TAKOPI_STRIP_COMMANDS:-true}"
TAKOPI_CODEX_ARGS="${TAKOPI_CODEX_ARGS:-}"
TAKOPI_LOG_SERVER="${TAKOPI_LOG_SERVER:-}"
TAKOPI_LOG_PORT="${TAKOPI_LOG_PORT:-8080}"

if [[ -z "${TAKOPI_CODEX_ARGS}" ]]; then
  TAKOPI_CODEX_ARGS="--dangerously-bypass-approvals-and-sandbox"
fi
TAKOPI_CODEX_ARGS="$(strip_wrapping_quotes "${TAKOPI_CODEX_ARGS}")"
export TAKOPI_CODEX_ARGS

if [[ -z "${TAKOPI_LOG_SERVER}" ]] && is_truthy "${TAKOPI_DEBUG}"; then
  TAKOPI_LOG_SERVER="true"
fi

mkdir -p "${HOME}/.codex"

cat > "${HOME}/.codex/takopi.toml" <<EOF_TAKOPI
bot_token = "${TAKOPI_BOT_TOKEN}"
chat_id = ${TAKOPI_CHAT_ID}
EOF_TAKOPI

if is_truthy "${TAKOPI_DELETE_WEBHOOK}"; then
  python - <<'PY'
from __future__ import annotations

import json
import os
import sys
import urllib.request

token = os.environ.get("TAKOPI_BOT_TOKEN")
if not token:
    print("Missing TAKOPI_BOT_TOKEN for deleteWebhook", file=sys.stderr)
    sys.exit(0)

request = urllib.request.Request(
    f"https://api.telegram.org/bot{token}/deleteWebhook",
    method="POST",
)

try:
    with urllib.request.urlopen(request, timeout=10) as response:
        data = json.load(response)
except Exception as exc:
    print(f"Failed to delete webhook: {exc}", file=sys.stderr)
    sys.exit(0)

if not data.get("ok"):
    print(f"Failed to delete webhook: {data}", file=sys.stderr)
PY
fi

if is_truthy "${TAKOPI_DEBUG}" || is_truthy "${TAKOPI_DEBUG_TELEGRAM}"; then
  python - <<'PY'
from __future__ import annotations

import json
import os
import urllib.request

token = os.environ.get("TAKOPI_BOT_TOKEN")
chat_id = os.environ.get("TAKOPI_CHAT_ID")
if not token or not chat_id:
    raise SystemExit(0)

def call(method: str, payload: dict | None = None) -> dict:
    data = None
    headers = {}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{token}/{method}",
        data=data,
        headers=headers,
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            return json.load(response)
    except Exception as exc:
        return {"ok": False, "error": str(exc)}

summary = {
    "getMe": call("getMe"),
    "getWebhookInfo": call("getWebhookInfo"),
    "getUpdates": call("getUpdates", {"timeout": 0, "limit": 1, "allowed_updates": ["message"]}),
}

text = "takopi debug telegram:\n" + json.dumps(summary, indent=2)
notify = urllib.request.Request(
    f"https://api.telegram.org/bot{token}/sendMessage",
    data=json.dumps({"chat_id": int(chat_id), "text": text}).encode("utf-8"),
    headers={"Content-Type": "application/json"},
)
try:
    urllib.request.urlopen(notify, timeout=10)
except Exception:
    pass
PY
fi

if is_truthy "${TAKOPI_DEBUG}"; then
  python - <<'PY'
from __future__ import annotations

import json
import os
import urllib.request

token = os.environ.get("TAKOPI_BOT_TOKEN")
chat_id = os.environ.get("TAKOPI_CHAT_ID")
api_key = os.environ.get("OPENAI_API_KEY")

if not token or not chat_id or not api_key:
    raise SystemExit(0)

req = urllib.request.Request(
    "https://api.openai.com/v1/models",
    headers={"Authorization": f"Bearer {api_key}"},
)

try:
    with urllib.request.urlopen(req, timeout=10) as response:
        if response.status == 200:
            raise SystemExit(0)
        error_text = f"OpenAI check failed: HTTP {response.status}"
except Exception as exc:
    error_text = f"OpenAI check failed: {exc}"

payload = json.dumps({"chat_id": int(chat_id), "text": error_text}).encode("utf-8")
notify = urllib.request.Request(
    f"https://api.telegram.org/bot{token}/sendMessage",
    data=payload,
    headers={"Content-Type": "application/json"},
)
try:
    urllib.request.urlopen(notify, timeout=10)
except Exception:
    pass
PY
fi

if [[ -n "${TAKOPI_CODEX_CONFIG_TOML:-}" ]]; then
  printf "%s" "${TAKOPI_CODEX_CONFIG_TOML}" > "${HOME}/.codex/config.toml"
fi

if is_truthy "${TAKOPI_ALLOW_GROUP}"; then
  python - <<'PY'
from __future__ import annotations
from pathlib import Path

import takopi

path = Path(takopi.__file__).parent / "exec_bridge.py"
source = path.read_text()
old = '            if not (msg["chat"]["id"] == msg["from"]["id"] == cfg.chat_id):\n                continue\n'
new = '            if msg["chat"]["id"] != cfg.chat_id:\n                continue\n'

if old not in source:
    raise SystemExit("takopi patch failed: expected filter not found")

path.write_text(source.replace(old, new))
PY
fi

if is_truthy "${TAKOPI_STRIP_COMMANDS}"; then
  python - <<'PY'
from __future__ import annotations
from pathlib import Path

import takopi

path = Path(takopi.__file__).parent / "exec_bridge.py"
source = path.read_text()

needle = '            if "text" not in msg:\n                continue\n'
if "text = msg.get(\"text\")" in source:
    raise SystemExit(0)

replacement = (
    '            if "text" not in msg:\n'
    '                continue\n'
    '            text = msg.get("text")\n'
    '            if not isinstance(text, str):\n'
    '                continue\n'
    '            text = text.strip()\n'
    '            if text.startswith("/"):\n'
    '                text = re.sub(r"^/\\w+(?:@\\w+)?\\s*", "", text)\n'
    '            if text.startswith("@"):\n'
    '                text = re.sub(r"^@\\w+\\s*", "", text)\n'
    '            if not text:\n'
    '                continue\n'
    '            msg["text"] = text\n'
)

if needle not in source:
    raise SystemExit("takopi patch failed: expected text guard not found")

path.write_text(source.replace(needle, replacement))
PY
fi

python - <<'PY'
from __future__ import annotations
from pathlib import Path

import takopi

def patch_telegram_send(path: Path) -> None:
    source = path.read_text()
    if "allow_sending_without_reply" not in source:
        sig_old = (
            "        reply_to_message_id: int | None = None,\n"
            "        disable_notification: bool | None = False,\n"
        )
        sig_new = (
            "        reply_to_message_id: int | None = None,\n"
            "        allow_sending_without_reply: bool | None = None,\n"
            "        disable_notification: bool | None = False,\n"
        )
        if sig_old not in source:
            raise SystemExit("takopi patch failed: send_message signature not found")
        source = source.replace(sig_old, sig_new)

        block_old = (
            "        if reply_to_message_id is not None:\n"
            "            params[\"reply_to_message_id\"] = reply_to_message_id\n"
        )
        block_new = (
            "        if reply_to_message_id is not None:\n"
            "            params[\"reply_to_message_id\"] = reply_to_message_id\n"
            "        if allow_sending_without_reply is not None:\n"
            "            params[\"allow_sending_without_reply\"] = allow_sending_without_reply\n"
        )
        if block_old not in source:
            raise SystemExit("takopi patch failed: send_message params block not found")
        source = source.replace(block_old, block_new)
    path.write_text(source)

def patch_exec_bridge(path: Path) -> None:
    source = path.read_text()
    if "import shlex" not in source:
        source = source.replace("import shutil\n", "import shutil\nimport shlex\n")

    extra_old = '    extra_args = ["-c", "notify=[]"]\n'
    extra_block_old = (
        '    extra_args_env = os.environ.get("TAKOPI_CODEX_ARGS") or os.environ.get("CODEX_ARGS")\n'
        '    if extra_args_env:\n'
        '        extra_args.extend(shlex.split(extra_args_env))\n'
    )
    extra_block_new = (
        '    extra_args_env = os.environ.get("TAKOPI_CODEX_ARGS") or os.environ.get("CODEX_ARGS")\n'
        '    if extra_args_env:\n'
        '        extra_args_env = extra_args_env.strip()\n'
        '        if len(extra_args_env) >= 2 and extra_args_env[0] == extra_args_env[-1] and extra_args_env[0] in (chr(34), chr(39)):\n'
        '            extra_args_env = extra_args_env[1:-1]\n'
        '        extra_args.extend(shlex.split(extra_args_env))\n'
    )
    if "TAKOPI_CODEX_ARGS" not in source:
        extra_new = (
            '    extra_args = ["-c", "notify=[]"]\n'
            + extra_block_new
        )
        if extra_old not in source:
            raise SystemExit("takopi patch failed: extra_args not found")
        source = source.replace(extra_old, extra_new)
    else:
        source = source.replace(extra_block_old, extra_block_new)
    sig_old = (
        "    reply_to_message_id: int | None = None,\n"
        "    disable_notification: bool = False,\n"
    )
    sig_new = (
        "    reply_to_message_id: int | None = None,\n"
        "    allow_sending_without_reply: bool | None = None,\n"
        "    disable_notification: bool = False,\n"
    )
    if sig_old in source:
        source = source.replace(sig_old, sig_new)

    send_old = (
        "        reply_to_message_id=reply_to_message_id,\n"
        "        disable_notification=disable_notification,\n"
    )
    send_new = (
        "        reply_to_message_id=reply_to_message_id,\n"
        "        allow_sending_without_reply=allow_sending_without_reply,\n"
        "        disable_notification=disable_notification,\n"
    )
    if send_old in source:
        source = source.replace(send_old, send_new)

    if "allow_sending_without_reply=True" not in source:
        source = source.replace(
            "            reply_to_message_id=user_msg_id,\n",
            "            reply_to_message_id=user_msg_id,\n            allow_sending_without_reply=True,\n",
        )
        source = source.replace(
            "            reply_to_message_id=reply_to_message_id,\n",
            "            reply_to_message_id=reply_to_message_id,\n            allow_sending_without_reply=True,\n",
        )
    args_old = (
        "        args = [self.codex_cmd]\n"
        "        args.extend(self.extra_args)\n"
        "        args.extend([\"exec\", \"--json\"])\n"
    )
    args_new = (
        "        args = [self.codex_cmd, \"exec\"]\n"
        "        args.extend(self.extra_args)\n"
        "        args.append(\"--json\")\n"
    )
    if args_old in source:
        source = source.replace(args_old, args_new)
    err_old = '                raise RuntimeError(f"codex exec failed (rc={rc}). stderr tail:\\n{tail}")\n'
    err_new = '                raise RuntimeError(f"codex exec failed (rc={rc}). args={args!r} stderr tail:\\n{tail}")\n'
    if err_old in source:
        source = source.replace(err_old, err_new)
    path.write_text(source)

patch_telegram_send(Path(takopi.__file__).parent / "telegram.py")
patch_exec_bridge(Path(takopi.__file__).parent / "exec_bridge.py")
PY

if is_truthy "${TAKOPI_DEBUG:-false}" || is_truthy "${TAKOPI_DEBUG_ARGS:-false}"; then
  python - <<'PY'
from __future__ import annotations

import json
import os
import shlex
from pathlib import Path
import urllib.request

import takopi

token = os.environ.get("TAKOPI_BOT_TOKEN")
chat_id = os.environ.get("TAKOPI_CHAT_ID")
raw = os.environ.get("TAKOPI_CODEX_ARGS") or os.environ.get("CODEX_ARGS")

normalized = None
split_args: list[str] = []
if raw is not None:
    normalized = raw.strip()
    if len(normalized) >= 2 and normalized[0] == normalized[-1] and normalized[0] in ('"', "'"):
        normalized = normalized[1:-1]
    split_args = shlex.split(normalized) if normalized else []

path = Path(takopi.__file__).parent / "exec_bridge.py"
source = path.read_text()
has_norm = "extra_args_env = extra_args_env.strip()" in source

payload = {
    "raw": raw,
    "normalized": normalized,
    "split": split_args,
    "exec_bridge_norm": has_norm,
}

if token and chat_id:
    text = "takopi debug args:\\n" + json.dumps(payload, indent=2)
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{token}/sendMessage",
        data=json.dumps({"chat_id": int(chat_id), "text": text}).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    try:
        urllib.request.urlopen(req, timeout=10)
    except Exception:
        pass
PY
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
if is_falsey "${TAKOPI_FINAL_NOTIFY}"; then
  args+=("--no-final-notify")
fi
if is_truthy "${TAKOPI_DEBUG}"; then
  args+=("--debug")
fi
if [[ -n "${CODEX_PROFILE:-}" ]]; then
  args+=("--profile" "${CODEX_PROFILE}")
fi

LOG_PATH="/tmp/takopi.log"
touch "${LOG_PATH}"

if is_truthy "${TAKOPI_LOG_SERVER}"; then
  python - <<'PY' &
from __future__ import annotations

import json
import os
from http.server import BaseHTTPRequestHandler, HTTPServer

LOG_PATH = os.environ.get("TAKOPI_LOG_PATH", "/tmp/takopi.log")
LOG_PORT = int(os.environ.get("TAKOPI_LOG_PORT", "8080"))

class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        if self.path != "/logs":
            self.send_response(404)
            self.end_headers()
            return
        try:
            with open(LOG_PATH, "rb") as handle:
                data = handle.read()[-20000:]
            payload = data.decode("utf-8", errors="replace")
        except Exception as exc:
            payload = f"failed to read log: {exc}"
        body = json.dumps({"logs": payload}).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args) -> None:
        return

server = HTTPServer(("0.0.0.0", LOG_PORT), Handler)
server.serve_forever()
PY
fi

python -m takopi.exec_bridge "${args[@]}" 2>&1 | tee -a "${LOG_PATH}"
