#!/usr/bin/env bash
# The panel is static; any localhost server works. 4180 matches the registered redirect URI.
cd "$(dirname "$0")"
exec python3 -m http.server 4180
