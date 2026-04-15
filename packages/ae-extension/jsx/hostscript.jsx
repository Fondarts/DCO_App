// DCO Panel - ExtendScript (runs inside After Effects)

function getActiveComposition() {
  var comp = app.project.activeItem;
  if (!comp || !(comp instanceof CompItem)) {
    return JSON.stringify({ error: "No active composition" });
  }
  return JSON.stringify({
    name: comp.name,
    width: comp.width,
    height: comp.height,
    fps: comp.frameRate,
    duration: comp.duration,
    numLayers: comp.numLayers
  });
}

// ========================================
// Essential Graphics Parameters (for MOGRT)
// ========================================
function getEssentialGraphicsParameters() {
  var comp = app.project.activeItem;
  if (!comp || !(comp instanceof CompItem)) {
    return JSON.stringify({ error: "No active composition" });
  }

  var results = [];
  var debugLog = [];

  // Collect EG panel names for cross-referencing (even if Method 1 fails)
  var egTopNames = [];
  try {
    var egPanel0 = comp.essentialProperty;
    if (egPanel0 && egPanel0.numProperties > 0) {
      _collectEGLeafNames(egPanel0, egTopNames, 0);
      debugLog.push("EG names(" + egTopNames.length + "): " + egTopNames.join(", "));
    }
  } catch(ex0) {
    debugLog.push("EG name scan err: " + ex0.toString());
  }

  // Method 1: comp.essentialProperty (AE CC 2019+ / v16.0+)
  try {
    var egPanel = comp.essentialProperty;
    if (egPanel && egPanel.numProperties > 0) {
      debugLog.push("M1: essentialProperty np=" + egPanel.numProperties);
      _scanEGGroupRecursive(egPanel, results, debugLog, 0, "");
    } else {
      debugLog.push("M1: essentialProperty empty or null");
    }
  } catch(ex1) {
    debugLog.push("M1 err: " + ex1.toString());
  }

  // Method 2: Scan ALL layer effects (not just Expression Controls)
  // This catches Dropdown Controls, Slider Controls, etc. on any layer
  if (results.length === 0) {
    debugLog.push("M2: scanning all layer effects");
    for (var i = 1; i <= comp.numLayers; i++) {
      var layer = comp.layer(i);
      try {
        // Scan effects
        var effects = layer.property("ADBE Effect Parade");
        if (effects && effects.numProperties > 0) {
          for (var ef = 1; ef <= effects.numProperties; ef++) {
            var effect = effects.property(ef);
            if (!effect) continue;

            var mn = "";
            try { mn = effect.matchName; } catch(emn) {}

            debugLog.push("L" + i + "." + ef + " " + effect.name + " mn=" + mn);

            // Try to get the value property (property(1) for most controls)
            for (var ep = 1; ep <= effect.numProperties; ep++) {
              var eProp = effect.property(ep);
              if (!eProp) continue;
              try {
                // Skip non-value properties
                var pvt = eProp.propertyValueType;
                if (pvt === PropertyValueType.NO_VALUE) continue;
                if (pvt === PropertyValueType.CUSTOM_VALUE) continue;
              } catch(epvt) { continue; }

              var eInfo = _analyzeEGParam(eProp, layer);
              if (eInfo) {
                eInfo.parameterName = effect.name;
                eInfo.label = effect.name;

                // Derive better name from controller layer name ("[CTRL] X" → "X")
                if (_isGenericControlName(eInfo.parameterName)) {
                  var ctrlPrefix = "[CTRL] ";
                  var lName = layer.name;
                  if (lName.indexOf(ctrlPrefix) === 0) {
                    var derived = lName.substring(ctrlPrefix.length);
                    if (derived) {
                      eInfo.parameterName = derived;
                      eInfo.label = derived;
                      debugLog.push("  derived name: " + derived);
                    }
                  }
                }

                // Detect dropdown controls:
                // Standard AE: matchName === "ADBE Dropdown Control"
                // Pseudo effects: matchName is Pseudo/@@..., detect by property name "Menu"
                var isDropdown = (mn === "ADBE Dropdown Control");
                if (!isDropdown) {
                  try {
                    var firstProp = effect.property(1);
                    if (firstProp && firstProp.name === "Menu") isDropdown = true;
                  } catch(edp) {}
                }
                // Also detect by Pseudo matchName + numeric value (dropdown value is integer)
                if (!isDropdown && mn.indexOf("Pseudo/") === 0 && typeof eProp.value === "number") {
                  var numVal = eProp.value;
                  if (numVal === Math.floor(numVal) && numVal >= 1 && numVal <= 100) {
                    isDropdown = true;
                  }
                }
                // Also check effect name as fallback
                if (!isDropdown && effect.name.indexOf("Dropdown") >= 0) {
                  isDropdown = true;
                }

                if (isDropdown) {
                  eInfo.fieldType = "dropdown";
                  eInfo.choices = [];
                  // Try standard API first
                  try {
                    var menuProp2 = effect.property(1);
                    if (typeof menuProp2.getPropertyParameters === "function") {
                      var params = menuProp2.getPropertyParameters();
                      if (params && params.length) {
                        for (var pi = 0; pi < params.length; pi++) {
                          eInfo.choices.push(String(params[pi]));
                        }
                      }
                    }
                  } catch(edc) {
                    debugLog.push("Dropdown choices err: " + edc.message);
                  }
                  // Fallback: scan layer expressions for Layer Switcher choices
                  if (eInfo.choices.length === 0) {
                    eInfo.choices = _getChoicesFromExpressions(comp, layer.name, debugLog);
                    if (eInfo.choices.length > 0) {
                      debugLog.push("  choices found: " + eInfo.choices.join(", "));
                    }
                  }
                }
                results.push(eInfo);
                break; // one value per effect
              }
            }
          }
        }

        // Scan text layers
        if (layer instanceof TextLayer) {
          results.push({
            parameterName: layer.name,
            layerName: layer.name,
            fieldType: "text",
            defaultValue: _getTextDefault(layer),
            label: layer.name
          });
        }
      } catch(ex2) {
        debugLog.push("M2 L" + i + " err: " + ex2.toString());
      }
    }

    // Cross-reference Method 2 results with EG names
    if (egTopNames.length > 0 && results.length > 0) {
      debugLog.push("M2 xref: " + results.length + " results vs " + egTopNames.length + " EG names");

      // Build set of names already correctly assigned
      var usedNames = {};
      for (var ui = 0; ui < results.length; ui++) {
        if (!_isGenericControlName(results[ui].parameterName)) {
          usedNames[results[ui].parameterName] = true;
        }
      }

      // Collect EG names not yet used by any result
      var availableNames = [];
      for (var ai = 0; ai < egTopNames.length; ai++) {
        if (!usedNames[egTopNames[ai]]) {
          availableNames.push(egTopNames[ai]);
        }
      }

      debugLog.push("M2 available EG names: " + availableNames.join(", "));

      // Build lookup of all EG names for quick check
      var egNameSet = {};
      for (var eni = 0; eni < egTopNames.length; eni++) {
        egNameSet[egTopNames[eni]] = true;
      }

      // Apply available EG names to results that need renaming:
      // - Generic control names (e.g. "Dropdown Menu Control")
      // - Names not found in EG (e.g. text layers using layer.name instead of EG name)
      var nameIdx = 0;
      for (var ri = 0; ri < results.length && nameIdx < availableNames.length; ri++) {
        var needsRename = _isGenericControlName(results[ri].parameterName) ||
                          !egNameSet[results[ri].parameterName];
        if (needsRename) {
          debugLog.push("M2 rename: " + results[ri].parameterName + " -> " + availableNames[nameIdx]);
          results[ri].parameterName = availableNames[nameIdx];
          results[ri].label = availableNames[nameIdx];
          nameIdx++;
        }
      }
    }
  }

  // Method 3: ADBE Layer Overrides (Essential Properties on nested comps)
  // (only if previous methods produced nothing)
  if (results.length === 0) {
    debugLog.push("M3: scanning ADBE Layer Overrides");
    for (var i3 = 1; i3 <= comp.numLayers; i3++) {
      var layer3 = comp.layer(i3);
      try {
        var overrides = layer3.property("ADBE Layer Overrides");
        if (!overrides || overrides.numProperties === 0) continue;

        for (var j = 1; j <= overrides.numProperties; j++) {
          var oProp = overrides.property(j);
          if (!oProp) continue;
          var oInfo = _analyzeEGParam(oProp, layer3);
          if (oInfo) results.push(oInfo);
        }
      } catch(ex3) {}
    }
  }

  if (results.length === 0) {
    return JSON.stringify({
      error: "No Essential Graphics parameters found. Add properties to the Essential Graphics panel first.",
      debug: debugLog.join(" | ")
    });
  }

  return JSON.stringify({ params: results, debug: debugLog.join(" | ") });
}

