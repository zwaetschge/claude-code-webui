#!/usr/bin/env bash
# Capture README screenshots from the Android client on a real device.
#
# Exists because the first hand-rolled attempt shipped three unusable images:
# one was the notification shade instead of the app (and leaked private
# notification content into a public repo), the others caught mid-render ghost
# text and a status bar full of personal notification icons. Every step below
# prevents one of those specific defects.
#
# Requires an UNLOCKED device — a locked keyguard cannot be bypassed from adb.
#
# Usage: scripts/capture-android-screenshots.sh <serial> [outdir]
set -euo pipefail

SERIAL="${1:?usage: $0 <serial> [outdir]}"
OUTDIR="${2:-docs/screenshots/android}"
PKG="com.claudewebui.app.debug"
ACT="$PKG/com.claudewebui.app.MainActivity"

adb() { command adb -s "$SERIAL" "$@"; }
sh_()  { adb shell "$@" >/dev/null 2>&1 || true; }

require_unlocked() {
  if adb shell dumpsys window policy | grep -q "mIsShowing=true"; then
    echo "ERROR: keyguard is showing. Unlock $SERIAL and re-run." >&2
    exit 1
  fi
}

demo_on() {
  # Neutral status bar: fixed clock, no notification icons, full signal/battery.
  sh_ settings put global sysui_demo_allowed 1
  for c in "command enter" \
           "command clock -e hhmm 0930" \
           "command notifications -e visible false" \
           "command network -e wifi show -e level 4 -e mobile hide" \
           "command battery -e level 100 -e plugged false"; do
    sh_ am broadcast -a com.android.systemui.demo -e $c
  done
}

demo_off() { sh_ am broadcast -a com.android.systemui.demo -e command exit; }

# Collapse the shade before every shot; a pulled-down shade is what produced
# the "analytics" screenshot that was actually quick settings.
settle() {
  sh_ cmd statusbar collapse
  sleep "${1:-3}"
}

shot() {
  local name="$1"
  settle 3
  adb shell dumpsys window | grep -q "mCurrentFocus.*$PKG" \
    || { echo "ERROR: $PKG is not focused; refusing to capture $name" >&2; exit 1; }
  adb exec-out screencap -p > "$OUTDIR/$name.png"
  echo "captured $OUTDIR/$name.png"
}

mkdir -p "$OUTDIR"
require_unlocked
demo_on
trap demo_off EXIT

sh_ am start -n "$ACT"
sleep 5

echo
echo "Device is on the sessions dashboard."
echo "For each screen: navigate manually, let it finish rendering (no 'Thinking…',"
echo "no streaming text, nothing overlapping), then press Enter here."
echo

for screen in 01-dashboard 02-chat 03-analytics; do
  read -r -p "Ready for $screen? [Enter] " _
  shot "$screen"
done

echo
echo "Review every image before committing. Reject any that show:"
echo "  - a screen that is not the app"
echo "  - personal notifications, media, or real chat content"
echo "  - text overlapping other text (mid-render)"
echo "  - a FAB or dialog covering the content being shown"
echo "  - content cut off mid-element at the bottom edge"
