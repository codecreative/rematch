# Rematch

A CEP panel extension for Adobe Illustrator that re-imports a freshly-exported
QGIS SVG, matches it against already-scaled/positioned layers in an existing
Illustrator file, and drops the new artwork in correctly scaled and placed.

NOTE: This is beta and probably some kinks to work out

## Why?
When an SVG is exported from QGIS it loses its GIS information which makes adding to an existing document a hurdle when things have been scaled and moved around. This free extension helps ease the pain and might help others too.

## Scenario
You have exported an SVG from QGIS (✓ Export map layers as SVG groups). In Illustrator you have styled, scaled, copied and moved where you now have a Desktop and a Mobile artboard. Now you need an extra layer from QGIS and have to rematch everything.

## Concept
The idea is that we have a known entity as a sublayer in the working document and the same layer in the new exports. We call this the comparison layer. This works well when using the same Layout in QGIS for exports. There might be a "countries" or "states" layer that remains static across exports. 

## Installing the extension

1. Download the latest `.zxp` from the [Releases page](../../releases).
2. Install it with a free installer such as [ZXP/UXP Installer](https://aescripts.com/learn/zxp-installer/)
3. Open or relaunch Illustrator to load the extension
4. In Illustrator, open the extension with `Window` > `Extensions`.

## Illustrator setup
The key requirement (currently) is that the working document has a "parent" layer for each target. For example, using a Desktop and Mobile artboard example, there could be a layer "Desktop" and a layer "Mobile".

Each of those parent layers then holds its own copy of whatever sublayers came out of the QGIS export - `countries`, `states`, `roads`, etc. - scaled and positioned independently per breakpoint.

One of those sublayers - present under the same name in both `Desktop` and `Mobile` - is the comparison layer.

```
WorkingFile.ai
├── Desktop (layer)
│   ├── roads
│   ├── states
│   └── countries   <- comparison layer
└── Mobile (layer)
    ├── roads
    ├── states
    └── countries   <- comparison layer
```

Note: This also works if the map export layers are nested like Desktop -> BaseMap -> countries/states/roads. In this case you would need to select the nested "BaseMap" for each target instead of just Desktop/Mobile in steps later.

The newly-exported SVG is flat - just the same `roads`/`states`/`countries` layers (no `Desktop`/
`Mobile` split), plus whatever new or modified layers you need:

```
NewExport.ai
├── someDataLayer (new layer to be added)
├── roads (we've added more roads than first export)
├── states
└── countries   <- comparison layer
```

Using the Rematch extension with the WorkingFile open you would select the target layers (ie Desktop and Mobile), select the NewExport file as a source file, choose "countries" as a comparison layer and then select the layers to move. In the above example we want to bring over roads (as a replacement) and someDataLayer as a new layer.

Clicking "run" will then copy over the chosen layers from the new export into each target layer in the working file.

```
WorkingFile.ai
├── Desktop (layer)
│   ├── someDataLayer (new layer)
│   ├── roads (the new export with more roads)
│   ├── roads
│   ├── states
│   └── countries   <- comparison layer
└── Mobile (layer)
    ├── someDataLayer (new layer)
    ├── roads (the new export with more roads)
    ├── roads
    ├── states
    └── countries   <- comparison layer
```

The extension is meant to be non-destructive, so in this example we are replacing the roads layer. Rather than replace, it gets added above so you can verify alignment, etc and then manually remove the old layers.


## Usage

1. **List active document & layers** - with the target Illustrator file open, click
   "List active document & layers." Check which top-level layers (or sublayers,
   expanding as needed) you want to use as move targets.
2. **Open source file** - choose the newly-exported QGIS SVG to pull new layers from.
3. **Pick a comparison layer** - pick the one layer used purely to compute the
   scale/position transform. It needs to already exist, under the same name, in every
   target you checked above, and shouldn't have changed between exports
4. **Check move layers** - check one or more layers to actually copy into the target(s).
5. **Run** - optionally enable "Copy styles" to carry over existing fill/stroke from a
   same-named layer already in the target, then click Run. Results for every
   move-layer/target combination are logged in the console below.


## What happens if the exports aren't from the same layout?
It's a little harder to compare when exports are coming from mismatched sizes. The Rematch solution is to run a script inside QGIS that creates a layer called "SCALEREF" which puts two points on the map. These get exported with the files and then that can be used as the comparison layer. It's important that the layer remains named "SCALEREF" to run calculations. (For more details see [qgis-scaleref-script/](qgis-scaleref-script/README.md))

The downside is that the SCALEREF layer needs to be in the file from the start. (Or added via the normal method from a same layout export.)

## Status

Work in progress

## License

[MIT](LICENSE)

