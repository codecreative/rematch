// ExtendScript host code for the Rematch extension.
//
// Auto-loaded by CEP when the panel opens (see the ScriptPath entry in
// CSXS/manifest.xml) - no explicit $.evalFile() call needed from the panel.
// Must stay ES3-compatible (no let/const, arrow functions, template
// literals, destructuring, etc.) since ExtendScript's JS engine is ES3.
//
// Functions are prefixed with rm_ to avoid colliding with anything else
// that might be loaded into the same ExtendScript engine.

// ExtendScript has no native JSON object - this is Crockford's json2.js
// (public domain), which only defines JSON if it isn't already present.
#include "lib/json2.js"

// Holds the temp source document opened by rm_openSourceFile(), so
// rm_closeSourceFile() can find it again later. Stored on $.global rather
// than a plain top-level var, since top-level vars get reset to their
// initializer every time this file is re-sourced (index.js does that on
// every panel reload - see SETUP.md) - $.global survives that.
if ($.global.rmSourceDoc === undefined) {
  $.global.rmSourceDoc = null;
}

// Confirms the panel <-> ExtendScript bridge works.
function rm_getActiveDocumentName() {
  if (app.documents.length === 0) {
    return "No document open.";
  }
  return app.activeDocument.name;
}

// Recursively walks a container's `layers` collection, AND its
// `pageItems` looking for named GroupItems. Illustrator doesn't recreate sublayers from an
// SVG's <g> structure - it dumps everything into one default "Layer 1"
// full of nested *groups* instead. Without walking pageItems too, every
// plain SVG would show as a single flat "Layer 1" node with no children,
// which is useless as a comparison/move-layer picker. Un-named/anonymous
// groups are flattened through (their contents pulled up a level) rather
// than shown as an unpickable node.
//
// Works on a Document, a Layer, or a GroupItem - Document/Layer have
// `.layers`, Layer/GroupItem have `.pageItems`; each branch is skipped if
// the container doesn't have that property (e.g. GroupItem has no
// `.layers`). Document.pageItems is deliberately never read here - it
// isn't layer-scoped the same way, and the original script never relied
// on it either.
function rm_buildLayerTree(container, parentPath) {
  var result = [];

  if (container.layers) {
    for (var i = 0; i < container.layers.length; i++) {
      var layer = container.layers[i];
      var layerPath = parentPath ? parentPath + "/" + layer.name : layer.name;
      result.push({
        name: layer.name,
        path: layerPath,
        type: "Layer",
        children: rm_buildLayerTree(layer, layerPath)
      });
    }
  }

  if ((container.typename === "Layer" || container.typename === "GroupItem") && container.pageItems) {
    for (var j = 0; j < container.pageItems.length; j++) {
      var item = container.pageItems[j];
      if (item.typename !== "GroupItem") {
        continue;
      }
      if (item.name) {
        var groupPath = parentPath ? parentPath + "/" + item.name : item.name;
        result.push({
          name: item.name,
          path: groupPath,
          type: "GroupItem",
          children: rm_buildLayerTree(item, groupPath)
        });
      } else {
        var flattened = rm_buildLayerTree(item, parentPath);
        for (var k = 0; k < flattened.length; k++) {
          result.push(flattened[k]);
        }
      }
    }
  }

  return result;
}

// Returns a JSON string: { layers: [...] } on success, or { error: "..." }.
// Always returns a string (never throws) so the panel-side JSON.parse has
// something sane to work with either way.
function rm_listActiveDocumentLayers() {
  try {
    if (app.documents.length === 0) {
      return JSON.stringify({ error: "No document open." });
    }
    var doc = app.activeDocument;
    return JSON.stringify({ layers: rm_buildLayerTree(doc, "") });
  } catch (e) {
    return JSON.stringify({ error: "rm_listActiveDocumentLayers failed: " + e.toString() });
  }
}

// Prompts for an SVG file and hands back its path - deliberately does not
// open it yet, so any issues here are isolated to the dialog itself
// rather than mixed in with app.open().
// Returns one of: { path: "..." }, { cancelled: true }, { error: "..." }.
function rm_chooseSourceFile() {
  try {
    var file = File.openDialog("Choose a QGIS-exported SVG file", function (f) {
      return f instanceof Folder || /\.svg$/i.test(f.name);
    });
    if (!file) {
      return JSON.stringify({ cancelled: true });
    }
    return JSON.stringify({ path: file.fsName });
  } catch (e) {
    return JSON.stringify({ error: "rm_chooseSourceFile failed: " + e.toString() });
  }
}

