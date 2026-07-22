#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PINNED_VERSION="$(tr -d '[:space:]' < "${ROOT_DIR}/.maestro/MAESTRO_VERSION")"

if ! command -v java >/dev/null 2>&1; then
  echo "Java 17 or newer is required before installing Maestro." >&2
  exit 1
fi

JAVA_VERSION="$(java -version 2>&1 | sed -n '1s/.*version "\([0-9][0-9]*\).*/\1/p')"
if [[ -z "${JAVA_VERSION}" || "${JAVA_VERSION}" -lt 17 ]]; then
  echo "Java 17 or newer is required; found: $(java -version 2>&1 | head -n 1)" >&2
  exit 1
fi

echo "Installing the pinned Maestro CLI ${PINNED_VERSION} from the official installer."
export MAESTRO_VERSION="${PINNED_VERSION}"
curl --fail --show-error --silent --location "https://get.maestro.mobile.dev" | bash

MAESTRO_BIN="${MAESTRO_BIN:-${HOME}/.maestro/bin/maestro}"
ACTUAL_VERSION="$(${MAESTRO_BIN} --version 2>&1 | grep -Eo '[0-9]+\.[0-9]+\.[0-9]+' | head -n 1)"
if [[ "${ACTUAL_VERSION}" != "${PINNED_VERSION}" ]]; then
  echo "Expected Maestro ${PINNED_VERSION}, but ${MAESTRO_BIN} reported ${ACTUAL_VERSION:-unknown}." >&2
  exit 1
fi

echo "Maestro ${ACTUAL_VERSION} is ready at ${MAESTRO_BIN}."