// Check if a property name is a generic AE control name (not user-assigned)
function _isGenericControlName(name) {
  var generics = [
    "Dropdown Menu Control", "Menu",
    "Slider Control", "Slider",
    "Color Control", "Color",
    "Point Control", "Point",
    "Checkbox Control", "Checkbox",
    "Layer Control", "Layer",
    "Angle Control", "Angle",
    "Source Text"
  ];
  for (var i = 0; i < generics.length; i++) {
    if (name === generics[i]) return true;
  }
  return false;
}

// Get dropdown choices by scanning layer opacity expressions
// Layer Switcher creates expressions like: sel == N ? 100 : 0
// where the layer name is the dropdown choice label
// Also scans pre-compositions for nested switchers
function _getChoicesFromExpressions(comp, ctrlLayerName, debugLog) {
  var indexed = [];
  var maxIdx = 0;
  var scanned = 0;
  var withExpr = 0;

  // Scan current comp and any pre-comps
  var compsToScan = [comp];
  for (var c = 1; c <= comp.numLayers; c++) {
    try {
      var src = comp.layer(c).source;
      if (src && src instanceof CompItem) compsToScan.push(src);
    } catch(e) {}
  }

  for (var ci = 0; ci < compsToScan.length; ci++) {
    var scanComp = compsToScan[ci];
    for (var i = 1; i <= scanComp.numLayers; i++) {
      try {
        var lyr = scanComp.layer(i);
        scanned++;
        var opacity = lyr.property("ADBE Transform Group").property("ADBE Opacity");
        if (!opacity) continue;
        var exprStr = "";
        try { exprStr = opacity.expression || ""; } catch(e2) { continue; }
        if (!exprStr) continue;
        withExpr++;
        // Check if this expression references our controller layer
        if (exprStr.indexOf(ctrlLayerName) < 0) continue;
        // Extract number from "== N" pattern (handles both "sel == N" and "value == N")
        var eqPos = exprStr.indexOf("== ");
        if (eqPos < 0) eqPos = exprStr.indexOf("==");
        if (eqPos < 0) continue;
        var numStr = "";
        var sp = eqPos + 2;
        while (sp < exprStr.length && exprStr.charAt(sp) === " ") sp++;
        while (sp < exprStr.length && "0123456789".indexOf(exprStr.charAt(sp)) >= 0) {
          numStr += exprStr.charAt(sp);
          sp++;
        }
        if (numStr) {
          var idx = parseInt(numStr, 10);
          if (idx > 0) {
            indexed[idx - 1] = lyr.name;
            if (idx > maxIdx) maxIdx = idx;
          }
        }
      } catch(e) {}
    }
  }

  if (debugLog) {
    debugLog.push("  exprScan(\"" + ctrlLayerName + "\"): layers=" + scanned + " withExpr=" + withExpr + " matched=" + maxIdx);
    // If expressions exist but none matched, dump one sample for debugging
    if (withExpr > 0 && maxIdx === 0) {
      for (var si = 0; si < compsToScan.length; si++) {
        var sc = compsToScan[si];
        for (var sj = 1; sj <= sc.numLayers; sj++) {
          try {
            var sl = sc.layer(sj);
            var sop = sl.property("ADBE Transform Group").property("ADBE Opacity");
            if (sop && sop.expression) {
              debugLog.push("  exprSample: " + sop.expression.replace(/[\r\n]+/g, " ").substring(0, 150));
              si = compsToScan.length; // break outer
              break;
            }
          } catch(e3) {}
        }
      }
    }
  }

  var result = [];
  for (var j = 0; j < maxIdx; j++) {
    result.push(indexed[j] || ("Option " + (j + 1)));
  }
  return result;
}

