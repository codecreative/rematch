#!/usr/bin/env bash
# Packages extension/ into a signed .zxp file for distribution to
# colleagues (see SETUP.md's "Packaging" section). Requires ZXPSignCmd -
# see packaging/README.md for where to get it and what this does on
# first run.
#
# Usage:
#   packaging/package-zxp.sh
#
# Reads the bundle id + version straight out of CSXS/manifest.xml, so the
# output filename always matches what's actually in the manifest - bump
# ExtensionBundleVersion there before running this for a new build.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
EXTENSION_DIR="$REPO_ROOT/extension"
MANIFEST="$EXTENSION_DIR/CSXS/manifest.xml"
CERT_PATH="$SCRIPT_DIR/cert.p12"
DIST_DIR="$SCRIPT_DIR/dist"

if [[ ! -f "$MANIFEST" ]]; then
  echo "Couldn't find $MANIFEST - run this from inside the repo." >&2
  exit 1
fi

# Prefer ZXPSignCmd on PATH; fall back to a copy dropped directly into
# packaging/, so there's nowhere else to configure if you'd rather not
# touch PATH just for this one tool.
ZXPSIGNCMD="$(command -v ZXPSignCmd || true)"
if [[ -z "$ZXPSIGNCMD" && -x "$SCRIPT_DIR/ZXPSignCmd" ]]; then
  ZXPSIGNCMD="$SCRIPT_DIR/ZXPSignCmd"
fi
if [[ -z "$ZXPSIGNCMD" ]]; then
  echo "ZXPSignCmd not found on PATH or at $SCRIPT_DIR/ZXPSignCmd."
  echo "Download it from https://github.com/Adobe-CEP/CEP-Resources/tree/master/ZXPSignCMD"
  echo "then either add it to your PATH or drop the binary into $SCRIPT_DIR (chmod +x it) and re-run."
  exit 1
fi

BUNDLE_ID="$(grep -o 'ExtensionBundleId="[^"]*"' "$MANIFEST" | head -1 | sed -E 's/ExtensionBundleId="([^"]*)"/\1/')"
VERSION="$(grep -o 'ExtensionBundleVersion="[^"]*"' "$MANIFEST" | head -1 | sed -E 's/ExtensionBundleVersion="([^"]*)"/\1/')"

if [[ -z "$BUNDLE_ID" || -z "$VERSION" ]]; then
  echo "Couldn't read ExtensionBundleId/ExtensionBundleVersion out of $MANIFEST." >&2
  exit 1
fi

mkdir -p "$DIST_DIR"

# The cert is created once and reused for every future package - signing
# an update with a *different* cert makes Illustrator treat it as a
# different, untrusted extension rather than an update to the same one.
if [[ ! -f "$CERT_PATH" ]]; then
  echo "No cert found at $CERT_PATH - creating one now (first run only)."
  echo "This cert gets reused for every future package, so back it up somewhere safe -"
  echo "losing it means colleagues installing a later update won't get a smooth upgrade."
  echo ""
  read -r -p "Organization name for the cert (e.g. your team/company name): " CERT_ORG
  read -r -s -p "New cert password (you'll need this again for every future package): " CERT_PASSWORD
  echo ""
  "$ZXPSIGNCMD" -selfSignedCert US CA "$CERT_ORG" "Rematch" "$CERT_PASSWORD" "$CERT_PATH"
  echo "Cert created at $CERT_PATH."
  echo ""
else
  read -r -s -p "Cert password: " CERT_PASSWORD
  echo ""
fi

OUTPUT="$DIST_DIR/${BUNDLE_ID}-${VERSION}.zxp"

# Timestamps the signature against a trusted timestamp authority, so its
# validity is anchored to the actual signing time rather than "now" -
# without this, some installers are pickier about a self-signed cert.
# Requires network access to reach the TSA at packaging time.
TSA_URL="http://timestamp.apple.com/ts01"

echo "Packaging $EXTENSION_DIR -> $OUTPUT"
"$ZXPSIGNCMD" -sign "$EXTENSION_DIR" "$OUTPUT" "$CERT_PATH" "$CERT_PASSWORD" -tsa "$TSA_URL"

echo ""
echo "Done: $OUTPUT"
echo "Send this file to colleagues along with a ZXP/UXP installer (e.g. https://aescripts.com/learn/zxp-installer/)."
