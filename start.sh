#!/bin/sh
# Mac and Linux: starts this hub in the background and logs to hub.log. config/on-start.sh runs too, if you made one.
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$here" || exit 1
nohup node "$here/server.mjs" >> "$here/hub.log" 2>&1 &
if [ -x "$here/config/on-start.sh" ]; then "$here/config/on-start.sh"; fi