// Collect user-assigned names from Essential Graphics panel hierarchy
// Groups with only leaf children are parameter wrappers (use group name)
// Groups with sub-groups are organizational (recurse into them)
function _collectEGLeafNames(group, names, depth) {
  if (depth > 10) return;
  try {
    for (var i = 1; i <= group.numProperties; i++) {
      var prop = group.property(i);
      if (!prop) continue;
      var pType = -1;
      try { pType = prop.propertyType; } catch(e) {}
      var propName = "";
      try { propName = prop.name || ""; } catch(e) {}

      if (pType === 1 || pType === 2) {
        // Group - check if it has sub-groups (organizational) or only leaves (wrapper)
        var hasGroupChildren = false;
        try {
          for (var j = 1; j <= prop.numProperties; j++) {
            var child = prop.property(j);
            if (!child) continue;
            var childType = -1;
            try { childType = child.propertyType; } catch(e) {}
            if (childType === 1 || childType === 2) { hasGroupChildren = true; break; }
          }
        } catch(e) {}

        if (!hasGroupChildren && !_isGenericControlName(propName)) {
          // Wrapper group with only leaf children → user-assigned name
          names.push(propName);
        } else if (hasGroupChildren) {
          // Organizational group (layer grouping) → recurse
          _collectEGLeafNames(prop, names, depth + 1);
        }
        // If generic name with only leaves → skip (no user name available)
      } else {
        // Leaf property with non-generic name
        if (!_isGenericControlName(propName)) {
          names.push(propName);
        }
      }
    }
  } catch(e) {}
}

// Recursively scan an EG property group (handles nested layer groups)
// parentGroupName: the name of the parent group, used when a leaf has a generic name
function _scanEGGroupRecursive(group, results, debugLog, depth, parentGroupName) {
  if (depth > 5) return;
  try {
    var np = group.numProperties;
    for (var i = 1; i <= np; i++) {
      var prop = group.property(i);
      if (!prop) continue;

      var pType = -1;
      try { pType = prop.propertyType; } catch(ept) {}

      debugLog.push("d" + depth + "[" + i + "]=" + prop.name + " pt=" + pType + " parent=" + (parentGroupName || ""));

      // PropertyType: PROPERTY=0, INDEXED_GROUP=1, NAMED_GROUP=2
      if (pType === 1 || pType === 2) {
        // Propagate the best non-generic name down the hierarchy
        var nameForChildren = _isGenericControlName(prop.name) ? parentGroupName : prop.name;
        _scanEGGroupRecursive(prop, results, debugLog, depth + 1, nameForChildren);
      } else {
        var info = _analyzeEGParam(prop, null);
        if (info) {
          // Use parent group name when property has a generic AE control name
          if (parentGroupName && _isGenericControlName(info.parameterName)) {
            info.parameterName = parentGroupName;
            info.label = parentGroupName;
          }

          // Detect dropdown: try getPropertyParameters for choices
          try {
            if (typeof prop.getPropertyParameters === "function") {
              var ddParams = prop.getPropertyParameters();
              if (ddParams && ddParams.length > 0) {
                info.fieldType = "dropdown";
                info.choices = [];
                for (var pi = 0; pi < ddParams.length; pi++) {
                  info.choices.push(String(ddParams[pi]));
                }
              }
            }
          } catch(edc) {
            debugLog.push("EG dropdown err: " + edc.message);
          }

          results.push(info);
        }
      }
    }
  } catch(ex) {
    debugLog.push("scan d" + depth + " err: " + ex.toString());
  }
}