// Opens the chosen SVG into a background document and returns its full
// nested layer tree (reusing rm_buildLayerTree). Suppresses any import dialogs Illustrator might
// otherwise show (color profile mismatches etc.) for the duration of the
// open.
//
// If the requested path is already open as the tracked source doc (common
// during dev/testing: $.global.rmSourceDoc survives panel reloads, so
// re-picking the same file doesn't need a fresh app.open()), just reuses
// it as-is rather than closing and reopening it. Otherwise, any previously
// -opened source doc is closed first, so repeatedly picking a *different*
// file during dev doesn't pile up temp documents.
function rm_openSourceFile(path) {
  try {
    var existing = $.global.rmSourceDoc;
    if (existing) {
      try {
        if (existing.fullName.fsName === new File(path).fsName) {
          return JSON.stringify({ layers: rm_buildLayerTree(rm_sourceTreeRoot(existing), "") });
        }
      } catch (eStale) {
        // existing doc reference is no longer valid (e.g. closed outside
        // our control) - fall through to opening fresh below.
        $.global.rmSourceDoc = null;
      }
    }

    rm_closeSourceFile();

    var file = new File(path);
    if (!file.exists) {
      return JSON.stringify({ error: "File not found: " + path });
    }

    // Capture whatever was frontmost *before* opening, so it can be
    // restored afterward - app.open() always makes the newly-opened
    // document active/frontmost, which would otherwise yank focus away
    // from whatever the user was actually working on.
    var previousActiveDoc = app.documents.length > 0 ? app.activeDocument : null;

    var previousInteractionLevel = app.userInteractionLevel;
    app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
    var doc;
    try {
      doc = app.open(file);
    } finally {
      app.userInteractionLevel = previousInteractionLevel;
    }

    $.global.rmSourceDoc = doc;
    var tree = rm_buildLayerTree(rm_sourceTreeRoot(doc), "");

    if (previousActiveDoc) {
      app.activeDocument = previousActiveDoc;
    }

    return JSON.stringify({ layers: tree });
  } catch (e) {
    return JSON.stringify({ error: "rm_openSourceFile failed: " + e.toString() });
  }
}

// Closes the temp source doc opened by rm_openSourceFile(), without
// saving. Safe to call even if nothing is open (e.g. already closed by
// the user, or never opened) - just a no-op in that case.
function rm_closeSourceFile() {
  try {
    var doc = $.global.rmSourceDoc;
    if (doc) {
      try {
        doc.close(SaveOptions.DONOTSAVECHANGES);
      } catch (eClose) {
        // Already closed - nothing to do.
      }
    }
    $.global.rmSourceDoc = null;
    return JSON.stringify({ closed: true });
  } catch (e) {
    return JSON.stringify({ error: "rm_closeSourceFile failed: " + e.toString() });
  }
}

// Geometry helpers for computing scale/anchor transforms (SCALEREF
// two-point method, falling back to bounding-box scaling). rm_ prefixed
// to avoid colliding with anything else that might be loaded into the
// same ExtendScript engine.
var RM_SCALEREF_LAYER_NAME = "SCALEREF";

function rm_getCenter(item) {
  var b = item.geometricBounds; // [left, top, right, bottom]
  return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
}

function rm_dist(p1, p2) {
  var dx = p2[0] - p1[0];
  var dy = p2[1] - p1[1];
  return Math.sqrt(dx * dx + dy * dy);
}

// Recurse into GroupItems to collect leaf geometry.
function rm_flattenMarks(items, out) {
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    if (item.typename === "GroupItem") {
      rm_flattenMarks(item.pageItems, out);
    } else {
      out.push(item);
    }
  }
  return out;
}

function rm_widestPair(marks) {
  if (marks.length < 2) {
    return null;
  }
  var maxDist = -1, best = null;
  for (var i = 0; i < marks.length; i++) {
    for (var j = i + 1; j < marks.length; j++) {
      var d = rm_dist(rm_getCenter(marks[i]), rm_getCenter(marks[j]));
      if (d > maxDist) {
        maxDist = d;
        best = [marks[i], marks[j]];
      }
    }
  }
  return best;
}

