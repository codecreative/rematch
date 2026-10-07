# SCALEREF scale-reference script

A QGIS Processing script that generates the `SCALEREF` reference points the
[Rematch](../README.md) Illustrator extension uses to work out exact scale
percentages when matching newly-exported artwork against layers that have
already been resized to fit a composition.

## What it does

- Creates two points ("SCALEREF_A"/"SCALEREF_B"), inset from opposite
  corners of a given extent (defaults to the current map canvas extent).
- Styles them as pink crosshairs, easy to spot against real map data.
- Saves the result as `SCALEREF.geojson` next to the current project, plus
  a matching `SCALEREF.qml` style sidecar - both plain text, both small
  enough to commit to git alongside the rest of a project's assets.
- The all-caps filename matters: it's what makes QGIS name the layer
  `SCALEREF` (case-sensitive) whenever the file is dragged into a project,
  and what makes the pink styling apply automatically without any manual
  restyling.

Run it once per project, keep the resulting layer switched on in every
SVG/AI export from that project (alongside whatever real data layers -
rivers, roads, etc. - you're exporting), and never delete it.

## Install in QGIS

QGIS loads Processing scripts from a folder inside your user profile. On
macOS, for the default profile, that's:

```
~/Library/Application Support/QGIS/QGIS3/profiles/default/processing/scripts/
```

(If you use a different QGIS profile, swap `default` for its name - check
**Settings → User Profiles** in QGIS to see which one is active.)

### Option A - one-time import via the UI

1. Open the **Processing Toolbox** (Processing menu → Toolbox).
2. Click the Python icon dropdown at the top of the toolbox → **Add Script
   to Toolbox...**
3. Select `create_scale_reference.py` from this folder.

The script now shows up under **Rematch Tools** every time QGIS starts.

### Option B - symlink for active development

If you expect to tweak the script, symlink it into the scripts folder
instead of importing a copy, so edits here take effect without
re-importing each time (same idea as the extension's dev symlink in
[../SETUP.md](../SETUP.md)):

```bash
mkdir -p ~/Library/"Application Support"/QGIS/QGIS3/profiles/default/processing/scripts

ln -s "$(pwd)/create_scale_reference.py" \
  ~/Library/"Application Support"/QGIS/QGIS3/profiles/default/processing/scripts/create_scale_reference.py
```

Either way, after editing the script you'll need to reopen the Processing
Toolbox (or restart QGIS) for changes to be picked up.

## Using it

1. Open the project you want to add a scale reference to.
2. In the Processing Toolbox, find **Rematch Tools → Create scale
   reference points (SCALEREF)** (or search "scale reference").
3. Click the Extent field's "..." button and choose "Use Map Canvas
   Extent" (it's left blank otherwise - running without setting it will
   just error). Leave the other defaults - project CRS, 10% corner inset
   - and run it.
4. `SCALEREF.geojson` and `SCALEREF.qml` are written next to the project
   and the styled `SCALEREF` layer is added on top. Save the project.

To reuse the same file in a different project, copy both `SCALEREF.geojson`
and `SCALEREF.qml` into the new project's folder together and drag the
`.geojson` in - name and styling both come along automatically.