function _analyzeEGParam(prop, layer) {
  try {
    var name = prop.name;
    var fieldType = "slider";
    var defaultValue = null;

    // Try to read value
    try {
      var val = prop.value;

      if (val !== undefined && val !== null) {
        if (typeof val === "object" && val.text !== undefined) {
          // TextDocument
          fieldType = "text";
          defaultValue = val.text || "";
        }
        else if (typeof val === "boolean") {
          fieldType = "checkbox";
          defaultValue = val;
        }
        else if (typeof val === "number") {
          fieldType = "slider";
          defaultValue = val;
        }
        else if (typeof val === "string") {
          fieldType = "text";
          defaultValue = val;
        }
        else if (typeof val === "object" && val.length !== undefined) {
          var len = val.length;
          var allNorm = true;
          for (var c = 0; c < Math.min(len, 4); c++) {
            if (val[c] < 0 || val[c] > 1.01) { allNorm = false; break; }
          }

          if (allNorm && (len === 4 || len === 3 || name.indexOf("Color") >= 0 || name.indexOf("color") >= 0)) {
            fieldType = "color";
            defaultValue = [val[0], val[1], val[2]];
          } else if (len === 2) {
            fieldType = "point";
            defaultValue = [val[0], val[1]];
          } else if (len === 3 && !allNorm) {
            fieldType = "point";
            defaultValue = [val[0], val[1], val[2]];
          } else {
            fieldType = "point";
            defaultValue = [];
            for (var v = 0; v < len; v++) defaultValue.push(val[v]);
          }
        }
      }
    } catch(e) {
      // Can't read value - default to slider
      fieldType = "slider";
      defaultValue = 0;
    }

    // Also check propertyValueType for more accurate detection
    try {
      var pvt = prop.propertyValueType;
      if (pvt === PropertyValueType.COLOR) {
        fieldType = "color";
        if (!defaultValue || typeof defaultValue === "number") {
          try { var cv = prop.value; defaultValue = [cv[0], cv[1], cv[2]]; } catch(e2) {}
        }
      }
    } catch(e) {}

    return {
      parameterName: name,
      layerName: layer ? layer.name : "",
      fieldType: fieldType,
      defaultValue: defaultValue,
      label: name
    };
  } catch(e) {
    return null;
  }
}

// ========================================
// Selected Properties (for AEP - legacy)
// ========================================
function getSelectedProperties() {
  var comp = app.project.activeItem;
  if (!comp || !(comp instanceof CompItem)) {
    return JSON.stringify({ error: "No active composition" });
  }

  var results = [];

  var sel = comp.selectedProperties;
  if (sel && sel.length > 0) {
    for (var i = 0; i < sel.length; i++) {
      var info = _analyzeProperty(sel[i]);
      if (info) results.push(info);
    }
  }

  if (results.length === 0) {
    var layers = comp.selectedLayers;
    if (layers && layers.length > 0) {
      for (var j = 0; j < layers.length; j++) {
        var layerInfos = _analyzeLayer(layers[j]);
        for (var k = 0; k < layerInfos.length; k++) {
          results.push(layerInfos[k]);
        }
      }
    }
  }

  if (results.length === 0) {
    return JSON.stringify({ error: "Select a property or layer in the timeline." });
  }

  return JSON.stringify(results);
}

function debugSelectedProperties() {
  var comp = app.project.activeItem;
  if (!comp || !(comp instanceof CompItem)) {
    return JSON.stringify({ error: "No active composition" });
  }

  var debug = [];

  var sel = comp.selectedProperties;
  debug.push("selectedProperties count: " + (sel ? sel.length : 0));

  if (sel) {
    for (var i = 0; i < sel.length; i++) {
      var p = sel[i];
      var info = "  [" + i + "] name=" + p.name;
      info += " matchName=" + (p.matchName || "?");
      try { info += " propertyType=" + p.propertyType; } catch(e) { info += " propertyType=ERR"; }
      try { info += " valueType=" + p.propertyValueType; } catch(e) { info += " valueType=ERR"; }
      try {
        var v = p.value;
        if (typeof v === "object" && v.text) info += " value={text:" + v.text + "}";
        else if (typeof v === "object" && v.length) info += " value=[" + v.join(",") + "]";
        else info += " value=" + v;
      } catch(e) { info += " value=ERR(" + e.message + ")"; }

      var path = [];
      var cur = p;
      while (cur) {
        if (cur instanceof Layer) { path.unshift("LAYER:" + cur.name); break; }
        path.unshift(cur.name || "?");
        cur = cur.parentProperty;
      }
      info += " path=" + path.join(" > ");

      debug.push(info);
    }
  }

  var layers = comp.selectedLayers;
  debug.push("selectedLayers count: " + (layers ? layers.length : 0));

  if (sel) {
    for (var k = 0; k < sel.length; k++) {
      var analyzed = _analyzeProperty(sel[k]);
      if (analyzed) {
        debug.push("  analyzed[" + k + "]: OK type=" + analyzed.fieldType + " path=" + analyzed.propertyPath + (analyzed._debugError ? " ERR=" + analyzed._debugError : ""));
      } else {
        debug.push("  analyzed[" + k + "]: NULL");
      }
    }
  }

  return JSON.stringify({ debug: debug.join("\n") });
}

