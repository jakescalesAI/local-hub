#!/bin/sh
# Mac and Linux: restarts this hub. Running chat replies stop, and they keep what had arrived.
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
pkill -f "$here/server.mjs"
sleep 1
exec "$here/start.sh"
