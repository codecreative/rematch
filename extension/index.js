// Panel-side logic. Plain JS, no build step - loaded directly by index.html.
(function () {
  "use strict";

  var csInterface = new CSInterface();

  // Illustrator's CEP panels are always "persistent" (unlike Photoshop,
  // there's no setting to turn this off): closing and reopening the panel
  // from Window > Extensions does NOT reload the HTML/JS at all - the
  // webview just keeps running in the background. A real reload needs an
  // actual location.reload() inside the panel. Exposed two ways: a visible
  // button (primary, most discoverable) and a right-click context menu
  // item (backup, in case the button itself is what needs reloading after
  // an HTML edit). See SETUP.md for more on this.
  function reloadPanel() {
    location.reload();
  }

  document.getElementById("reloadPanelButton").addEventListener("click", reloadPanel);

  // setContextMenu() replaces the panel's entire native right-click menu -
  // including the normal "Copy" item. Text can still be selected by
  // click-dragging as usual, but without this there'd be no way to copy it
  // afterward: no native Edit menu is available to a CEP panel for Cmd+C to
  // hook into, and execCommand("copy") is the standard workaround (older API,
  // but reliably supported in CEP's CEF webview, unlike the async Clipboard
  // API which some CEP versions restrict).
  csInterface.setContextMenu(
    '<Menu>' +
      '<MenuItem Id="copy" Label="Copy" Enabled="true" Checked="false"/>' +
      '<MenuItem Id="reloadPanel" Label="Reload Panel" Enabled="true" Checked="false"/>' +
    '</Menu>',
    function (menuId) {
      if (menuId === "copy") {
        document.execCommand("copy");
      } else if (menuId === "reloadPanel") {
        reloadPanel();
      }
    }
  );

  // Force a fresh reload of the ExtendScript host file every time the panel
  // initializes. Relying solely on the manifest's <ScriptPath> only loads
  // host/main.jsx once per Illustrator session - after that, closing and
  // reopening the panel reloads the HTML/JS side fine, but silently keeps
  // serving the *old* jsx functions until a full Illustrator restart. This
  // makes "close and reopen the panel" reliably pick up jsx edits too.
  (function reloadHostScript() {
    var extensionRoot = csInterface.getSystemPath(SystemPath.EXTENSION);
    var hostScriptPath = extensionRoot + "/host/main.jsx";
    var escapedPath = hostScriptPath.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    csInterface.evalScript('$.evalFile("' + escapedPath + '")');
  })();

  // Shows the extension's version in the panel footer, read straight out
  // of CSXS/manifest.xml rather than hardcoded here - manifest.xml is the
  // single source of truth packaging/bump-version.sh updates, so this
  // never needs to be kept in sync by hand. A plain regex match on the
  // raw file text is enough (no need for a real XML parser) since
  // ExtensionBundleVersion is a single, simple attribute.
  (function showExtensionVersion() {
    var versionEl = document.getElementById("extensionVersion");
    if (!versionEl) {
      return;
    }
    try {
      var extensionRoot = csInterface.getSystemPath(SystemPath.EXTENSION);
      var xhr = new XMLHttpRequest();
      // Synchronous - a few-KB local file, read once at panel init.
      xhr.open("GET", "file://" + extensionRoot + "/CSXS/manifest.xml", false);
      xhr.send(null);
      var match = xhr.responseText.match(/ExtensionBundleVersion="([^"]+)"/);
      versionEl.textContent = match ? "v" + match[1] : "";
    } catch (e) {
      versionEl.textContent = "";
    }
  })();

  var outputEl = document.getElementById("output");

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  var listLayersButton = document.getElementById("listLayersButton");
  var layerListEl = document.getElementById("layerList");

  listLayersButton.addEventListener("click", function () {
    outputEl.textContent = "Working...";
    layerListEl.innerHTML = "<li>Working...</li>";

    // Calls rm_getActiveDocumentName() in host/main.jsx (auto-loaded via
    // the manifest's ScriptPath). Everything crossing this bridge as plain
    // text is fine here - no structure to lose, unlike the layer tree below
    // which needs JSON to carry names/paths/children.
    csInterface.evalScript("rm_getActiveDocumentName()", function (result) {
      outputEl.textContent = "Document: " + result;
    });

    csInterface.evalScript("rm_listActiveDocumentLayers()", function (result) {
      var data;
      try {
        data = JSON.parse(result);
      } catch (e) {
        layerListEl.innerHTML = "<li>Failed to parse result: " + String(result) + "</li>";
        return;
      }

      if (data.error) {
        layerListEl.innerHTML = "<li>" + data.error + "</li>";
        return;
      }

      if (!data.layers || data.layers.length === 0) {
        layerListEl.innerHTML = "<li>(no top-level layers)</li>";
        return;
      }

      layerListEl.innerHTML = renderTargetTree(data.layers);
    });
  });

  // rm_buildLayerTree() tags every node with a `type` ("Layer" or
  // "GroupItem") - named groups come back too, since the source side
  // needs them (an opened SVG has no real sublayers at all, just nested
  // groups), but a paste destination always has to be a real Layer
  // (Document.activeLayer can't be a GroupItem - see rm_runMove), so
  // groups are filtered out entirely here rather than shown disabled.
  // They'd just be noise for target-picking specifically.
  function filterLayerNodes(nodes) {
    var filtered = [];
    for (var i = 0; i < (nodes || []).length; i++) {
      if (nodes[i].type === "Layer") {
        filtered.push(nodes[i]);
      }
    }
    return filtered;
  }

  // Renders the active document's layer tree as target checkboxes, at any
  // depth (e.g. picking "Desktop/Base Map" as a target, not just
  // top-level "Desktop") - each row's checkbox value is the full path,
  // which rm_runMove resolves the same way the source side resolves a
  // comparison/move-layer path.
  //
  // Sublayers are collapsed by default behind a manual expand/collapse
  // toggle rather than <details>/<summary>: a checkbox nested inside
  // <summary> would also toggle the disclosure on every click (browsers
  // run the summary's default action for any click landing inside it),
  // which would be constant friction here since checking a target is the
  // single most common click in this list. See the click handler below
  // for how the toggle is wired up.
  function renderTargetTree(nodes) {
    var layerNodes = filterLayerNodes(nodes);
    if (layerNodes.length === 0) {
      return "<li>(none)</li>";
    }
    var html = "";
    for (var i = 0; i < layerNodes.length; i++) {
      var layer = layerNodes[i];
      var childLayers = filterLayerNodes(layer.children);
      var escapedPath = escapeHtml(layer.path);
      var childNote = childLayers.length
        ? " (" + childLayers.length + " sublayer" + (childLayers.length === 1 ? "" : "s") + ")"
        : "";

      html += "<li>";
      if (childLayers.length > 0) {
        html += "<span class=\"tree-toggle\" data-expanded=\"false\">&#9656;</span> ";
      }
      html += "<input type=\"checkbox\" name=\"targetLayers\" value=\"" + escapedPath + "\"> " +
        escapeHtml(layer.name) + childNote;
      if (childLayers.length > 0) {
        html += "<ul class=\"tree-children collapsed\">" + renderTargetTree(childLayers) + "</ul>";
      }
      html += "</li>";
    }
    return html;
  }

  // Delegated once on the stable container rather than per-toggle:
  // listLayersButton's handler replaces layerListEl's entire innerHTML on
  // every click, which would silently drop any listeners bound directly
  // to individual .tree-toggle spans. Binding here instead survives every
  // rebuild with no re-wiring needed.
  layerListEl.addEventListener("click", function (event) {
    var toggle = event.target.closest(".tree-toggle");
    if (!toggle) {
      return;
    }
    var childList = toggle.parentElement.querySelector(":scope > ul.tree-children");
    if (!childList) {
      return;
    }
    var expanded = toggle.getAttribute("data-expanded") === "true";
    childList.classList.toggle("collapsed", expanded);
    toggle.setAttribute("data-expanded", expanded ? "false" : "true");
    toggle.innerHTML = expanded ? "&#9656;" : "&#9662;";
  });

  var chooseFileButton = document.getElementById("chooseFileButton");
  var chosenFilePathEl = document.getElementById("chosenFilePath");

  // Kept separate from chosenFilePathEl's text, since that can also show
  // "(cancelled)" or an error message - this is only ever a real path or null.
  var chosenFilePath = null;

  // Renders the move-layer checkbox tree as nested <ul>s - any number of
  // these can be checked, at any depth.
  function renderMoveLayerTree(layers) {
    if (!layers || layers.length === 0) {
      return "<li>(none)</li>";
    }
    var html = "";
    for (var i = 0; i < layers.length; i++) {
      var layer = layers[i];
      var escapedPath = escapeHtml(layer.path);
      html += "<li>" +
        "<input type=\"checkbox\" name=\"moveLayers\" value=\"" + escapedPath + "\"> " +
        escapeHtml(layer.name);
      if (layer.children && layer.children.length > 0) {
        html += "<ul>" + renderMoveLayerTree(layer.children) + "</ul>";
      }
      html += "</li>";
    }
    return html;
  }

  // The comparison layer is a single pick across the *whole* tree, so a
  // dropdown fits better than a radio buried inside the tree above - but
  // it still needs to offer every layer at every depth, not just
  // top-level ones. Flattens depth-first, indenting each option with
  // non-breaking spaces (regular spaces collapse in <option> text) so the
  // hierarchy is still visible even though the list itself is flat.
  function flattenLayersForSelect(layers, depth, out) {
    depth = depth || 0;
    out = out || [];
    for (var i = 0; i < (layers || []).length; i++) {
      var layer = layers[i];
      out.push({ path: layer.path, name: layer.name, depth: depth });
      if (layer.children && layer.children.length > 0) {
        flattenLayersForSelect(layer.children, depth + 1, out);
      }
    }
    return out;
  }

  function renderComparisonOptions(layers) {
    var flat = flattenLayersForSelect(layers);
    if (flat.length === 0) {
      return "<option value=\"\">(none)</option>";
    }
    var html = "<option value=\"\">(choose a layer)</option>";
    for (var i = 0; i < flat.length; i++) {
      var indent = new Array(flat[i].depth + 1).join("\u00A0\u00A0");
      html += "<option value=\"" + escapeHtml(flat[i].path) + "\">" +
        indent + escapeHtml(flat[i].name) + "</option>";
    }
    return html;
  }

  var sourceLayerTreeEl = document.getElementById("sourceLayerTree");
  var comparisonLayerSelectEl = document.getElementById("comparisonLayerSelect");

  // Sets the same placeholder message into both the comparison dropdown
  // and the move-layer tree - they're always rendered from the same
  // rm_openSourceFile() call, so every non-success state (no file chosen
  // yet, still opening, or an error) applies to both at once.
  function setSourceMessage(message) {
    comparisonLayerSelectEl.innerHTML = "<option value=\"\">" + escapeHtml(message) + "</option>";
    sourceLayerTreeEl.innerHTML = "<li>" + escapeHtml(message) + "</li>";
  }

  // Opens whatever's currently in chosenFilePath and lists its layer tree.
  // Called automatically right after a file is chosen (below) - kept as its
  // own function (rather than inlined into the choose-file callback) so the
  // "pick a path" and "open it and list layers" concerns stay separately
  // readable even though they now always fire back-to-back. rm_openSourceFile()
  // itself already handles reusing an already-open matching doc vs. closing
  // and reopening a different one, so there's nothing extra to do here for
  // that case.
  function openSourceFile() {
    if (!chosenFilePath) {
      setSourceMessage("Choose a source file first.");
      return;
    }

    setSourceMessage("Opening...");

    // JSON.stringify() on a string produces a properly-escaped, quoted JS
    // string literal - valid to splice directly into the ExtendScript call
    // rather than hand-rolling quote/backslash escaping ourselves.
    csInterface.evalScript("rm_openSourceFile(" + JSON.stringify(chosenFilePath) + ")", function (result) {
      var data;
      try {
        data = JSON.parse(result);
      } catch (e) {
        setSourceMessage("Failed to parse result: " + String(result));
        return;
      }

      if (data.error) {
        setSourceMessage(data.error);
        return;
      }

      comparisonLayerSelectEl.innerHTML = renderComparisonOptions(data.layers);
      sourceLayerTreeEl.innerHTML = renderMoveLayerTree(data.layers);
    });
  }

  chooseFileButton.addEventListener("click", function () {
    csInterface.evalScript("rm_chooseSourceFile()", function (result) {
      var data;
      try {
        data = JSON.parse(result);
      } catch (e) {
        chosenFilePathEl.textContent = "Failed to parse result: " + String(result);
        return;
      }

      if (data.error) {
        chosenFilePathEl.textContent = data.error;
        return;
      }
      if (data.cancelled) {
        chosenFilePathEl.textContent = "(cancelled)";
        return; // leave whatever was already open/listed alone
      }

      chosenFilePathEl.textContent = data.path;
      chosenFilePath = data.path;
      openSourceFile();
    });
  });

  function checkedValues(name) {
    var inputs = document.querySelectorAll('input[name="' + name + '"]:checked');
    var values = [];
    for (var i = 0; i < inputs.length; i++) {
      values.push(inputs[i].value);
    }
    return values;
  }

  // Step 4: full run - every checked move-layer into every checked
  // target, in one call. rm_runMove() always returns a full per-
  // combination report (never a single top-level error, unless something
  // fails before the per-target loop even starts, e.g. no source file
  // open) - a target with no matching comparison container, or one bad
  // move-layer within an otherwise-good target, only skips that specific
  // line rather than aborting the rest.
  var moveLayerButton = document.getElementById("moveLayerButton");
  var moveLayerResultEl = document.getElementById("moveLayerResult");
  var copyStylesCheckbox = document.getElementById("copyStylesCheckbox");

  moveLayerButton.addEventListener("click", function () {
    var comparisonPath = comparisonLayerSelectEl.value;
    var moveLayers = checkedValues("moveLayers");
    var targets = checkedValues("targetLayers");
    var copyStyles = copyStylesCheckbox.checked;

    if (!comparisonPath) {
      moveLayerResultEl.textContent = "Pick a comparison layer first.";
      return;
    }
    if (moveLayers.length === 0) {
      moveLayerResultEl.textContent = "Check at least one move-layer first.";
      return;
    }
    if (targets.length === 0) {
      moveLayerResultEl.textContent = "Check at least one target first.";
      return;
    }

    moveLayerResultEl.textContent = "Running...";

    var call = "rm_runMove(" +
      JSON.stringify(comparisonPath) + ", " +
      JSON.stringify(moveLayers) + ", " +
      JSON.stringify(targets) + ", " +
      JSON.stringify(copyStyles) +
      ")";

    csInterface.evalScript(call, function (result) {
      var data;
      try {
        data = JSON.parse(result);
      } catch (e) {
        moveLayerResultEl.textContent = "Failed to parse result: " + String(result);
        return;
      }

      if (data.error) {
        moveLayerResultEl.textContent = data.error;
        return;
      }

      var lines = data.results.map(function (r) {
        if (r.skipped) {
          return r.target + " / " + (r.moveLayer || "(all move-layers)") + ": SKIPPED - " + r.reason;
        }
        var styledNote = r.styledFrom ? ", styled from existing \"" + r.styledFrom + "\"" : "";
        return r.target + " / " + r.moveLayer + ": moved as \"" + r.combinedName + "\" at " +
          r.scalePct.toFixed(2) + "% (" + r.method + ")" + styledNote;
      });

      moveLayerResultEl.textContent = lines.join("\n");
    });
  });
})();
