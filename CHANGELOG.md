# Changelog

All notable changes to Rematch are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and version numbers follow [Semantic Versioning](https://semver.org/).
Versions are set in exactly one place - see
[`packaging/bump-version.sh`](packaging/bump-version.sh) - which also keeps
this file's `[Unreleased]` section in sync whenever a new version is cut.

## [Unreleased]

## [0.4.0] - 2026-10-07

### Added
- Initial release: CEP panel for Illustrator that matches a freshly-exported
  QGIS SVG against existing layers and drops new/updated layers in correctly
  scaled and positioned.
- `SCALEREF`-based calibration fallback for exports that don't share the same
  QGIS layout (see `qgis-scaleref-script/`).
- "Copy styles" option to carry over existing fill/stroke from a same-named
  layer already in the target.
