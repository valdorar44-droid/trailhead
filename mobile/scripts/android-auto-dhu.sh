#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "${ROOT_DIR}/.." && pwd)"
SDK_ROOT="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-/home/sean/android-sdk}}"
DHU="${DHU_PATH:-${SDK_ROOT}/extras/google/auto/desktop-head-unit}"
ADB="${ADB_PATH:-}"
SERIAL=""
PACKAGE_ID="com.trailhead.app"
APK=""
NO_INSTALL=0
ALLOW_OTHER_TRAILHEAD_PACKAGES=0
MODE="adb"
EXPECTED_VERSION_NAME=""
EXPECTED_VERSION_CODE=""
EVIDENCE_DIR=""
PREFLIGHT_ONLY=0

usage() {
  cat <<'USAGE'
Trailhead exact-candidate Android Auto / DHU launcher

Required installation choice (pick one):
  --no-install                     Use the exact package already on the device
  --apk <path>                     Install this exact APK before validation

Candidate selection:
  --serial <adb-serial>            Required when more than one device is connected
  --package <application-id>       Default: com.trailhead.app
  --expected-version-name <name>   Fail unless the installed version matches
  --expected-version-code <code>   Fail unless the installed version code matches

DHU and evidence:
  --mode <adb|usb>                 Default: adb
  --evidence-dir <path>            Default: output/android-auto/<timestamp>
  --preflight-only                 Validate and write evidence without launching DHU
  --allow-other-trailhead-packages Allow a debug/alternate Trailhead package to coexist

Examples:
  bash scripts/android-auto-dhu.sh --serial RFCR408DA9B --no-install \
    --expected-version-name 1.0.10 --expected-version-code 59

  bash scripts/android-auto-dhu.sh --serial emulator-5554 --apk ./candidate.apk \
    --package com.trailhead.app --preflight-only

The launcher never builds or silently selects a debug APK. In --no-install mode it
validates the installed package before opening DHU and records local ignored evidence.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --serial) SERIAL="${2:?--serial requires a value}"; shift 2 ;;
    --package) PACKAGE_ID="${2:?--package requires a value}"; shift 2 ;;
    --apk) APK="${2:?--apk requires a value}"; shift 2 ;;
    --no-install) NO_INSTALL=1; shift ;;
    --mode) MODE="${2:?--mode requires adb or usb}"; shift 2 ;;
    --expected-version-name) EXPECTED_VERSION_NAME="${2:?--expected-version-name requires a value}"; shift 2 ;;
    --expected-version-code) EXPECTED_VERSION_CODE="${2:?--expected-version-code requires a value}"; shift 2 ;;
    --evidence-dir) EVIDENCE_DIR="${2:?--evidence-dir requires a value}"; shift 2 ;;
    --preflight-only) PREFLIGHT_ONLY=1; shift ;;
    --allow-other-trailhead-packages) ALLOW_OTHER_TRAILHEAD_PACKAGES=1; shift ;;
    --help|-h) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if [[ "${NO_INSTALL}" -eq 1 && -n "${APK}" ]]; then
  echo "Use either --no-install or --apk, not both." >&2
  exit 2
fi
if [[ "${NO_INSTALL}" -ne 1 && -z "${APK}" ]]; then
  echo "Choose --no-install or provide --apk. The debug APK is never selected implicitly." >&2
  exit 2
fi
if [[ "${MODE}" != "adb" && "${MODE}" != "usb" ]]; then
  echo "--mode must be adb or usb." >&2
  exit 2
fi
if [[ ! "${PACKAGE_ID}" =~ ^[A-Za-z][A-Za-z0-9._-]{2,127}$ ]]; then
  echo "Invalid package ID: ${PACKAGE_ID}" >&2
  exit 2
fi