// Recursively search a container (Layer or GroupItem) for a sublayer/group
// named `name`, at any depth - used to find the matching-named container
// inside a target layer, given only the comparison layer's name.
function rm_findNamedContainerRecursive(container, name) {
  if (container.layers) {
    for (var i = 0; i < container.layers.length; i++) {
      var sub = container.layers[i];
      if (sub.name === name) {
        return sub;
      }
      var found = rm_findNamedContainerRecursive(sub, name);
      if (found) {
        return found;
      }
    }
  }
  if (container.pageItems) {
    for (var j = 0; j < container.pageItems.length; j++) {
      var item = container.pageItems[j];
      if (item.typename === "GroupItem") {
        if (item.name === name) {
          return item;
        }
        var foundInGroup = rm_findNamedContainerRecursive(item, name);
        if (foundInGroup) {
          return foundInGroup;
        }
      }
    }
  }
  return null;
}

// Finds a direct child of `container` named `targetName`, flattening
// through any *unnamed* intermediate groups - mirrors exactly how
// rm_buildLayerTree() flattens them when building the tree the panel
// shows, so a `path` produced by that function can always be resolved
// back to a live object by walking one segment at a time with this.
function rm_findChildByName(container, targetName) {
  if (container.layers) {
    for (var i = 0; i < container.layers.length; i++) {
      if (container.layers[i].name === targetName) {
        return container.layers[i];
      }
    }
  }
  if ((container.typename === "Layer" || container.typename === "GroupItem") && container.pageItems) {
    for (var j = 0; j < container.pageItems.length; j++) {
      var item = container.pageItems[j];
      if (item.typename !== "GroupItem") {
        continue;
      }
      if (item.name === targetName) {
        return item;
      }
      if (!item.name) {
        var found = rm_findChildByName(item, targetName);
        if (found) {
          return found;
        }
      }
    }
  }
  return null;
}

// Resolves a "/"-separated path (as produced by rm_buildLayerTree) back
// to a live Layer/GroupItem, starting from `root` (a Document or Layer).
function rm_findContainerByPath(root, path) {
  var segments = path.split("/");
  var container = root;
  for (var i = 0; i < segments.length; i++) {
    container = rm_findChildByName(container, segments[i]);
    if (!container) {
      return null;
    }
  }
  return container;
}

// Illustrator's SVG import always wraps the whole file in exactly one
// top-level Layer (typically named "Layer 1") that carries no real
// information of its own - there's nothing else at that level for it to
// be grouping alongside, unlike a genuine multi-layer working file. Both
// building the source tree shown in the panel and resolving a path back
// to a live object treat that single wrapper layer as transparent, so
// paths start directly at the actual QGIS map layers/groups underneath
// it. Falls back to the document itself untouched if it doesn't have
// exactly one top-level layer, so anything unexpected just shows as-is
// rather than risking hiding real structure.
function rm_sourceTreeRoot(doc) {
  if (doc.layers && doc.layers.length === 1) {
    return doc.layers[0];
  }
  return doc;
}

// Resolves a path produced against rm_sourceTreeRoot(doc) back to a live
// object in that same source document - every rm_findContainerByPath()
// call against the source doc goes through this instead, so the "root"
// used for resolving always matches the one used for building the tree.
function rm_resolveSourcePath(doc, path) {
  return rm_findContainerByPath(rm_sourceTreeRoot(doc), path);
}

// Union bounding box of a Layer's or Group's contents.
function rm_unionBounds(container) {
  if (container.typename === "GroupItem") {
    return container.geometricBounds;
  }
  var items = container.pageItems;
  if (!items || items.length === 0) {
    return null;
  }
  var b = items[0].geometricBounds.slice();
  for (var i = 1; i < items.length; i++) {
    var ib = items[i].geometricBounds;
    if (ib[0] < b[0]) b[0] = ib[0];
    if (ib[1] > b[1]) b[1] = ib[1];
    if (ib[2] > b[2]) b[2] = ib[2];
    if (ib[3] < b[3]) b[3] = ib[3];
  }
  return b;
}

