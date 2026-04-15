// ============================================
// DCO Layer Switcher — Standalone Script (fixed)
// ============================================
// Run from After Effects: File > Scripts > Run Script File
//
// FIXES:
// - Uses dropdown property index (1) in the expression instead of "Menu"
//   so it works in non-English After Effects too.
// - Re-targets layers by stored indices, not by names, so duplicate names do not break it.
// - Escapes controller/effect names safely inside expressions.
// ============================================

(function () {
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

  // Store plain values only.
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

  function esc(str) {
    return String(str).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  app.beginUndoGroup("Create Layer Switcher: " + switcherName);

  try {
    // Deselect first to avoid insertion quirks.
    for (var d = 1; d <= comp.numLayers; d++) {
      comp.layer(d).selected = false;
    }

    var ctrl = comp.layers.addNull();
    ctrl.name = ctrlFullName;
    ctrl.label = 9;

    var dropdownEffect = ctrl.property("ADBE Effect Parade").addProperty("ADBE Dropdown Control");
    dropdownEffect.name = switcherName;

    var menuProp = dropdownEffect.property(1);
    menuProp.setPropertyParameters(layerNames);
    menuProp.setValue(1);

    var ctrlLayerName = esc(ctrl.name);
    var effectName = esc(dropdownEffect.name);
    var appliedCount = 0;

    for (var k = 0; k < layerOriginalIndices.length; k++) {
      // addNull() inserts a new layer, shifting original indices by +1.
      var targetIndex = layerOriginalIndices[k] + 1;
      if (targetIndex < 1 || targetIndex > comp.numLayers) continue;
      if (targetIndex === ctrl.index) continue;

      var layer = comp.layer(targetIndex);
      if (!layer) continue;

      var expr = ''
        + 'var ctrl = thisComp.layer("' + ctrlLayerName + '");\n'
        + 'var sel = ctrl.effect("' + effectName + '")(1).value;\n'
        + '(sel === ' + (k + 1) + ') ? 100 : 0;';

      try {
        layer.property("ADBE Transform Group").property("ADBE Opacity").expression = expr;
        appliedCount++;
      } catch (e1) {
        try {
          layer.transform.opacity.expression = expr;
          appliedCount++;
        } catch (e2) {}
      }
    }

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
  } catch (e) {
    alert("Error: " + e.toString(), "Layer Switcher");
  } finally {
    app.endUndoGroup();
  }
})();