if [[ -z "${ADB}" && -d /mnt/c/Users ]]; then
  for candidate in /mnt/c/Users/*/AppData/Local/Android/Sdk/platform-tools/adb.exe; do
    if [[ -x "${candidate}" ]]; then ADB="${candidate}"; break; fi
  done
fi
ADB="${ADB:-${SDK_ROOT}/platform-tools/adb}"

if [[ ! -x "${ADB}" ]]; then
  echo "adb not found at ${ADB}. Set ADB_PATH or ANDROID_HOME." >&2
  exit 1
fi
if [[ "${PREFLIGHT_ONLY}" -ne 1 && ! -x "${DHU}" ]]; then
  echo "Desktop Head Unit not found at ${DHU}. Set DHU_PATH or install extras;google;auto." >&2
  exit 1
fi

DEVICE_LINES="$(${ADB} devices | awk 'NR > 1 && $2 == "device" { print $1 }')"
if [[ -z "${SERIAL}" ]]; then
  DEVICE_COUNT="$(printf '%s\n' "${DEVICE_LINES}" | sed '/^$/d' | wc -l | tr -d ' ')"
  if [[ "${DEVICE_COUNT}" != "1" ]]; then
    echo "Pass --serial because ${DEVICE_COUNT} authorized Android devices are connected." >&2
    ${ADB} devices -l >&2
    exit 1
  fi
  SERIAL="$(printf '%s\n' "${DEVICE_LINES}" | head -n 1)"
fi

adb_device() { "${ADB}" -s "${SERIAL}" "$@"; }
DEVICE_STATE="$(adb_device get-state 2>/dev/null | tr -d '\r\n' || true)"
if [[ "${DEVICE_STATE}" != "device" ]]; then
  echo "Android device ${SERIAL} is not connected and authorized." >&2
  ${ADB} devices -l >&2
  exit 1
fi

if [[ -n "${APK}" ]]; then
  if [[ ! -f "${APK}" || "${APK}" != *.apk ]]; then
    echo "--apk must point to an existing .apk file: ${APK}" >&2
    exit 1
  fi
  echo "Installing the explicitly selected APK: ${APK}"
  adb_device install -r "${APK}"
fi

PACKAGE_DUMP="$(adb_device shell dumpsys package "${PACKAGE_ID}" 2>/dev/null || true)"
PACKAGE_PATH="$(adb_device shell pm path "${PACKAGE_ID}" 2>/dev/null | tr -d '\r' | head -n 1)"
if [[ -z "${PACKAGE_PATH}" || "${PACKAGE_PATH}" != package:* ]]; then
  echo "The exact package ${PACKAGE_ID} is not installed on ${SERIAL}." >&2
  exit 1
fi
VERSION_NAME="$(printf '%s\n' "${PACKAGE_DUMP}" | sed -n 's/.*versionName=\([^[:space:]]*\).*/\1/p' | head -n 1)"
VERSION_CODE="$(printf '%s\n' "${PACKAGE_DUMP}" | sed -n 's/.*versionCode=\([0-9][0-9]*\).*/\1/p' | head -n 1)"
if [[ -n "${EXPECTED_VERSION_NAME}" && "${VERSION_NAME}" != "${EXPECTED_VERSION_NAME}" ]]; then
  echo "Expected ${PACKAGE_ID} versionName ${EXPECTED_VERSION_NAME}; installed is ${VERSION_NAME:-unknown}." >&2
  exit 1
fi
if [[ -n "${EXPECTED_VERSION_CODE}" && "${VERSION_CODE}" != "${EXPECTED_VERSION_CODE}" ]]; then
  echo "Expected ${PACKAGE_ID} versionCode ${EXPECTED_VERSION_CODE}; installed is ${VERSION_CODE:-unknown}." >&2
  exit 1
fi

OTHER_TRAILHEAD_PACKAGES="$(adb_device shell pm list packages com.trailhead.app 2>/dev/null | tr -d '\r' | sed 's/^package://' | grep -v -x "${PACKAGE_ID}" || true)"
if [[ -n "${OTHER_TRAILHEAD_PACKAGES}" && "${ALLOW_OTHER_TRAILHEAD_PACKAGES}" -ne 1 ]]; then
  echo "Another Trailhead package is installed, so DHU cannot prove the exact candidate is the only selectable app:" >&2
  printf '  %s\n' ${OTHER_TRAILHEAD_PACKAGES} >&2
  echo "Remove/hide it manually, or acknowledge with --allow-other-trailhead-packages." >&2
  exit 1
fi

TIMESTAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
EVIDENCE_DIR="${EVIDENCE_DIR:-${REPO_ROOT}/output/android-auto/${TIMESTAMP}--${SERIAL}}"
mkdir -p "${EVIDENCE_DIR}"
printf '%s\n' "${PACKAGE_DUMP}" > "${EVIDENCE_DIR}/package.txt"
adb_device shell dumpsys activity service androidx.car.app.connection > "${EVIDENCE_DIR}/car-connection-before.txt" 2>&1 || true
adb_device shell dumpsys car_service > "${EVIDENCE_DIR}/car-service-before.txt" 2>&1 || true
${ADB} forward --list > "${EVIDENCE_DIR}/adb-forwards-before.txt" 2>&1 || true

