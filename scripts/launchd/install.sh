#!/bin/sh
# Keeps Argos running on this Mac: the worker (scans at 8h and 18h plus the
# Telegram bot) and the dashboard at http://localhost:3333. Both start at
# login and restart if they crash. A scan missed while the Mac was asleep
# runs when it wakes.
#
#   sh scripts/launchd/install.sh     # install or update (rerun after upgrading Node)
#   sh scripts/launchd/uninstall.sh   # remove
set -eu

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
AGENTS="$HOME/Library/LaunchAgents"
LOGS="$ROOT/data/logs"
DOMAIN="gui/$(id -u)"

# The real binary, not a version manager shim: launchd has no shell setup.
NODE=$(command -v mise >/dev/null 2>&1 && mise which node 2>/dev/null || command -v node)
if [ -z "$NODE" ] || [ ! -x "$NODE" ]; then
	echo "Node não encontrado no PATH." >&2
	exit 1
fi
if [ ! -f "$ROOT/.env" ]; then
	echo "Falta o .env (copie de .env.example e preencha)." >&2
	exit 1
fi

mkdir -p "$AGENTS" "$LOGS"
echo "Gerando o dashboard..."
(cd "$ROOT" && pnpm build:web >/dev/null)

# install_agent <name> <entry point>
install_agent() {
	label="dev.argos.$1"
	plist="$AGENTS/$label.plist"
	cat >"$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key><string>$label</string>
	<key>ProgramArguments</key>
	<array>
		<string>$NODE</string>
		<string>--env-file-if-exists=.env</string>
		<string>--import</string>
		<string>tsx</string>
		<string>$2</string>
	</array>
	<key>WorkingDirectory</key><string>$ROOT</string>
	<key>RunAtLoad</key><true/>
	<!-- Restart after a crash, not after a clean stop. -->
	<key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
	<key>ThrottleInterval</key><integer>60</integer>
	<!-- Lets a running scan finish before the process is killed. -->
	<key>ExitTimeOut</key><integer>600</integer>
	<key>StandardOutPath</key><string>$LOGS/$1.log</string>
	<key>StandardErrorPath</key><string>$LOGS/$1.log</string>
</dict>
</plist>
EOF
	launchctl bootout "$DOMAIN/$label" 2>/dev/null || true
	launchctl bootstrap "$DOMAIN" "$plist"
	echo "  $label ativo (log em data/logs/$1.log)"
}

install_agent worker apps/api/src/worker.ts
install_agent api apps/api/src/serve.ts
echo "Pronto. Dashboard em http://localhost:3333"
