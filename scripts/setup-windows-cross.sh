#!/usr/bin/env bash

set -euo pipefail

if ! command -v clang >/dev/null 2>&1; then
  echo "clang is required for the Windows MSVC cross-build." >&2
  exit 1
fi

if ! command -v rustup >/dev/null 2>&1; then
  setup_directory="$(mktemp -d)"
  setup_script="${setup_directory}/rustup-init.sh"
  trap 'rm -f -- "${setup_script}"; rmdir -- "${setup_directory}" 2>/dev/null || true' EXIT
  curl --proto '=https' --tlsv1.2 --fail --silent --show-error \
    https://sh.rustup.rs \
    --output "${setup_script}"
  sh "${setup_script}" -y --profile minimal --default-toolchain 1.97.1
fi

rustup_bin="$(command -v rustup || true)"
if [[ -z "${rustup_bin}" ]]; then
  rustup_bin="${HOME}/.cargo/bin/rustup"
fi

"${rustup_bin}" toolchain install 1.97.1 \
  --profile minimal \
  --component clippy \
  --component rustfmt
"${rustup_bin}" target add \
  --toolchain 1.97.1 \
  x86_64-pc-windows-msvc

echo "Rust 1.97.1 and x86_64-pc-windows-msvc are ready."
