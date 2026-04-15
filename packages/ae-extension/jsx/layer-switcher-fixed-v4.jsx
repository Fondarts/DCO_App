// ============================================
// DCO Layer Switcher — robust dropdown version
// ============================================
(function () {
  function fail(step, err) {
    alert("STEP: " + step + "\n" + err.toString(), "Layer Switcher");
  }

  function esc(str) {
    return String(str).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  function getDropdownMenuProperty(effectProp) {
    if (!effectProp) return null;

    // Try the known match name first
    for (var i = 1; i <= effectProp.numProperties; i++) {
      try {
        var p = effectProp.property(i);
        if (p && p.matchName === "ADBE Dropdown Control-0001") {
          return p;
        }
      } catch (e) {}
    }

    // Fallback: display name
    try {
      if (effectProp.property("Menu")) return effectProp.property("Menu");
    } catch (e2) {}

    // Fallback: first child
    try {
      if (effectProp.property(1)) return effectProp.property(1);
    } catch (e3) {}

    return null;
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
  var layerIndices = [];
  for (var i = 0; i < selected.length; i++) {
    layerNames.push(String(selected[i].name));
    layerIndices.push(Number(selected[i].index));
  }

  var dialog = new Window("dialog", "DCO Layer Switcher");
  dialog.orientation = "column";
  dialog.alignChildren = ["fill", "top"];

  var g = dialog.add("group");
  g.add("statictext", undefined, "Switcher name:");
  var input = g.add("edittext", undefined, "Layer Switch");
  input.characters = 25;

  var btns = dialog.add("group");
  btns.alignment = ["right", "bottom"];
  btns.add("button", undefined, "Cancel", {name: "cancel"});
  btns.add("button", undefined, "Create Switcher", {name: "ok"});

  if (dialog.show() !== 1) return;

  var switcherName = input.text || "Layer Switch";
  var ctrlName = "[CTRL] " + switcherName;

  app.beginUndoGroup("Create Layer Switcher");

  try {
    // deselect all
    for (var d = 1; d <= comp.numLayers; d++) comp.layer(d).selected = false;

    // create controller
    var ctrl = comp.layers.addNull();
    ctrl.name = ctrlName;
    ctrl.label = 9;

    // add dropdown control
    var parade = ctrl.property("ADBE Effect Parade");
    var fx = parade.addProperty("ADBE Dropdown Control");
    var fxIndex = fx.propertyIndex;

    // reacquire by index immediately
    parade = ctrl.property("ADBE Effect Parade");
    fx = parade.property(fxIndex);
    fx.name = switcherName;

    // reacquire again after rename
    parade = ctrl.property("ADBE Effect Parade");
    fx = parade.property(fxIndex);

    var menuProp = getDropdownMenuProperty(fx);
    if (!menuProp) {
      throw new Error("Could not find Dropdown Menu property.");
    }

    // Some AE versions invalidate the menu property when setting parameters.
    // Reacquire directly from the effect right before the call.
    menuProp = getDropdownMenuProperty(ctrl.property("ADBE Effect Parade").property(fxIndex));
    if (!menuProp) {
      throw new Error("Dropdown Menu property became invalid.");
    }

    // Set labels
    menuProp.setPropertyParameters(layerNames);
    menuProp.setValue(1);

    var ctrlLayerName = esc(ctrl.name);
    var effectName = esc(switcherName);
    var applied = 0;

    for (var k = 0; k < layerIndices.length; k++) {
      var targetIndex = layerIndices[k] + 1; // new null inserted at top
      if (targetIndex < 1 || targetIndex > comp.numLayers) continue;
      if (targetIndex === ctrl.index) continue;

      var layer = comp.layer(targetIndex);
      if (!layer) continue;

      var expr = ''
        + 'var ctrl = thisComp.layer("' + ctrlLayerName + '");\n'
        + 'var sel = ctrl.effect("' + effectName + '")(1).value;\n'
        + '(sel == ' + (k + 1) + ') ? 100 : 0;';

      try {
        layer.property("ADBE Transform Group").property("ADBE Opacity").expression = expr;
        applied++;
      } catch (e1) {
        try {
          layer.transform.opacity.expression = expr;
          applied++;
        } catch (e2) {}
      }
    }

    for (var s = 1; s <= comp.numLayers; s++) comp.layer(s).selected = false;
    ctrl.selected = true;

    alert("OK\nExpressions applied: " + applied + " / " + layerNames.length, "Layer Switcher");

  } catch (e) {
    fail("main", e);
  } finally {
    app.endUndoGroup();
  }
})();