// ========================================
// Analyze ANY selected property
// ========================================
function _analyzeProperty(prop) {
  var layer = null;
  var pathParts = [];

  try {
    var depth = prop.propertyDepth;
    if (depth !== undefined && depth > 0) {
      layer = prop.propertyGroup(depth);
      for (var d = depth - 1; d >= 1; d--) {
        var grp = prop.propertyGroup(d);
        if (grp && grp.name) pathParts.push(grp.name);
      }
      pathParts.push(prop.name);
    }
  } catch(e) {}

  if (!layer) {
    var current = prop;
    pathParts = [];
    var safety = 0;
    while (current && safety < 20) {
      safety++;
      try {
        if (current instanceof Layer || (current.numLayers !== undefined)) {
          layer = current;
          break;
        }
      } catch(e) {}
      if (current.name) pathParts.unshift(current.name);
      try { current = current.parentProperty; } catch(e) { break; }
    }
  }

  if (!layer) {
    try {
      var comp = app.project.activeItem;
      if (comp && comp.selectedLayers && comp.selectedLayers.length > 0) {
        layer = comp.selectedLayers[0];
        pathParts = [prop.name];
      }
    } catch(e) {}
  }

  if (!layer) return null;

  var matchName = prop.matchName || "";
  var propName = prop.name || "";
  var fullPath = pathParts.join(".");

  if (matchName === "ADBE Text Document" || matchName === "ADBE Text Properties") {
    return _makeResult(layer, "Source Text", "Source Text", "ADBE Text Document", "text", _getTextDefault(layer), null);
  }

  var fieldType = "slider";
  var defaultValue = 0;
  var validation = null;
  var _debugError = "";

  try {
    var rawVal = prop.value;

    if (rawVal !== undefined && rawVal !== null) {
      if (typeof rawVal === "number") {
        fieldType = "slider";
        defaultValue = rawVal;
        validation = _guessSliderRange(propName, matchName, rawVal);
      }
      else if (typeof rawVal === "boolean") {
        fieldType = "checkbox";
        defaultValue = rawVal;
      }
      else if (typeof rawVal === "object") {
        if (rawVal.text !== undefined) {
          fieldType = "text";
          defaultValue = rawVal.text;
          return _makeResult(layer, propName, fullPath, matchName, "text", _getTextDefault(layer), null);
        }
        else if (rawVal.length !== undefined) {
          var len = rawVal.length;
          var isColor = (len >= 3);
          if (isColor) {
            var allNormalized = true;
            for (var c = 0; c < Math.min(len, 4); c++) {
              if (rawVal[c] < 0 || rawVal[c] > 1.01) { allNormalized = false; break; }
            }
            if (allNormalized && (len === 4 || propName.indexOf("Color") >= 0 || propName.indexOf("color") >= 0)) {
              isColor = true;
            } else {
              isColor = false;
            }
          }

          if (isColor && (propName.indexOf("Color") >= 0 || propName.indexOf("color") >= 0 || len === 4)) {
            fieldType = "color";
            defaultValue = [rawVal[0], rawVal[1], rawVal[2]];
          }
          else if (len === 2) {
            fieldType = "point";
            defaultValue = [rawVal[0], rawVal[1]];
            validation = { dimensions: 2 };
          }
          else if (len === 3) {
            fieldType = "point";
            defaultValue = [rawVal[0], rawVal[1], rawVal[2]];
            validation = { dimensions: 3 };
          }
          else if (len >= 4) {
            fieldType = "color";
            defaultValue = [rawVal[0], rawVal[1], rawVal[2]];
          }
        }
      }
    }
  } catch(e) {
    _debugError = e.toString();
    fieldType = "slider";
    defaultValue = 0;
    validation = { min: -10000, max: 10000, step: 1 };
  }

  try {
    var pvt = prop.propertyValueType;
    if (pvt === PropertyValueType.COLOR) {
      fieldType = "color";
      if (!defaultValue || typeof defaultValue === "number") {
        try { var cv2 = prop.value; defaultValue = [cv2[0], cv2[1], cv2[2]]; } catch(e3) {}
      }
    }
  } catch(e) {}

  var result = _makeResult(layer, propName, fullPath, matchName, fieldType, defaultValue, validation);
  if (_debugError) result._debugError = _debugError;
  return result;
}