// Figures out the scale + one anchor-point correspondence from two
// reference points (tries both point pairings and keeps whichever fits the
// second point better, since there's no reliable way to know which point
// is "A" vs "B"). anchorItem is a live object - re-measured after scaling
// in a later step, so it's deliberately left out of the JSON sent to the
// panel by rm_computeTransform().
function rm_computePointsTransform(sourceContainer, targetContainer) {
  var sourceMarks = rm_flattenMarks(sourceContainer.pageItems, []);
  var targetMarks = rm_flattenMarks(targetContainer.pageItems, []);
  if (sourceMarks.length < 2 || targetMarks.length < 2) {
    return null;
  }

  var sPair = rm_widestPair(sourceMarks);
  var tPair = rm_widestPair(targetMarks);
  if (!sPair || !tPair) {
    return null;
  }

  var s0 = rm_getCenter(sPair[0]), s1 = rm_getCenter(sPair[1]);
  var t0 = rm_getCenter(tPair[0]), t1 = rm_getCenter(tPair[1]);

  var sourceDist = rm_dist(s0, s1);
  var targetDist = rm_dist(t0, t1);
  if (sourceDist === 0) {
    return null;
  }
  var scale = targetDist / sourceDist;

  function residual(anchorSource, anchorTarget, otherSource, otherTarget) {
    var dx = anchorTarget[0] - anchorSource[0] * scale;
    var dy = anchorTarget[1] - anchorSource[1] * scale;
    var predicted = [otherSource[0] * scale + dx, otherSource[1] * scale + dy];
    return rm_dist(predicted, otherTarget);
  }

  var errDirect = residual(s0, t0, s1, t1);
  var errSwapped = residual(s0, t1, s1, t0);

  return {
    scale: scale,
    scaleX: scale,
    scaleY: scale,
    anchorItem: sPair[0],
    anchorTargetPoint: errDirect <= errSwapped ? t0 : t1,
    method: "SCALEREF points"
  };
}

// Scale from a shared reference container's bounding box, anchored on its
// top-left corner.
function rm_computeBoundsTransform(sourceContainer, targetContainer, name) {
  var sb = rm_unionBounds(sourceContainer);
  var tb = rm_unionBounds(targetContainer);
  if (!sb || !tb) {
    return null;
  }

  var sw = sb[2] - sb[0];
  var sh = sb[1] - sb[3];
  var tw = tb[2] - tb[0];
  var th = tb[1] - tb[3];
  if (sw === 0 || sh === 0) {
    return null;
  }

  var scaleX = tw / sw;
  var scaleY = th / sh;
  var scale = (scaleX + scaleY) / 2;

  return {
    scale: scale,
    scaleX: scaleX,
    scaleY: scaleY,
    anchorContainer: sourceContainer,
    anchorTargetPoint: [tb[0], tb[1]],
    method: "shared layer \"" + name + "\" (bounding box)"
  };
}

// Given the comparison layer's path (in the open source temp doc) and the
// path of a target sublayer (in the active document, at any depth - e.g.
// "Desktop/Base Map"), computes the scale/anchor transform driven
// entirely by the panel's explicit selections. Returns just the
// plain-data parts of the transform (never the live anchorItem/
// anchorContainer object refs, which JSON.stringify can't usefully
// serialize anyway) - no artwork is touched.
function rm_computeTransform(comparisonPath, targetPath) {
  try {
    if (!$.global.rmSourceDoc) {
      return JSON.stringify({ error: "No source file open - open the source file first." });
    }
    if (app.documents.length === 0) {
      return JSON.stringify({ error: "No active document." });
    }

    var sourceContainer = rm_resolveSourcePath($.global.rmSourceDoc, comparisonPath);
    if (!sourceContainer) {
      return JSON.stringify({ error: "Could not resolve \"" + comparisonPath + "\" in the source file." });
    }

    // rm_findContainerByPath walks the path segment by segment starting
    // from the document itself - unlike the source side, there's no
    // single-wrapper-layer stripping needed here, since a real working
    // file's top-level layers are already meaningful. A target must
    // resolve to a real Layer (any paste destination has to be one -
    // Document.activeLayer can't be a GroupItem), so a path landing on a
    // named group is rejected rather than silently treated as a layer.
    var targetLayer = rm_findContainerByPath(app.activeDocument, targetPath);
    if (!targetLayer) {
      return JSON.stringify({ error: "No layer found at \"" + targetPath + "\" in the active document." });
    }
    if (targetLayer.typename !== "Layer") {
      return JSON.stringify({ error: "\"" + targetPath + "\" is a group, not a layer - only sublayers can be used as a target." });
    }

    var compareName = sourceContainer.name;
    var targetContainer = rm_findNamedContainerRecursive(targetLayer, compareName);
    if (!targetContainer) {
      return JSON.stringify({
        error: "No sublayer/group named \"" + compareName + "\" found anywhere in \"" + targetPath + "\"."
      });
    }

    var transform = null;
    if (compareName === RM_SCALEREF_LAYER_NAME) {
      transform = rm_computePointsTransform(sourceContainer, targetContainer);
    }
    if (!transform) {
      transform = rm_computeBoundsTransform(sourceContainer, targetContainer, compareName);
    }

    if (!transform) {
      return JSON.stringify({
        error: "Found \"" + compareName + "\" in both, but couldn't compute a transform from it " +
          "(empty or degenerate bounds)."
      });
    }

    var scaleDiffPct = transform.scale !== 0
      ? Math.abs(transform.scaleX - transform.scaleY) / transform.scale * 100
      : 0;

    return JSON.stringify({
      method: transform.method,
      scale: transform.scale,
      scaleX: transform.scaleX,
      scaleY: transform.scaleY,
      scaleDiffPct: scaleDiffPct,
      anchorTargetPoint: transform.anchorTargetPoint
    });
  } catch (e) {
    return JSON.stringify({ error: "rm_computeTransform failed: " + e.toString() });
  }
}

