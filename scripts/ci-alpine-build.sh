#!/bin/sh
set -eu

apk add --no-cache build-base curl
# These are native Alpine builds, so both targets use the container's compiler.
export CARGO_TARGET_X86_64_UNKNOWN_LINUX_MUSL_LINKER=cc
export CARGO_TARGET_AARCH64_UNKNOWN_LINUX_MUSL_LINKER=cc
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain 1.90.0
export PATH="$HOME/.cargo/bin:$PATH"
rustup component add clippy rustfmt
npm install --global "$(node -p 'require("./package.json").packageManager')"
pnpm install --frozen-lockfile
pnpm check:rust-format
pnpm check:rust
pnpm test:rust
pnpm build