function _guessSliderRange(name, matchName, currentValue) {
  if (name === "Opacity" || matchName === "ADBE Opacity" || matchName.indexOf("Opacity") >= 0) {
    return { min: 0, max: 100, step: 1 };
  }
  if (name === "Rotation" || matchName.indexOf("Rotation") >= 0 || name === "Z Rotation") {
    return { min: -360, max: 360, step: 0.1 };
  }
  if (name === "Scale") {
    return { min: 0, max: 1000, step: 1 };
  }
  if (name === "Stroke Width" || name.indexOf("Width") >= 0) {
    return { min: 0, max: 100, step: 0.5 };
  }
  var absVal = Math.abs(currentValue || 0);
  if (absVal <= 1) return { min: -1, max: 1, step: 0.01 };
  if (absVal <= 100) return { min: -200, max: 200, step: 0.1 };
  if (absVal <= 1000) return { min: -2000, max: 2000, step: 1 };
  return { min: -10000, max: 10000, step: 1 };
}

function _makeResult(layer, propName, propPath, matchName, fieldType, defaultValue, validation) {
  return {
    layerName: layer.name,
    layerIndex: layer.index,
    propertyName: propName,
    propertyPath: propPath,
    matchName: matchName,
    fieldType: fieldType,
    defaultValue: defaultValue,
    label: propName || layer.name,
    validation: validation
  };
}

function _getTextDefault(layer) {
  try {
    var srcText = layer.property("ADBE Text Properties").property("ADBE Text Document");
    var td = srcText.value;
    return {
      text: td.text || "",
      font: td.font || "",
      fontSize: td.fontSize || 72,
      fillColor: td.fillColor ? [td.fillColor[0], td.fillColor[1], td.fillColor[2]] : null,
      tracking: td.tracking || 0
    };
  } catch(e) {
    return "";
  }
}

function _makeTextResult(layer, textGroup) {
  return _makeResult(layer, "Source Text", "Source Text", "ADBE Text Document", "text", _getTextDefault(layer), null);
}

// ========================================
// Analyze layer (fallback when no property selected)
// ========================================
function _analyzeLayer(layer) {
  var results = [];
  var layerType = _getLayerType(layer);

  if (layerType === "text") {
    results.push(_makeResult(layer, "Source Text", "Source Text", "ADBE Text Document", "text", _getTextDefault(layer), null));
  }
  else if (layerType === "footage") {
    var mediaType = "image";
    try {
      var source = layer.source;
      if (source && source.mainSource && source.mainSource.file) {
        var ext = source.mainSource.file.name.split(".").pop().toLowerCase();
        if ("mp4 mov avi wmv mkv".indexOf(ext) >= 0) mediaType = "video";
        else if ("mp3 wav aac m4a".indexOf(ext) >= 0) mediaType = "audio";
      }
    } catch(e) {}
    results.push(_makeResult(layer, layer.name, "", "", mediaType, null, null));
  }
  else if (layerType === "shape") {
    var fill = _findShapeFillColor(layer);
    if (fill) results.push(fill);
  }

  try {
    var effects = layer.property("ADBE Effect Parade");
    if (effects) {
      for (var i = 1; i <= effects.numProperties; i++) {
        var effect = effects.property(i);
        var effectResults = _scanEffectProperties(layer, effect);
        for (var j = 0; j < effectResults.length; j++) {
          results.push(effectResults[j]);
        }
      }
    }
  } catch(e) {}

  return results;
}

function _scanEffectProperties(layer, effect) {
  var results = [];
  try {
    for (var i = 1; i <= effect.numProperties; i++) {
      var prop = effect.property(i);
      if (!prop) continue;

      var valType = null;
      try { valType = prop.propertyValueType; } catch(e) { continue; }

      var propPath = "Effects." + effect.name + "." + prop.name;
      var info = null;

      if (valType === PropertyValueType.COLOR) {
        var cv = prop.value;
        info = _makeResult(layer, effect.name + " - " + prop.name, propPath, prop.matchName || "", "color",
          cv ? [cv[0], cv[1], cv[2]] : [1,1,1], null);
      }
      else if (valType === PropertyValueType.OneD) {
        info = _makeResult(layer, effect.name + " - " + prop.name, propPath, prop.matchName || "", "slider",
          prop.value || 0, _guessSliderRange(prop.name, prop.matchName || "", prop.value || 0));
      }
      else if (valType === PropertyValueType.TwoD || valType === PropertyValueType.TwoD_SPATIAL) {
        var v2 = prop.value;
        info = _makeResult(layer, effect.name + " - " + prop.name, propPath, prop.matchName || "", "point",
          v2 ? [v2[0], v2[1]] : [0,0], { dimensions: 2 });
      }

      if (info) results.push(info);
    }
  } catch(e) {}
  return results;
}