// Copies one move-layer's contents from the source temp doc into one
// target layer in the active document, unscaled, placed on top - no
// transform applied yet.
//
// There's no DOM method to move an object between documents directly -
// this has to go through the actual system clipboard (app.copy()/
// app.paste()), which only ever operates on the active document's current
// selection and active layer. That means temporarily flipping
// app.activeDocument back and forth, which is restored to whatever it was
// before this function ran once done.
function rm_copyLayerToTarget(sourcePath, targetPath) {
  try {
    if (!$.global.rmSourceDoc) {
      return JSON.stringify({ error: "No source file open - open the source file first." });
    }
    if (app.documents.length === 0) {
      return JSON.stringify({ error: "No active document." });
    }

    var sourceDoc = $.global.rmSourceDoc;
    var sourceContainer = rm_resolveSourcePath(sourceDoc, sourcePath);
    if (!sourceContainer) {
      return JSON.stringify({ error: "Could not resolve \"" + sourcePath + "\" in the source file." });
    }

    var previousActiveDoc = app.activeDocument;
    var targetDoc = previousActiveDoc;

    var targetLayer = rm_findContainerByPath(targetDoc, targetPath);
    if (!targetLayer) {
      return JSON.stringify({ error: "No layer found at \"" + targetPath + "\" in the active document." });
    }
    if (targetLayer.typename !== "Layer") {
      return JSON.stringify({ error: "\"" + targetPath + "\" is a group, not a layer - only sublayers can be used as a target." });
    }

    // Select the whole move-layer's contents as one unit, on the source
    // doc, then copy it to the system clipboard. A Layer has no
    // "selected" property of its own - hasSelectedArtwork selects
    // everything inside it (including any nested sublayers) instead. A
    // GroupItem is a single page item, so it's selected directly.
    app.activeDocument = sourceDoc;
    sourceDoc.selection = null;
    if (sourceContainer.typename === "Layer") {
      sourceContainer.hasSelectedArtwork = true;
    } else {
      sourceContainer.selected = true;
    }
    app.copy();

    // Paste always lands in the active document's active layer, at the
    // front (topmost) of that layer's existing contents - exactly the
    // "always inserted as the topmost sublayer" placement the plan calls
    // for, with no extra reordering needed. *Except* when Illustrator's
    // "Paste Remembers Layers" is on (a user-facing preference, exposed to
    // scripts as app.pasteRemembersLayers) - then paste ignores the active
    // layer entirely and recreates the source document's layer by name in
    // the target instead, which is exactly the "new Layer 1 sibling" bug
    // this was hit by. Force it off for this one paste, then restore
    // whatever it was.
    app.activeDocument = targetDoc;
    var previousActiveLayer = targetDoc.activeLayer;
    var previousPasteRemembersLayers = app.pasteRemembersLayers;
    targetDoc.activeLayer = targetLayer;
    app.pasteRemembersLayers = false;
    app.paste();

    var pasted = targetDoc.selection;
    var pastedCount = pasted.length;
    var pastedName = pastedCount > 0 ? pasted[0].name : null;

    app.pasteRemembersLayers = previousPasteRemembersLayers;
    targetDoc.activeLayer = previousActiveLayer;
    app.activeDocument = previousActiveDoc;

    return JSON.stringify({ pasted: true, pastedCount: pastedCount, pastedName: pastedName });
  } catch (e) {
    return JSON.stringify({ error: "rm_copyLayerToTarget failed: " + e.toString() });
  }
}

