#!/bin/sh
# Runs a local n8n with the packages of this repo, everything lives in .n8n-dev (gitignored).
set -e
cd "$(dirname "$0")/.."
export N8N_USER_FOLDER="$PWD/.n8n-dev"
custom="$N8N_USER_FOLDER/.n8n/custom/node_modules"
mkdir -p "$custom"
for package in "$PWD"/packages/*; do
	ln -sfn "$package" "$custom/$(basename "$package")"
done
[ -x .n8n-dev/node_modules/.bin/n8n ] || npm install --prefix .n8n-dev n8n@stable
N8N_DEV_RELOAD=true N8N_SECURE_COOKIE=false N8N_DIAGNOSTICS_ENABLED=false \
	exec .n8n-dev/node_modules/.bin/n8n
