// ============================================
// DCO Layer Switcher — Standalone Script
// ============================================
// Run from After Effects: File > Scripts > Run Script File
//
// HOW TO USE:
// 1. Select 2+ layers in your composition
// 2. Run this script
// 3. Enter a name for the switcher (e.g. "Background", "Logo Variant")
// 4. A controller null is created with a Dropdown Menu Control
// 5. The dropdown toggles opacity of the selected layers (only one visible at a time)
// 6. Drag the dropdown effect to Essential Graphics panel to include in MOGRT
// ============================================

(function() {
  var comp = app.project.activeItem;
  if (!comp || !(comp instanceof CompItem)) {
    alert("Open a composition first.", "Layer Switcher");
    return;
  }

  var selected = comp.selectedLayers;
  if (!selected || selected.length < 2) {
    alert("Select at least 2 layers to create a switcher.", "Layer Switcher");
    return;
  }

  // Capture names and indices IMMEDIATELY as plain values (not object refs)
  var layerNames = [];
  var layerOriginalIndices = [];
  for (var i = 0; i < selected.length; i++) {
    layerNames.push(String(selected[i].name));
    layerOriginalIndices.push(Number(selected[i].index));
  }

  // --- Dialog ---
  var dialog = new Window("dialog", "DCO Layer Switcher");
  dialog.orientation = "column";
  dialog.alignChildren = ["fill", "top"];

  var nameGroup = dialog.add("group");
  nameGroup.add("statictext", undefined, "Switcher name:");
  var nameInput = nameGroup.add("edittext", undefined, "Layer Switch");
  nameInput.characters = 25;

  var listPanel = dialog.add("panel", undefined, "Layers (" + layerNames.length + ")");
  listPanel.alignChildren = ["fill", "top"];
  for (var p = 0; p < layerNames.length; p++) {
    var row = listPanel.add("group");
    row.add("statictext", undefined, (p + 1) + ".");
    row.add("statictext", undefined, layerNames[p]);
  }

  var btnGroup = dialog.add("group");
  btnGroup.alignment = ["right", "bottom"];
  btnGroup.add("button", undefined, "Cancel", { name: "cancel" });
  btnGroup.add("button", undefined, "Create Switcher", { name: "ok" });

  if (dialog.show() !== 1) return;

  var switcherName = nameInput.text || "Layer Switch";
  var ctrlFullName = "[CTRL] " + switcherName;

  // --- Create ---
  app.beginUndoGroup("Create Layer Switcher: " + switcherName);

  try {
    // Step 1: Deselect all layers first (prevents addNull insertion quirks)
    for (var d = 1; d <= comp.numLayers; d++) {
      comp.layer(d).selected = false;
    }

    // Step 2: Create controller null
    var ctrl = comp.layers.addNull();
    ctrl.name = ctrlFullName;
    ctrl.label = 9;

    // Step 3: Add Dropdown Menu Control
    var dropdownEffect = ctrl.property("ADBE Effect Parade").addProperty("ADBE Dropdown Control");
    dropdownEffect.name = switcherName;

    var menuProp = dropdownEffect.property(1);
    try {
      menuProp.setPropertyParameters(layerNames);
    } catch(e) {}
    menuProp.setValue(1);

    // Step 4: Find each target layer by name and apply opacity expression.
    // We search by name because layer object references are invalidated
    // after addNull() modifies the layer stack.
    var ctrlLayerName = ctrl.name.replace(/"/g, '\\"');
    var effectName = dropdownEffect.name.replace(/"/g, '\\"');
    var matched = {};  // track matched comp indices to handle duplicate names
    var appliedCount = 0;

    for (var k = 0; k < layerNames.length; k++) {
      var targetName = layerNames[k];
      var dropdownIndex = k + 1;
      var layer = null;

      // Scan all layers in comp to find this one by name
      for (var m = 1; m <= comp.numLayers; m++) {
        if (matched[m]) continue;              // already used for a previous match
        if (m === ctrl.index) continue;         // skip our controller null
        if (comp.layer(m).name === targetName) {
          layer = comp.layer(m);
          matched[m] = true;
          break;
        }
      }

      if (!layer) continue;

      var expr = 'var sel = thisComp.layer("' + ctrlLayerName + '")'
        + '.effect("' + effectName + '")("Menu").value;\n'
        + 'sel == ' + dropdownIndex + ' ? 100 : 0;';

      // Apply expression to opacity — try two property path variants
      try {
        layer.property("ADBE Transform Group").property("ADBE Opacity").expression = expr;
        appliedCount++;
      } catch(e1) {
        try {
          layer.transform.opacity.expression = expr;
          appliedCount++;
        } catch(e2) {
          // Layer type doesn't support opacity expression
        }
      }
    }

    // Select controller
    for (var s = 1; s <= comp.numLayers; s++) {
      comp.layer(s).selected = false;
    }
    ctrl.selected = true;

    alert(
      "Layer Switcher created!\n\n"
      + "Controller: " + ctrl.name + "\n"
      + "Dropdown: " + dropdownEffect.name + "\n"
      + "Expressions applied: " + appliedCount + " / " + layerNames.length + "\n\n"
      + "To use in MOGRT:\n"
      + "Drag '" + dropdownEffect.name + "' from the\n"
      + "Effect Controls to Essential Graphics panel.",
      "Layer Switcher"
    );

  } catch(e) {
    alert("Error: " + e.toString(), "Layer Switcher");
  } finally {
    app.endUndoGroup();
  }
})();
