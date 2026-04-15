// ============================================
// DCO Layer Switcher — Standalone Script (v2)
// ============================================

(function () {
  function fail(msg) {
    alert(msg, "Layer Switcher");
  }

  function esc(str) {
    return String(str).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  var comp = app.project.activeItem;
  if (!comp || !(comp instanceof CompItem)) {
    fail("Open a composition first.");
    return;
  }

  var selected = comp.selectedLayers;
  if (!selected || selected.length < 2) {
    fail("Select at least 2 layers to create a switcher.");
    return;
  }

  // Store only plain values before changing the comp
  var layerNames = [];
  var layerOriginalIndices = [];
  for (var i = 0; i < selected.length; i++) {
    layerNames.push(String(selected[i].name));
    layerOriginalIndices.push(Number(selected[i].index));
  }

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

  app.beginUndoGroup("Create Layer Switcher: " + switcherName);

  try {
    var d, s, k;

    // Deselect first
    for (d = 1; d <= comp.numLayers; d++) {
      comp.layer(d).selected = false;
    }

    // Create controller
    var ctrl = comp.layers.addNull();
    var ctrlIndex = ctrl.index;

    // IMPORTANT:
    // After assigning name / adding effects, reacquire the layer by index.
    comp.layer(ctrlIndex).name = ctrlFullName;
    comp.layer(ctrlIndex).label = 9;

    // Add dropdown to reacquired layer ref
    var ctrlLayer = comp.layer(ctrlIndex);
    ctrlLayer.property("ADBE Effect Parade").addProperty("ADBE Dropdown Control");

    // Reacquire effect by matchName/index, then rename
    ctrlLayer = comp.layer(ctrlIndex);
    var fxParade = ctrlLayer.property("ADBE Effect Parade");
    var dropdownEffect = fxParade.property(fxParade.numProperties);
    dropdownEffect.name = switcherName;

    // Reacquire again before touching menu property
    ctrlLayer = comp.layer(ctrlIndex);
    fxParade = ctrlLayer.property("ADBE Effect Parade");
    dropdownEffect = fxParade.property(switcherName);
    if (!dropdownEffect) {
      throw new Error("Could not find the dropdown effect after creating it.");
    }

    var menuProp = dropdownEffect.property(1);
    if (!menuProp) {
      throw new Error("Could not access dropdown menu property.");
    }

    // Some AE versions can fail here. Keep going if labels cannot be set.
    try {
      menuProp.setPropertyParameters(layerNames);
    } catch (eMenu) {
      // ignore and keep default items if this AE build does not support it correctly
    }

    menuProp.setValue(1);

    var ctrlLayerName = esc(comp.layer(ctrlIndex).name);
    var effectName = esc(switcherName);
    var appliedCount = 0;

    for (k = 0; k < layerOriginalIndices.length; k++) {
      var targetIndex = layerOriginalIndices[k] + 1; // null inserted at top
      if (targetIndex < 1 || targetIndex > comp.numLayers) continue;
      if (targetIndex === ctrlIndex) continue;

      var targetLayer = comp.layer(targetIndex);
      if (!targetLayer) continue;

      var opacityProp = null;
      try {
        opacityProp = targetLayer.property("ADBE Transform Group").property("ADBE Opacity");
      } catch (eOpacity1) {
        opacityProp = null;
      }

      if (!opacityProp) {
        try {
          opacityProp = targetLayer.transform.opacity;
        } catch (eOpacity2) {
          opacityProp = null;
        }
      }

      if (!opacityProp) continue;

      var expr = ''
        + 'var sel = thisComp.layer("' + ctrlLayerName + '").effect("' + effectName + '")(1).value;\n'
        + '(sel == ' + (k + 1) + ') ? 100 : 0;';

      opacityProp.expression = expr;
      appliedCount++;
    }

    for (s = 1; s <= comp.numLayers; s++) {
      comp.layer(s).selected = false;
    }
    comp.layer(ctrlIndex).selected = true;

    alert(
      "Layer Switcher created!\n\n" +
      "Controller: " + comp.layer(ctrlIndex).name + "\n" +
      "Dropdown: " + switcherName + "\n" +
      "Expressions applied: " + appliedCount + " / " + layerNames.length,
      "Layer Switcher"
    );

  } catch (e) {
    fail("Error: " + e.toString());
  } finally {
    app.endUndoGroup();
  }
})();
