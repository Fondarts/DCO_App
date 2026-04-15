// ============================================
// DCO Layer Switcher — v7
// Minimal stable fix:
// - keep Dropdown Menu Control default name
// - set menu items the same way v5 did
// - expressions point to the real default effect name
// ============================================
(function () {
  function esc(str) {
    return String(str).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  function sanitizeMenuItems(names) {
    var out = [];
    var seen = {};
    for (var i = 0; i < names.length; i++) {
      var base = String(names[i] || "");
      base = base.replace(/\\/g, "/");
      if (base === "") base = "Item " + (i + 1);

      var item = base;
      var n = 2;
      while (seen[item]) {
        item = base + " (" + n + ")";
        n++;
      }
      seen[item] = true;
      out.push(item);
    }
    return out;
  }

  var comp = app.project.activeItem;
  if (!comp || !(comp instanceof CompItem)) {
    alert("Open a composition first.", "Layer Switcher");
    return;
  }

  var selected = comp.selectedLayers;
  if (!selected || selected.length < 2) {
    alert("Select at least 2 layers.", "Layer Switcher");
    return;
  }

  var layerNames = [];
  var layerIds = [];
  for (var i = 0; i < selected.length; i++) {
    layerNames.push(String(selected[i].name));
    try {
      layerIds.push(Number(selected[i].id));
    } catch (e) {
      layerIds.push(-1);
    }
  }

  var dialog = new Window("dialog", "DCO Layer Switcher");
  dialog.orientation = "column";
  dialog.alignChildren = ["fill", "top"];

  var row = dialog.add("group");
  row.add("statictext", undefined, "Switcher name:");
  var input = row.add("edittext", undefined, "Layer Switch");
  input.characters = 24;

  var buttons = dialog.add("group");
  buttons.alignment = ["right", "bottom"];
  buttons.add("button", undefined, "Cancel", {name: "cancel"});
  buttons.add("button", undefined, "Create", {name: "ok"});

  if (dialog.show() !== 1) return;

  var switcherName = input.text || "Layer Switch";
  var ctrlName = "[CTRL] " + switcherName;
  var menuItems = sanitizeMenuItems(layerNames);

  app.beginUndoGroup("Create Layer Switcher");

  try {
    for (var d = 1; d <= comp.numLayers; d++) {
      comp.layer(d).selected = false;
    }

    var ctrl = comp.layers.addNull();
    var ctrlIndex = ctrl.index;
    ctrl.name = ctrlName;
    ctrl.label = 9;

    // Create dropdown. Do NOT rename the effect.
    var fx = comp.layer(ctrlIndex)
      .property("ADBE Effect Parade")
      .addProperty("ADBE Dropdown Control");

    var fxIndex = fx.propertyIndex;

    // Reacquire fresh each time to avoid invalid object refs.
    comp.layer(ctrlIndex)
      .property("ADBE Effect Parade")
      .property(fxIndex)
      .property(1)
      .setPropertyParameters(menuItems);

    comp.layer(ctrlIndex)
      .property("ADBE Effect Parade")
      .property(fxIndex)
      .property(1)
      .setValue(1);

    var ctrlExprName = esc(ctrlName);
    var effectExprName = "Dropdown Menu Control";
    var applied = 0;

    for (var k = 0; k < layerIds.length; k++) {
      var layer = null;

      if (layerIds[k] > 0) {
        try {
          layer = app.project.layerByID(layerIds[k]);
        } catch (e1) {
          layer = null;
        }
      }

      if (!layer) continue;
      if (layer.index === ctrlIndex) continue;

      var expr =
        'if (thisComp.layer("' + ctrlExprName + '").effect("' + effectExprName + '")("Menu").value == ' + (k + 1) + ') 100; else 0;';

      try {
        layer.property("ADBE Transform Group").property("ADBE Opacity").expression = expr;
        applied++;
      } catch (e2) {}
    }

    for (var s = 1; s <= comp.numLayers; s++) {
      comp.layer(s).selected = false;
    }
    comp.layer(ctrlIndex).selected = true;

    alert("Created.\nExpressions applied: " + applied + " / " + layerNames.length, "Layer Switcher");

  } catch (e) {
    alert("Error:\n" + e.toString(), "Layer Switcher");
  } finally {
    app.endUndoGroup();
  }
})();