GIT_SHA="$(git -C "${REPO_ROOT}" rev-parse HEAD 2>/dev/null || true)"
export TRAILHEAD_DHU_SERIAL="${SERIAL}"
export TRAILHEAD_DHU_PACKAGE="${PACKAGE_ID}"
export TRAILHEAD_DHU_VERSION_NAME="${VERSION_NAME}"
export TRAILHEAD_DHU_VERSION_CODE="${VERSION_CODE}"
export TRAILHEAD_DHU_PACKAGE_PATH="${PACKAGE_PATH#package:}"
export TRAILHEAD_DHU_GIT_SHA="${GIT_SHA}"
export TRAILHEAD_DHU_MODE="${MODE}"
export TRAILHEAD_DHU_INSTALL_MODE="$([[ "${NO_INSTALL}" -eq 1 ]] && echo no-install || echo explicit-apk)"
node <<'NODE' > "${EVIDENCE_DIR}/candidate.json"
const safe = name => process.env[name] || null;
process.stdout.write(`${JSON.stringify({
  schema_version: 1,
  captured_at: new Date().toISOString(),
  git_sha: safe('TRAILHEAD_DHU_GIT_SHA'),
  serial: safe('TRAILHEAD_DHU_SERIAL'),
  package_id: safe('TRAILHEAD_DHU_PACKAGE'),
  version_name: safe('TRAILHEAD_DHU_VERSION_NAME'),
  version_code: safe('TRAILHEAD_DHU_VERSION_CODE'),
  installed_package_path: safe('TRAILHEAD_DHU_PACKAGE_PATH'),
  mode: safe('TRAILHEAD_DHU_MODE'),
  install_mode: safe('TRAILHEAD_DHU_INSTALL_MODE'),
}, null, 2)}\n`);
NODE

finish_evidence() {
  local exit_code=$?
  ${ADB} forward --list > "${EVIDENCE_DIR}/adb-forwards-after.txt" 2>&1 || true
  adb_device shell dumpsys activity service androidx.car.app.connection > "${EVIDENCE_DIR}/car-connection-after.txt" 2>&1 || true
  adb_device logcat -d -v threadtime -t 3000 > "${EVIDENCE_DIR}/logcat-tail.txt" 2>&1 || true
  grep -Ei "${PACKAGE_ID}|CarApp|CarService|AndroidAuto|FATAL EXCEPTION|ANR in" "${EVIDENCE_DIR}/logcat-tail.txt" > "${EVIDENCE_DIR}/logcat-car-filtered.txt" || true
  (
    cd "${EVIDENCE_DIR}"
    find . -maxdepth 1 -type f ! -name sha256sums.txt -print0 | sort -z | xargs -0 sha256sum > sha256sums.txt
  )
  echo "Android Auto evidence saved to ${EVIDENCE_DIR}"
  return "${exit_code}"
}
trap finish_evidence EXIT

echo "Verified ${PACKAGE_ID} ${VERSION_NAME} (${VERSION_CODE}) on ${SERIAL}; install mode: ${TRAILHEAD_DHU_INSTALL_MODE}."
if [[ "${PREFLIGHT_ONLY}" -eq 1 ]]; then
  echo "Preflight complete; DHU was not launched."
  exit 0
fi

if [[ "${MODE}" == "usb" ]]; then
  echo "Starting Desktop Head Unit in USB accessory mode."
  (cd "$(dirname "${DHU}")" && "${DHU}" --usb) 2>&1 | tee "${EVIDENCE_DIR}/dhu.log"
  exit "${PIPESTATUS[0]}"
fi

echo "Forwarding the selected device head-unit server on tcp:5277."
adb_device forward tcp:5277 tcp:5277
echo "Starting Desktop Head Unit. Start the Android Auto head-unit server on the selected phone if needed."
(cd "$(dirname "${DHU}")" && "${DHU}") 2>&1 | tee "${EVIDENCE_DIR}/dhu.log"
exit "${PIPESTATUS[0]}"
