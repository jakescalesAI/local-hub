#!/usr/bin/env bash
# The emulator job's checks (.github/workflows/tv.yml): install LocalHub TV on the booted Android TV
# emulator, start it unpaired, and prove it runs and draws its home screen. Everything it saw goes
# to the folder given as $2 (screenshots, logcat, the page state, a UI dump) for the artifact.
#
#   bash test/tv/emulator/smoke.sh <apk> <out-dir>
set -uo pipefail

APK=$1
OUT=$2
PKG=local.hub.tv
ACTIVITY=$PKG/.MainActivity
HERE=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$OUT"

failures=()
fail() { echo "::error::$1"; failures+=("$1"); }
step() { echo "[$(date +%T)] $1"; }
shot() { timeout 30 adb exec-out screencap -p > "$OUT/$1.png" && echo "screenshot $1.png ($(stat -c %s "$OUT/$1.png") bytes)"; }

step "wait for device"; timeout 120 adb wait-for-device
echo "device: $(adb shell getprop ro.product.model) / Android $(adb shell getprop ro.build.version.release) (API $(adb shell getprop ro.build.version.sdk))"
echo "WebView: $(adb shell dumpsys webviewupdate | grep -m1 'Current WebView package')"

# ── install and start ─────────────────────────────────────────────────────────────────────────
# Restored from a snapshot, the emulator says it has booted before the package manager answers,
# and a streamed install then waits forever. So: wait for pm, push the APK whole, and retry.
step "wait for the package manager"
for i in $(seq 1 60); do timeout 10 adb shell pm path android 2>/dev/null | grep -q '^package:' && break; sleep 2; done
step "install"
installed=
for i in 1 2 3; do
  timeout 120 adb install --no-streaming -r "$APK" && { installed=1; break; }
  echo "install attempt $i failed, retrying"; sleep 5
done
[ -n "$installed" ] || { echo "::error::adb install failed three times"; exit 1; }
adb logcat -c
adb logcat -b crash -c 2>/dev/null || true
step "start"; timeout 60 adb shell am start -W -n "$ACTIVITY" | tee "$OUT/am-start.txt"
grep -q "Status: ok" "$OUT/am-start.txt" || fail "am start didn't report Status: ok"

sleep 10
shot 01-after-10s

# ── the WebView drew the home screen ─────────────────────────────────────────────────────────
# The debug build turns on WebView debugging, so the page itself can be asked over DevTools.
PID=$(adb shell pidof "$PKG" | tr -d '\r')
if [ -n "$PID" ]; then
  adb forward tcp:9222 "localabstract:webview_devtools_remote_$PID"
  # Waits up to 30 s more for the splash to finish and the grid to fill.
  step "page check"; timeout 90 node "$HERE/check.mjs" page 9222 30 > "$OUT/page.json" 2> "$OUT/page-error.txt"
  page_status=$?
  cat "$OUT/page.json" "$OUT/page-error.txt"
  [ $page_status -eq 0 ] || fail "$(tail -n1 "$OUT/page-error.txt" | sed 's/^FAIL: //')"
  adb forward --remove tcp:9222 || true
else
  fail "local.hub.tv wasn't running 10 s after launch, so its page couldn't be checked"
fi

shot 02-home
node "$HERE/check.mjs" png "$OUT/02-home.png" || fail "the screen is blank or a single colour (02-home.png)"
step "ui dump"; timeout 30 adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1 && adb pull /sdcard/ui.xml "$OUT/ui.xml" >/dev/null 2>&1 || true

# ── still alive, still in front, never crashed ───────────────────────────────────────────────
PID=$(adb shell pidof "$PKG" | tr -d '\r')
[ -n "$PID" ] && echo "pid: $PID" || fail "local.hub.tv isn't running (pidof found nothing)"

step "foreground and logcat"; timeout 30 adb shell dumpsys activity activities > "$OUT/activities.txt"
resumed=$(grep -E 'mResumedActivity|topResumedActivity' "$OUT/activities.txt" | head -n 3)
echo "resumed: $resumed"
echo "$resumed" | grep -q "$ACTIVITY" || fail "MainActivity isn't the resumed activity: ${resumed:-none}"
timeout 30 adb shell dumpsys window | grep -m1 mCurrentFocus | tee "$OUT/focus.txt"

adb logcat -d -v threadtime > "$OUT/logcat-all.txt"
adb logcat -d -b crash -v threadtime > "$OUT/logcat-crash.txt" 2>/dev/null || true
[ -n "$PID" ] && adb logcat -d -v threadtime --pid="$PID" > "$OUT/logcat-app.txt"
# chromium carries the page's console; ActivityManager and AndroidRuntime carry starts and crashes.
grep -E "$PKG|chromium|AndroidRuntime|FATAL|ANR in" "$OUT/logcat-all.txt" > "$OUT/logcat-excerpt.txt" || true

if grep -q "$PKG" "$OUT/logcat-crash.txt"; then fail "the crash log has an entry for $PKG"; fi
if grep -A3 "FATAL EXCEPTION" "$OUT/logcat-all.txt" | grep -q "Process: $PKG"; then fail "FATAL EXCEPTION in $PKG"; fi
if grep -q ">>> $PKG <<<" "$OUT/logcat-all.txt"; then fail "native crash (tombstone) in $PKG"; fi
if grep -q "ANR in $PKG" "$OUT/logcat-all.txt"; then fail "$PKG stopped responding (ANR)"; fi

echo "── logcat excerpt ──"
tail -n 80 "$OUT/logcat-excerpt.txt"

if [ ${#failures[@]} -gt 0 ]; then
  echo "LocalHub TV failed on the emulator:"
  printf ' - %s\n' "${failures[@]}"
  exit 1
fi
echo "LocalHub TV started, stayed up, stayed in front and drew its home screen."