// Copies move-layer(s) into target(s), scaling/positioning each pasted
// result using the same transform math as rm_computeTransform.
//
// The comparison layer and the move-layer(s) can be entirely different
// layers, so the comparison container never gets pasted/scaled itself - there's nothing to
// re-measure in the target document once the paste happens.
//
// The fix is to never compare raw coordinates *across* the two documents
// directly - there's no guarantee the temp doc's ruler/artboard lines up
// with the target doc's, and app.paste() isn't even guaranteed to preserve
// exact coordinates in the first place (regular Paste can land relative to
// the current view). Instead: measure the comparison anchor's position
// *relative to the move-layer's own position* while both are still in the
// temp doc (a same-document delta, so cross-document offsets can't corrupt
// it), then re-apply that same relative delta to wherever the move-layer's
// pasted copy actually ends up landing in the target document (measured
// directly, after the paste, whatever that position turns out to be).
//
// The copy-styles option (non-destructive) samples a representative leaf
// item's appearance (fill/stroke/opacity) from whatever's frontmost within
// a container, flattening through nested groups first via
// rm_flattenMarks - the same "pick one representative mark" idea
// rm_widestPair's callers already rely on elsewhere, just for appearance
// instead of position.
function rm_sampleAppearance(container) {
  var marks = rm_flattenMarks(container.pageItems, []);
  if (marks.length === 0) {
    return null;
  }
  var item = marks[0];
  var appearance = { opacity: item.opacity };
  try {
    appearance.filled = item.filled;
    appearance.fillColor = item.fillColor;
  } catch (eFill) {
    // Some item types (e.g. text) don't expose fill the same way - leave
    // fill out of the sampled appearance rather than failing the sample.
  }
  try {
    appearance.stroked = item.stroked;
    appearance.strokeColor = item.strokeColor;
    appearance.strokeWidth = item.strokeWidth;
  } catch (eStroke) {
    // As above, for stroke.
  }
  return appearance;
}

// Applies a previously-sampled appearance to every leaf item within
// `container` (flattened the same way it was sampled). Uses try/catch per
// property/per item so one item type that doesn't support a given
// property (e.g. no stroke on some shape) doesn't stop the rest of the
// newly-placed geometry from being styled.
function rm_applyAppearance(container, appearance) {
  if (!appearance) {
    return;
  }
  var marks = rm_flattenMarks(container.pageItems, []);
  for (var i = 0; i < marks.length; i++) {
    var item = marks[i];
    try {
      item.opacity = appearance.opacity;
    } catch (eOpacity) {}
    if (appearance.hasOwnProperty("filled")) {
      try {
        item.filled = appearance.filled;
        if (appearance.filled) {
          item.fillColor = appearance.fillColor;
        }
      } catch (eFill) {}
    }
    if (appearance.hasOwnProperty("stroked")) {
      try {
        item.stroked = appearance.stroked;
        if (appearance.stroked) {
          item.strokeColor = appearance.strokeColor;
          item.strokeWidth = appearance.strokeWidth;
        }
      } catch (eStroke) {}
    }
  }
}

