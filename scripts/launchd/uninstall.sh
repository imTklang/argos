#!/bin/sh
# Stops Argos and removes it from login items (see install.sh).
set -eu

for name in worker api; do
	label="dev.argos.$name"
	launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
	rm -f "$HOME/Library/LaunchAgents/$label.plist"
	echo "  $label removido"
done
