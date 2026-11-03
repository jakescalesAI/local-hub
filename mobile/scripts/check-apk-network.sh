#!/bin/sh
# Passes only when the APK's network security config is found, read, and allows no plain HTTP anywhere.
# A shrunk release build can rename files under res/, so the path comes from the resource table, not a guess,
# and a config that can't be found fails instead of passing on empty input.
#
#   sh scripts/check-apk-network.sh <path to aapt2> <apk>
set -eu
aapt=$1
apk=$2
file=$("$aapt" dump resources "$apk" | grep -A3 'xml/network_security_config' | grep -o 'res/[^ ]*\.xml' | head -n 1) || true
if [ -z "$file" ]; then
  echo "No network_security_config in $apk"
  exit 1
fi
tree=$("$aapt" dump xmltree --file "$file" "$apk")
echo "$tree"
if ! echo "$tree" | grep -q 'base-config'; then
  echo "$file has no base-config"
  exit 1
fi
if echo "$tree" | grep -qE 'cleartextTrafficPermitted[^=]*=(true|0xffffffff)|10\.0\.2\.2|127\.0\.0\.1|localhost'; then
  echo "$file allows plain HTTP"
  exit 1
fi
echo "$file: HTTPS only"