// Does the copy/paste/consolidate/scale/translate for exactly one
// move-layer into one already-resolved target, given a transform already
// computed against that target. Pulled out on its own so rm_runMove can
// loop it over every move-layer x target combination without duplicating
// this logic. Returns a plain result object (never a JSON string - only
// the outer rm_runMove call serializes) - throws on failure, since the
// caller is responsible for catching per-item errors so one bad
// combination doesn't abort the whole run.
//
// When copyStyles is on, the *existing* same-named container in the target
// (an old, already-styled "rivers" sublayer, say) is found and sampled
// *before* anything is pasted - deliberately, since the newly-pasted
// content can end up with that exact same name too (see the
// pastedItems.length === 1 GroupItem case below, which keeps the pasted
// group's original name unchanged) - sampling first guarantees this finds
// the old container, never the new one. The old container itself is never
// modified - only the newly-placed geometry's appearance is changed.
function rm_pasteAndPositionOne(sourceDoc, targetDoc, moveContainer, targetLayer, transform, anchorSourcePoint, copyStyles) {
  var sampledAppearance = null;
  var styledFromName = null;
  if (copyStyles) {
    var existingSameNamed = rm_findNamedContainerRecursive(targetLayer, moveContainer.name);
    if (existingSameNamed) {
      sampledAppearance = rm_sampleAppearance(existingSameNamed);
      styledFromName = existingSameNamed.name;
    }
  }

  var moveContainerBoundsInTempDoc = rm_unionBounds(moveContainer);
  var moveContainerTopLeftInTempDoc = moveContainerBoundsInTempDoc
    ? [moveContainerBoundsInTempDoc[0], moveContainerBoundsInTempDoc[1]]
    : anchorSourcePoint; // degenerate fallback (e.g. moveContainer has no direct pageItems)

  var deltaFromMoveToAnchor = [
    anchorSourcePoint[0] - moveContainerTopLeftInTempDoc[0],
    anchorSourcePoint[1] - moveContainerTopLeftInTempDoc[1]
  ];

  // Select and copy the move-layer's contents as one unit.
  app.activeDocument = sourceDoc;
  sourceDoc.selection = null;
  if (moveContainer.typename === "Layer") {
    moveContainer.hasSelectedArtwork = true;
  } else {
    moveContainer.selected = true;
  }
  app.copy();

  app.activeDocument = targetDoc;
  var previousActiveLayer = targetDoc.activeLayer;
  var previousPasteRemembersLayers = app.pasteRemembersLayers;
  targetDoc.activeLayer = targetLayer;
  app.pasteRemembersLayers = false;
  app.paste();

  var pastedItems = [];
  for (var i = 0; i < targetDoc.selection.length; i++) {
    pastedItems.push(targetDoc.selection[i]);
  }

  app.pasteRemembersLayers = previousPasteRemembersLayers;
  targetDoc.activeLayer = previousActiveLayer;

  if (pastedItems.length === 0) {
    throw new Error("Paste produced no items - nothing to scale/position.");
  }

  // Consolidate into one group (if not already exactly one), so
  // everything pasted scales/moves together as a single rigid unit.
  var combined;
  if (pastedItems.length === 1 && pastedItems[0].typename === "GroupItem") {
    combined = pastedItems[0];
  } else {
    combined = targetLayer.groupItems.add();
    combined.name = moveContainer.name + "_moved";
    for (var m = pastedItems.length - 1; m >= 0; m--) {
      pastedItems[m].moveToBeginning(combined);
    }
  }

  // groupTopLeft is measured live, in the *target* document, right after
  // the paste - wherever that actually landed (regular Paste's exact
  // position isn't something to rely on, so this doesn't try to).
  var groupBoundsBeforeScale = rm_unionBounds(combined);
  var groupTopLeft = [groupBoundsBeforeScale[0], groupBoundsBeforeScale[1]];

  // Anchored at TOPLEFT, so groupTopLeft's absolute position (as just
  // measured above, in the target document) is exactly preserved by this
  // call - it's the fixed point the shift below is computed relative to.
  combined.resize(
    transform.scale * 100, transform.scale * 100,
    true, true, true, true,
    transform.scale * 100,
    Transformation.TOPLEFT
  );

  // Re-apply the same-document delta (computed above, entirely within the
  // temp doc) to groupTopLeft's real, measured position in the target doc
  // - scaled, since the delta itself scales along with everything else in
  // the group.
  var newAnchorPos = [
    groupTopLeft[0] + deltaFromMoveToAnchor[0] * transform.scale,
    groupTopLeft[1] + deltaFromMoveToAnchor[1] * transform.scale
  ];

  var shiftX = transform.anchorTargetPoint[0] - newAnchorPos[0];
  var shiftY = transform.anchorTargetPoint[1] - newAnchorPos[1];
  combined.translate(shiftX, shiftY);

  if (sampledAppearance) {
    rm_applyAppearance(combined, sampledAppearance);
  }

  return { combinedName: combined.name, styledFrom: styledFromName };
}