function _findShapeFillColor(layer) {
  try {
    var contents = layer.property("ADBE Root Vectors Group");
    if (!contents) return null;

    for (var i = 1; i <= contents.numProperties; i++) {
      var group = contents.property(i);
      var subContents = group.property("ADBE Vectors Group");
      if (!subContents) subContents = group.property("Contents");
      if (!subContents) continue;

      for (var j = 1; j <= subContents.numProperties; j++) {
        var item = subContents.property(j);
        if (item.matchName === "ADBE Vector Graphic - Fill") {
          var colorProp = item.property("ADBE Vector Fill Color");
          if (colorProp) {
            var cv = colorProp.value;
            return _makeResult(layer, "Fill Color",
              "Contents." + group.name + ".Contents.Fill 1.Color",
              "ADBE Vector Fill Color", "color",
              cv ? [cv[0], cv[1], cv[2]] : [1,1,1], null);
          }
        }
        if (item.matchName === "ADBE Vector Graphic - Stroke") {
          var strokeColor = item.property("ADBE Vector Stroke Color");
          if (strokeColor) {
            var sc = strokeColor.value;
            return _makeResult(layer, "Stroke Color",
              "Contents." + group.name + ".Contents.Stroke 1.Color",
              "ADBE Vector Stroke Color", "color",
              sc ? [sc[0], sc[1], sc[2]] : [1,1,1], null);
          }
        }
      }
    }
  } catch(e) {}
  return null;
}

function _getLayerType(layer) {
  if (layer instanceof TextLayer) return "text";
  if (layer instanceof ShapeLayer) return "shape";
  if (layer instanceof CameraLayer) return "camera";
  if (layer instanceof LightLayer) return "light";
  if (layer instanceof AVLayer) {
    if (layer.source instanceof CompItem) return "precomp";
    if (layer.source && layer.source.mainSource) {
      if (layer.source.mainSource instanceof SolidSource) return "solid";
      return "footage";
    }
  }
  return "other";
}

function getAllLayers() {
  var comp = app.project.activeItem;
  if (!comp || !(comp instanceof CompItem)) {
    return JSON.stringify({ error: "No active composition" });
  }
  var layers = [];
  for (var i = 1; i <= comp.numLayers; i++) {
    var layer = comp.layer(i);
    layers.push({ index: i, name: layer.name, type: _getLayerType(layer), enabled: layer.enabled });
  }
  return JSON.stringify(layers);
}

function saveFrameAsThumbnail(outputPath) {
  var comp = app.project.activeItem;
  if (!comp || !(comp instanceof CompItem)) {
    return JSON.stringify({ error: "No active composition" });
  }

  var outFile = new File(outputPath);
  var folder = outFile.parent;
  if (!folder.exists) folder.create();

  try {
    comp.saveFrameToPng(comp.time, outFile);
    if (outFile.exists) return JSON.stringify({ success: true, path: outFile.fsName });
  } catch(e) {}

  try {
    while (app.project.renderQueue.numItems > 0) {
      app.project.renderQueue.item(app.project.renderQueue.numItems).remove();
    }
    var rqItem = app.project.renderQueue.items.add(comp);
    rqItem.timeSpanStart = comp.time;
    rqItem.timeSpanDuration = comp.frameDuration;
    var om = rqItem.outputModule(1);
    om.file = outFile;
    try { om.applyTemplate("PNG Sequence"); } catch(e2) {}
    app.project.renderQueue.render();
    while (app.project.renderQueue.numItems > 0) {
      app.project.renderQueue.item(app.project.renderQueue.numItems).remove();
    }

    if (outFile.exists) return JSON.stringify({ success: true, path: outFile.fsName });

    var baseName = outFile.name.replace(/\.[^.]+$/, "");
    var files = folder.getFiles(baseName + "*");
    if (files && files.length > 0) return JSON.stringify({ success: true, path: files[0].fsName });

    return JSON.stringify({ error: "Render done but file not found" });
  } catch(e3) {
    return JSON.stringify({ error: "Thumbnail failed: " + e3.toString() });
  }
}

function getProjectInfo() {
  var proj = app.project;
  if (!proj.file) return JSON.stringify({ error: "Project not saved. Save first." });
  return JSON.stringify({ path: proj.file.fsName, name: proj.file.name, saved: !proj.dirty });
}

function saveProject() {
  try { app.project.save(); return JSON.stringify({ success: true }); }
  catch(e) { return JSON.stringify({ error: "Save failed: " + e.toString() }); }
}

