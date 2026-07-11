#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SDK_ROOT="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-/home/sean/android-sdk}}"
ADB="${SDK_ROOT}/platform-tools/adb"
DHU="${SDK_ROOT}/extras/google/auto/desktop-head-unit"
APK="${ROOT_DIR}/android/app/build/outputs/apk/debug/app-debug.apk"
MODE="${1:-adb}"

if [[ ! -x "${ADB}" ]]; then
  echo "adb not found at ${ADB}"
  echo "Set ANDROID_HOME to your Android SDK path or install Android SDK platform-tools."
  exit 1
fi

if [[ ! -x "${DHU}" ]]; then
  echo "Desktop Head Unit not found at ${DHU}"
  echo "Install it with: ${SDK_ROOT}/cmdline-tools/latest/bin/sdkmanager 'extras;google;auto'"
  exit 1
fi

if ! "${ADB}" get-state >/dev/null 2>&1; then
  echo "No Android phone is connected to adb."
  echo "Connect your phone over USB, enable USB debugging, unlock it, and accept the adb prompt."
  "${ADB}" devices
  exit 1
fi

if [[ -f "${APK}" ]]; then
  echo "Installing ${APK}"
  "${ADB}" install -r "${APK}"
else
  echo "Debug APK not found. Build it first:"
  echo "  cd ${ROOT_DIR}/android && ./gradlew :app:assembleDebug"
  exit 1
fi

if [[ "${MODE}" == "usb" ]]; then
  echo "Starting Desktop Head Unit using USB accessory mode."
  cd "$(dirname "${DHU}")"
  exec "${DHU}" --usb
fi

echo "Forwarding Android Auto head unit server on tcp:5277."
"${ADB}" forward tcp:5277 tcp:5277

echo "Starting Desktop Head Unit using adb tunneling."
echo "If it does not connect, start the Android Auto head unit server on the phone first."
cd "$(dirname "${DHU}")"
exec "${DHU}"
