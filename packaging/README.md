# Packaging a signed .zxp for colleagues to test

Only needed for distributing to other machines - your own day-to-day dev
loop is still the symlinked, unsigned folder described in
[../SETUP.md](../SETUP.md).

## One-time setup

1. Download `ZXPSignCmd` for your OS from
   [Adobe-CEP/CEP-Resources](https://github.com/Adobe-CEP/CEP-Resources/tree/master/ZXPSignCMD).
2. Either put it on your `PATH`, or drop the binary directly into this
   `packaging/` folder and `chmod +x` it - `package-zxp.sh` checks both.

## Every time you want to cut a build

1. Bump the version - the `.zxp`'s output filename is derived from this,
   so colleagues can tell builds apart:
   ```bash
   packaging/bump-version.sh patch   # or minor / major / an exact X.Y.Z
   ```
   Updates `ExtensionBundleVersion` and the inner `<Extension Version="...">`
   in [`../extension/CSXS/manifest.xml`](../extension/CSXS/manifest.xml)
   together, so they can't drift out of sync. It'll also prompt for a
   one-line entry and roll whatever's under `[Unreleased]` in
   [`../CHANGELOG.md`](../CHANGELOG.md) into a new dated version heading,
   so the changelog can't drift out of sync either.
2. Run:
   ```bash
   packaging/package-zxp.sh
   ```
3. **First run only:** it'll ask for an organization name and a cert
   password, then create `packaging/cert.p12` - a self-signed certificate
   that gets reused for every future build. Back this up somewhere safe;
   losing it means a later update won't be recognized as the same
   extension by Illustrator (colleagues would need to fully uninstall the
   old one first).
4. **Every run:** it'll ask for the cert password again, then produce
   `packaging/dist/com.codecreative.rematch-<version>.zxp`.
5. Tag the commit (`git tag vX.Y.Z && git push --tags`), then attach that
   `.zxp` as a binary asset on the matching GitHub Release - drag it into
   the Release draft on github.com, or `gh release create vX.Y.Z
   packaging/dist/*.zxp`. It's gitignored (see "Notes" below), so this is
   the only place it ends up published; it never gets committed.
6. Point people at the [Releases page](../../releases) and the "Installing
   the extension" section of [`../README.md`](../README.md) - no
   `PlayerDebugMode`/Terminal steps needed on their end. See "Installer
   quirks" below before assuming it didn't work.

## Notes

- `cert.p12` and `dist/` are both gitignored - the cert is a secret you
  don't want committed, and the built `.zxp` files are just build output.
- This is a one-way "cut a snapshot" step - editing files inside `dist/`
  or re-running the script doesn't affect your live symlinked dev copy at
  all, and vice versa.

## Installer quirks

- **Dragging the `.zxp` onto the ZXP/UXP Installer app didn't work** for
  a colleague - double-clicking the `.zxp` (or right-click → Open With →
  ZXP/UXP Installer) did. If drag-and-drop seems to do nothing, try that
  instead before assuming something's actually broken.
- The installer can succeed with very little visible feedback - it's easy
  to assume it failed or is still hanging when it actually already
  finished. Confirm one way or the other by checking Illustrator directly
  (**Window → Extensions → Rematch**) rather than trusting the
  installer's own UI.
- If it reports "not compatible with any of your applications" and hangs,
  see the manual-install fallback (extract the `.zxp` as a `.zip` into
  the CEP extensions folder) - this is a known false positive in that
  installer, not usually a real manifest/compatibility problem.