// ========================================
// Layer Switcher — Dropdown-driven opacity toggle
// Creates a controller null with a Dropdown Menu Control
// that toggles visibility of selected layers.
// The dropdown can be exposed in Essential Graphics for MOGRTs.
// ========================================
function createLayerSwitcher(switcherName) {
  app.beginUndoGroup("Create Layer Switcher");

  try {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) {
      return JSON.stringify({ error: "No active composition. Open a comp first." });
    }

    var selected = comp.selectedLayers;
    if (!selected || selected.length < 2) {
      return JSON.stringify({ error: "Select at least 2 layers to create a switcher." });
    }

    // Capture names as plain strings BEFORE modifying the layer stack.
    var layerNames = [];
    for (var i = 0; i < selected.length; i++) {
      layerNames.push(String(selected[i].name));
    }

    var ctrlName = switcherName || "Layer Switch";

    // Deselect all layers first (prevents addNull insertion quirks)
    for (var d = 1; d <= comp.numLayers; d++) {
      comp.layer(d).selected = false;
    }

    // Create controller null
    var ctrl = comp.layers.addNull();
    ctrl.name = "[CTRL] " + ctrlName;
    ctrl.label = 9;

    // Add Dropdown Menu Control effect
    var dropdownEffect = ctrl.property("ADBE Effect Parade").addProperty("ADBE Dropdown Control");
    dropdownEffect.name = ctrlName;

    var menuProp = dropdownEffect.property(1);
    try {
      menuProp.setPropertyParameters(layerNames);
    } catch(e) {}
    menuProp.setValue(1);

    var ctrlLayerName = ctrl.name.replace(/"/g, '\\"');
    var effectName = dropdownEffect.name.replace(/"/g, '\\"');

    // Find each target layer by name (robust against invalidated references)
    var matched = {};
    var appliedCount = 0;

    for (var j = 0; j < layerNames.length; j++) {
      var targetName = layerNames[j];
      var dropdownIndex = j + 1;
      var layer = null;

      for (var m = 1; m <= comp.numLayers; m++) {
        if (matched[m]) continue;
        if (m === ctrl.index) continue;
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

      try {
        layer.property("ADBE Transform Group").property("ADBE Opacity").expression = expr;
        appliedCount++;
      } catch(e1) {
        try { layer.transform.opacity.expression = expr; appliedCount++; } catch(e2) {}
      }
    }

    // Deselect all layers, select the controller
    for (var k = 1; k <= comp.numLayers; k++) {
      comp.layer(k).selected = false;
    }
    ctrl.selected = true;

    return JSON.stringify({
      success: true,
      controllerName: ctrl.name,
      effectName: dropdownEffect.name,
      layerCount: layers.length,
      layerNames: layerNames,
      hint: "Drag the '" + dropdownEffect.name + "' effect to Essential Graphics to include it in your MOGRT."
    });

  } catch(e) {
    return JSON.stringify({ error: "Layer Switcher failed: " + e.toString() });
  } finally {
    app.endUndoGroup();
  }
}

// ========================================
// List all compositions in the project
// ========================================
function getProjectCompositions() {
  var comps = [];
  for (var i = 1; i <= app.project.numItems; i++) {
    var item = app.project.item(i);
    if (item instanceof CompItem) {
      comps.push({
        name: item.name,
        width: item.width,
        height: item.height,
        fps: item.frameRate,
        duration: item.duration
      });
    }
  }
  return JSON.stringify(comps);
}

// Export as MOGRT - instructs user since this requires AE menu interaction
function getMogrtExportPath() {
  var proj = app.project;
  if (!proj.file) return JSON.stringify({ error: "Save the project first." });
  var projDir = proj.file.parent.fsName;
  var comp = app.project.activeItem;
  var compName = comp ? comp.name.replace(/[^a-zA-Z0-9_-]/g, "_") : "template";
  return JSON.stringify({ suggestedPath: projDir + "\\" + compName + ".mogrt" });
}

// Export MOGRT automatically (AE CC 2018+ / v15.1+)
function exportMogrt() {
  var comp = app.project.activeItem;
  if (!comp || !(comp instanceof CompItem)) {
    return JSON.stringify({ error: "No active composition" });
  }

  var proj = app.project;
  if (!proj.file) {
    return JSON.stringify({ error: "Save the AE project first (File > Save As)." });
  }

  try { proj.save(); } catch(es) {}

  if (typeof comp.exportAsMotionGraphicsTemplate !== "function") {
    return JSON.stringify({ error: "exportAsMotionGraphicsTemplate not available in this AE version." });
  }

  var compName = comp.name.replace(/[^a-zA-Z0-9_-]/g, "_") || "template";
  var outDir = proj.file.parent;
  var attempts = [];

  // Attempt 1: File object, overwrite=true
  try {
    var f1 = new File(outDir.absoluteURI + "/" + compName + ".mogrt");
    comp.exportAsMotionGraphicsTemplate(true, f1);
    if (f1.exists) return JSON.stringify({ success: true, path: f1.fsName });
    attempts.push("A1: no error but file missing");
  } catch(e1) { attempts.push("A1: " + e1.message); }

  // Attempt 2: String path instead of File object
  try {
    var p2 = outDir.fsName + "\\" + compName + ".mogrt";
    comp.exportAsMotionGraphicsTemplate(true, p2);
    var f2 = new File(p2);
    if (f2.exists) return JSON.stringify({ success: true, path: f2.fsName });
    attempts.push("A2: no error but file missing");
  } catch(e2) { attempts.push("A2: " + e2.message); }

  // Attempt 3: File on Desktop
  try {
    var f3 = new File(Folder.desktop.absoluteURI + "/" + compName + ".mogrt");
    comp.exportAsMotionGraphicsTemplate(true, f3);
    if (f3.exists) return JSON.stringify({ success: true, path: f3.fsName });
    attempts.push("A3: no error but file missing");
  } catch(e3) { attempts.push("A3: " + e3.message); }

  // Attempt 4: User picks location via save dialog
  try {
    var f4 = File.saveDialog("Save MOGRT", "MOGRT files:*.mogrt");
    if (f4) {
      comp.exportAsMotionGraphicsTemplate(true, f4);
      if (f4.exists) return JSON.stringify({ success: true, path: f4.fsName });
      attempts.push("A4: no error but file missing");
    } else {
      attempts.push("A4: user cancelled");
    }
  } catch(e4) { attempts.push("A4: " + e4.message); }

  return JSON.stringify({
    error: "MOGRT export failed after 4 attempts",
    debug: attempts.join(" | ")
  });
}
