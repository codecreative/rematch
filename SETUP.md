# Rematch — dev setup

This documents the one-time machine setup and the everyday edit/test loop for the Rematch CEP panel (see [plan.md](plan.md)). Written for macOS.

Clone or rename the repo folder to `rematch`, then run commands below from that directory. The extension lives at `extension/` (`CSXS/manifest.xml`, `CSInterface.js`, `index.html`, `index.js`, `host/main.jsx`).

## One-time setup

### 1. Enable unsigned extensions (`PlayerDebugMode`)

Illustrator only loads signed extensions by default. For local development, unsigned extensions need to be explicitly allowed, per CEP version. It's harmless to enable several versions at once so you don't have to figure out exactly which one your Illustrator install uses:

```bash
for v in 9 10 11 12; do
  defaults write com.adobe.CSXS.$v PlayerDebugMode 1
done
```

Quit and restart Illustrator after running this (only needed once, unless Illustrator is updated to a new major CEP version later).

### 2. Pick an extension ID and symlink the folder in

CEP discovers extensions by scanning a folder and reading each subfolder's `CSXS/manifest.xml`. The **subfolder name must match the `ExtensionBundleId`** in that manifest.

Example, using `com.codecreative.rematch` as the ID (adjust to taste, then keep it consistent everywhere below):

```bash
mkdir -p ~/Library/"Application Support"/Adobe/CEP/extensions

ln -s "$(pwd)/extension" \
  ~/Library/"Application Support"/Adobe/CEP/extensions/com.codecreative.rematch
```

Using a symlink (rather than copying the folder) means edits made in this repo take effect immediately - there's no "install" step to repeat.

### 3. First launch

Restart Illustrator (needed once, so it rescans the extensions folder). Open **Window → Extensions** and the panel should be listed by whatever `PanelDisplayName` is set in the manifest.

If it's not there, see Troubleshooting below before doing anything else.

## Everyday edit/test loop

**Illustrator's CEP panels are always "persistent"** - unlike Photoshop (which has a Persistent Mode setting you can turn off), Illustrator has no equivalent. Closing and reopening the panel from Window → Extensions does **not** reload anything - the webview just keeps running in the background with whatever it already loaded. This trips up basically everyone who builds a CEP panel for Illustrator; see [Adobe-CEP/CEP-Resources#39](https://github.com/Adobe-CEP/CEP-Resources/issues/39).

The fix, already wired up in `index.js`:

- A right-click **context menu inside the panel** with a **"Reload Panel"** item that calls `location.reload()`. This does a real page reload of the panel's webview, picking up changes to `index.html`/`index.js`/`index.css`.
- On every such reload (panel init), the panel also explicitly re-runs `$.evalFile()` against `host/main.jsx` (via `csInterface.getSystemPath(SystemPath.EXTENSION)` to build the absolute path). Without this, the manifest's `<ScriptPath>` would only load that file once per Illustrator session, so jsx edits would need a full restart even though the HTML/JS reloaded fine.

| Change made to... | What to do | Restart Illustrator? |
| --- | --- | --- |
| `index.html` / `index.js` / `index.css` (panel UI) | Right-click inside the panel → **Reload Panel** | No |
| `host/main.jsx` (ExtendScript) | Right-click inside the panel → **Reload Panel** (re-triggers the `$.evalFile(...)` call) | No |
| `CSXS/manifest.xml` (panel id/name/size, supported host version range) | Restart Illustrator | Yes |

No build step, no packaging, at any point in this loop - just save the file and right-click → Reload Panel.

If jsx edits ever stop showing up even after a Reload Panel, check that the `$.evalFile()` call and the context-menu wiring are both still present in `index.js` - that's the one thing standing between this extension and needing a full restart per edit.

## Debugging

### Panel JS - Chrome DevTools

Create a `.debug` file (literally named `.debug`, no extension) at the extension's root, next to `CSXS/`:

```bash
cat > extension/.debug << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<ExtensionList>
  <Extension Id="com.codecreative.rematch.panel">
    <HostList>
      <Host Name="ILST" Port="8088"/>
    </HostList>
  </Extension>
</ExtensionList>
EOF
```

The `Id` here must exactly match the `<Extension Id="...">` inside `CSXS/manifest.xml` (this is the individual extension/panel ID, which may differ from the bundle ID used as the folder name above).

With the panel open in Illustrator, visit `http://localhost:8088/` in Chrome to get full DevTools - console, breakpoints, network tab - against the running panel.

### ExtendScript - VS Code

Chrome DevTools doesn't reach into `host/main.jsx`. For breakpoints/stepping there, install the "ExtendScript Debugger" extension in VS Code and attach it to Illustrator. Failing that, `$.writeln("...")` inside the jsx writes to the ExtendScript console, and returning debug info back to the panel's results log works fine too.

## Troubleshooting

- **Panel doesn't show up under Window → Extensions at all**
  - Confirm the symlink target folder name exactly matches `ExtensionBundleId` in `manifest.xml`.
  - Confirm `PlayerDebugMode` is set for the CSXS version Illustrator is actually using (check `~/Library/Preferences/com.adobe.CSXS.*.plist`).
  - Fully quit and reopen Illustrator (not just close/reopen a document).
  - Check `~/Library/Logs/CSXS/` for a `CEP<version>-ILST.log` with load errors.

- **Panel shows up but is blank / nothing happens on click**
  - Open the panel, then check `http://localhost:8088/` (or your chosen port) in Chrome - if it doesn't connect, the `.debug` file's `Id` probably doesn't match the manifest, or Illustrator needs restarting after adding `.debug`.
  - If Chrome connects but shows a blank page, open its console for the actual JS error.

- **Button click does nothing / `evalScript` callback never fires**
  - Check the ExtendScript function name/arguments match exactly what's being passed to `evalScript(...)` from the panel - typos here fail silently rather than throwing.
  - Confirm `host/main.jsx` was actually loaded (add a one-line "loaded" `$.writeln()` at the top of the file, reopen the panel, and check for it via the VS Code debugger or a log).

## Packaging for colleagues to test

Signed `.zxp` packaging (via `ZXPSignCmd`) is only relevant once this needs to run on another machine. For personal day-to-day use, running it unpacked via the symlink above is sufficient indefinitely.

See [packaging/README.md](packaging/README.md) - `packaging/package-zxp.sh` builds a signed `.zxp` from the current `extension/` folder in one command.
