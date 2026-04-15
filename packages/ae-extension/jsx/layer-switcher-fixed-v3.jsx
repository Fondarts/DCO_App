// ============================================
// DCO Layer Switcher — Standalone Script (fixed v3)
// ============================================

(function () {
  function fail(step, err) {
    alert("STEP: " + step + "\n" + String(err), "Layer Switcher");
  }

  function esc(str) {
    return String(str).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

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
    var d;

    // 1) Deselect everything
    for (d = 1; d <= comp.numLayers; d++) {
      comp.layer(d).selected = false;
    }

    // 2) Create controller
    var ctrlIndex;
    try {
      comp.layers.addNull();
      ctrlIndex = 1; // addNull inserts at top
      comp.layer(ctrlIndex).name = ctrlFullName;
      comp.layer(ctrlIndex).label = 9;
    } catch (e) {
      fail("create controller", e);
      throw e;
    }

    // 3) Add dropdown effect
    var effectIndex;
    try {
      var fxParade = comp.layer(ctrlIndex).property("ADBE Effect Parade");
      fxParade.addProperty("ADBE Dropdown Control");
      effectIndex = fxParade.numProperties;
    } catch (e2) {
      fail("add dropdown control", e2);
      throw e2;
    }

    // 4) Reacquire effect and configure it
    try {
      comp.layer(ctrlIndex).property("ADBE Effect Parade").property(effectIndex).name = switcherName;
    } catch (e3) {
      fail("rename dropdown effect", e3);
      throw e3;
    }

    try {
      var menuProp = comp.layer(ctrlIndex)
        .property("ADBE Effect Parade")
        .property(effectIndex)
        .property(1);

      if (menuProp && menuProp.setPropertyParameters) {
        menuProp.setPropertyParameters(layerNames);
      }
      menuProp.setValue(1);
    } catch (e4) {
      fail("set dropdown items", e4);
      throw e4;
    }

    // 5) Apply opacity expressions to original layers (+1 because null inserted at top)
    var appliedCount = 0;
    var ctrlLayerName = esc(ctrlFullName);
    var effectName = esc(switcherName);

    for (var k = 0; k < layerOriginalIndices.length; k++) {
      var targetIndex = layerOriginalIndices[k] + 1;
      if (targetIndex < 1 || targetIndex > comp.numLayers) continue;
      if (targetIndex === ctrlIndex) continue;

      try {
        var targetLayer = comp.layer(targetIndex);
        var opacityProp = targetLayer.property("ADBE Transform Group").property("ADBE Opacity");

        if (!opacityProp) continue;

        var expr = ''
          + 'var sel = thisComp.layer("' + ctrlLayerName + '").effect("' + effectName + '")(1).value;\n'
          + '(sel == ' + (k + 1) + ') ? 100 : 0;';

        opacityProp.expression = expr;
        appliedCount++;
      } catch (e5) {
        // skip this layer and continue
      }
    }

    // 6) Select controller
    for (d = 1; d <= comp.numLayers; d++) {
      comp.layer(d).selected = false;
    }
    comp.layer(ctrlIndex).selected = true;

    alert(
      "Created.\n"
      + "Expressions applied: " + appliedCount + " / " + layerNames.length,
      "Layer Switcher"
    );

  } catch (err) {
    // fail() already showed the step when possible
  } finally {
    app.endUndoGroup();
  }
})();