// Runs the full move for every (move-layer x target) combination.
// A target with no matching comparison container (or any other per-target
// setup failure) skips *all* of its move-layers with one warning, rather
// than trying each and failing repeatedly. A failure isolated to one
// specific move-layer within an otherwise-good target only skips that one
// pairing. Either way, one bad combination never aborts the rest of the
// run - rm_runMove always returns a full per-combination report instead
// of a single error.
function rm_runMove(comparisonPath, sourcePaths, targetPaths, copyStyles) {
  try {
    if (!$.global.rmSourceDoc) {
      return JSON.stringify({ error: "No source file open - open the source file first." });
    }
    if (app.documents.length === 0) {
      return JSON.stringify({ error: "No active document." });
    }

    var sourceDoc = $.global.rmSourceDoc;

    var comparisonContainer = rm_resolveSourcePath(sourceDoc, comparisonPath);
    if (!comparisonContainer) {
      return JSON.stringify({ error: "Could not resolve comparison layer \"" + comparisonPath + "\" in the source file." });
    }

    var moveContainers = [];
    for (var s = 0; s < sourcePaths.length; s++) {
      var moveContainer = rm_resolveSourcePath(sourceDoc, sourcePaths[s]);
      if (!moveContainer) {
        return JSON.stringify({ error: "Could not resolve move-layer \"" + sourcePaths[s] + "\" in the source file." });
      }
      moveContainers.push({ path: sourcePaths[s], container: moveContainer });
    }

    var previousActiveDoc = app.activeDocument;
    var targetDoc = previousActiveDoc;
    var compareName = comparisonContainer.name;
    var results = [];

    for (var t = 0; t < targetPaths.length; t++) {
      var targetPath = targetPaths[t];

      // rm_findContainerByPath (shared with the source side) resolves a
      // "/"-separated path at any depth against the active document - a
      // target no longer has to be a top-level layer, e.g.
      // "Desktop/Base Map" resolves the same way "countries" resolves
      // against a source doc. Must land on a real Layer, never a named
      // group: a paste destination always goes through
      // Document.activeLayer, which can only ever be a Layer.
      var targetLayer = rm_findContainerByPath(targetDoc, targetPath);
      if (!targetLayer) {
        results.push({ target: targetPath, skipped: true, reason: "No layer found at \"" + targetPath + "\" in the active document." });
        continue;
      }
      if (targetLayer.typename !== "Layer") {
        results.push({ target: targetPath, skipped: true, reason: "\"" + targetPath + "\" is a group, not a layer - only sublayers can be used as a target." });
        continue;
      }

      var targetCompareContainer = rm_findNamedContainerRecursive(targetLayer, compareName);
      if (!targetCompareContainer) {
        results.push({
          target: targetPath,
          skipped: true,
          reason: "No sublayer/group named \"" + compareName + "\" found anywhere in \"" + targetPath + "\"."
        });
        continue;
      }

      var transform = null;
      if (compareName === RM_SCALEREF_LAYER_NAME) {
        transform = rm_computePointsTransform(comparisonContainer, targetCompareContainer);
      }
      if (!transform) {
        transform = rm_computeBoundsTransform(comparisonContainer, targetCompareContainer, compareName);
      }
      if (!transform) {
        results.push({
          target: targetPath,
          skipped: true,
          reason: "Found \"" + compareName + "\" in both, but couldn't compute a transform from it (empty or degenerate bounds)."
        });
        continue;
      }

      // Same for every move-layer going into this target - computed once
      // per target rather than once per (move-layer x target) pairing.
      var anchorSourcePoint;
      if (transform.anchorItem) {
        anchorSourcePoint = rm_getCenter(transform.anchorItem);
      } else {
        var acBounds = rm_unionBounds(transform.anchorContainer);
        anchorSourcePoint = [acBounds[0], acBounds[1]];
      }

      // moveContainers is in the source's real z-order (index 0 = topmost,
      // straight from rm_buildLayerTree/.layers/.pageItems order). Each
      // paste always lands as the topmost item in targetLayer though, so
      // pasting in that same order would bury the first (topmost) one under
      // everything pasted after it - a full reversal. Processing back-to-
      // front instead (bottommost source item first, topmost pasted last)
      // makes the final stacking order in the target match the source.
      // moveOutcomes is filled by original index so the *reported* results
      // stay in the more readable original order regardless.
      var moveOutcomes = new Array(moveContainers.length);
      for (var m2 = moveContainers.length - 1; m2 >= 0; m2--) {
        var entry = moveContainers[m2];
        try {
          var outcome = rm_pasteAndPositionOne(
            sourceDoc, targetDoc, entry.container, targetLayer, transform, anchorSourcePoint, copyStyles
          );
          moveOutcomes[m2] = {
            target: targetPath,
            moveLayer: entry.path,
            moved: true,
            method: transform.method,
            scalePct: transform.scale * 100,
            combinedName: outcome.combinedName,
            styledFrom: outcome.styledFrom
          };
        } catch (eItem) {
          moveOutcomes[m2] = {
            target: targetPath,
            moveLayer: entry.path,
            skipped: true,
            reason: eItem.toString()
          };
        }
      }
      for (var m3 = 0; m3 < moveOutcomes.length; m3++) {
        results.push(moveOutcomes[m3]);
      }
    }

    app.activeDocument = previousActiveDoc;

    return JSON.stringify({ results: results });
  } catch (e) {
    return JSON.stringify({ error: "rm_runMove failed: " + e.toString() });
  }
}
