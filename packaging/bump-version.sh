#!/usr/bin/env bash
# Bumps the extension's version everywhere it's recorded - which today is
# exactly two spots, both in CSXS/manifest.xml:
#   - ExtensionBundleVersion (the bundle-level version)
#   - the inner <Extension Version="..."> (the individual extension's own
#     version - CEP tracks these separately, but Rematch only ever has
#     one Extension entry, so they're always kept in lockstep here)
#
# packaging/package-zxp.sh already reads the version straight out of this
# same file for its output filename, so nothing else needs updating for
# that. This script also rolls CHANGELOG.md's "[Unreleased]" section into
# a new dated version heading every time it runs (if CHANGELOG.md exists),
# so the changelog and the manifest version can't drift apart.
#
# Usage:
#   packaging/bump-version.sh <major|minor|patch>   # bump one column, reset the rest
#   packaging/bump-version.sh <X.Y.Z>                # jump straight to an exact version
#
# Examples:
#   packaging/bump-version.sh patch   # 0.1.1 -> 0.1.2
#   packaging/bump-version.sh minor   # 0.1.2 -> 0.2.0
#   packaging/bump-version.sh major   # 0.2.0 -> 1.0.0
#   packaging/bump-version.sh 2.4.0   # -> exactly 2.4.0, whatever it was before

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MANIFEST="$REPO_ROOT/extension/CSXS/manifest.xml"

ARG="${1:-}"
if [[ -z "$ARG" ]]; then
  echo "Usage: packaging/bump-version.sh <major|minor|patch|X.Y.Z>" >&2
  echo "Examples: packaging/bump-version.sh patch   (0.1.1 -> 0.1.2)" >&2
  echo "          packaging/bump-version.sh minor   (0.1.2 -> 0.2.0)" >&2
  echo "          packaging/bump-version.sh 2.4.0   (-> exactly 2.4.0)" >&2
  exit 1
fi

if [[ ! -f "$MANIFEST" ]]; then
  echo "Couldn't find $MANIFEST - run this from inside the repo." >&2
  exit 1
fi

CURRENT_VERSION="$(grep -o 'ExtensionBundleVersion="[^"]*"' "$MANIFEST" | head -1 | sed -E 's/ExtensionBundleVersion="([^"]*)"/\1/')"
if [[ -z "$CURRENT_VERSION" ]]; then
  echo "Couldn't read the current ExtensionBundleVersion out of $MANIFEST." >&2
  exit 1
fi

IFS='.' read -r CURRENT_MAJOR CURRENT_MINOR CURRENT_PATCH <<< "$CURRENT_VERSION"

case "$ARG" in
  major)
    NEW_VERSION="$((CURRENT_MAJOR + 1)).0.0"
    ;;
  minor)
    NEW_VERSION="${CURRENT_MAJOR}.$((CURRENT_MINOR + 1)).0"
    ;;
  patch)
    NEW_VERSION="${CURRENT_MAJOR}.${CURRENT_MINOR}.$((CURRENT_PATCH + 1))"
    ;;
  *)
    # Not a keyword - must be a plain, exact X.Y.Z version instead.
    if [[ ! "$ARG" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      echo "\"$ARG\" isn't \"major\", \"minor\", \"patch\", or a plain X.Y.Z version (no leading \"v\" or suffixes)." >&2
      exit 1
    fi
    NEW_VERSION="$ARG"
    ;;
esac

if [[ "$CURRENT_VERSION" == "$NEW_VERSION" ]]; then
  echo "$MANIFEST is already at $NEW_VERSION - nothing to do."
  exit 0
fi

# -i '' is the BSD/macOS sed in-place syntax (no separate backup file).
# Two separate substitutions rather than one shared pattern, since
# ExtensionBundleVersion="X" and Version="X" need distinct match text -
# order matters: the ExtensionBundleVersion rule runs first so the plain
# Version="X" rule doesn't also (harmlessly, but confusingly) match
# inside "ExtensionBundleVersion=...".
sed -i '' \
  -e "s/ExtensionBundleVersion=\"$CURRENT_VERSION\"/ExtensionBundleVersion=\"$NEW_VERSION\"/" \
  -e "s/Version=\"$CURRENT_VERSION\"/Version=\"$NEW_VERSION\"/" \
  "$MANIFEST"

echo "Bumped $MANIFEST: $CURRENT_VERSION -> $NEW_VERSION"
echo ""
grep -n "\"$NEW_VERSION\"" "$MANIFEST"

# Rolls whatever's accumulated under "## [Unreleased]" into a new dated
# "## [$NEW_VERSION] - <today>" heading, same as the standard Keep a
# Changelog release workflow - leaving a fresh empty [Unreleased] above
# it for whatever comes next. Skipped entirely if there's no
# CHANGELOG.md, and skipped (with a note) if Unreleased has nothing in
# it and you don't type anything at the prompt below either - an empty
# dated heading isn't worth adding on its own.
CHANGELOG="$REPO_ROOT/CHANGELOG.md"
if [[ -f "$CHANGELOG" ]]; then
  echo ""
  read -r -p "One-line CHANGELOG entry for $NEW_VERSION (blank to skip adding one now): " CHANGELOG_LINE

  if [[ -n "$CHANGELOG_LINE" ]]; then
    sed -i '' "/^## \[Unreleased\]\$/a\\
- $CHANGELOG_LINE
" "$CHANGELOG"
  fi

  EXISTING_UNRELEASED="$(awk '/^## \[Unreleased\]$/{flag=1; next} /^## \[/{flag=0} flag && NF' "$CHANGELOG")"
  if [[ -n "$EXISTING_UNRELEASED" ]]; then
    TODAY="$(date +%Y-%m-%d)"
    sed -i '' "s/^## \[Unreleased\]\$/## [Unreleased]\\
\\
## [$NEW_VERSION] - $TODAY/" "$CHANGELOG"
    echo "Updated $CHANGELOG: [Unreleased] entries moved into [$NEW_VERSION] - $TODAY"
  else
    echo "Nothing under [Unreleased] in $CHANGELOG - left as-is (no empty dated heading added)."
  fi
fi

echo ""
echo "Next: packaging/package-zxp.sh will now name its output after $NEW_VERSION."
echo "Don't forget to commit this change (and tag it, if you're using GitHub Releases)."
