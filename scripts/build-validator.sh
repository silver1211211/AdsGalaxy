#!/usr/bin/env bash
set -euo pipefail

BUILD_DIR="${1:?usage: build-validator.sh BUILD_DIR}"
required=(BUILD_ID prerender-manifest.json routes-manifest.json build-manifest.json server)
for item in "${required[@]}"; do
  test -e "$BUILD_DIR/$item" || { echo "INVALID_BUILD missing=$item dir=$BUILD_DIR" >&2; exit 1; }
done
test -s "$BUILD_DIR/BUILD_ID" || { echo "INVALID_BUILD empty=BUILD_ID" >&2; exit 1; }
test -d "$BUILD_DIR/static" || { echo "INVALID_BUILD missing=static" >&2; exit 1; }
echo "VALID_BUILD build_id=$(tr -d '\r\n' < "$BUILD_DIR/BUILD_ID") dir=$BUILD_DIR"

