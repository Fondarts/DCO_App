// DCO Panel - Main Logic
var cs;
var fields = [];
var thumbnailPath = "";
var mogrtPath = "";
var templateMode = "mogrt"; // "mogrt" or "aep"
var serverUrl = "http://localhost:3000";

// --- Init ---
document.addEventListener("DOMContentLoaded", function() {
  cs = new CSInterface();
  loadCompositionInfo();

  // Mode toggle
  document.getElementById("mode-mogrt").addEventListener("click", function() { setMode("mogrt"); });
  document.getElementById("mode-aep").addEventListener("click", function() { setMode("aep"); });

  // MOGRT buttons
  document.getElementById("btn-scan-eg").addEventListener("click", scanEssentialGraphics);
  document.getElementById("btn-browse-mogrt").addEventListener("click", browseMogrt);

  // AEP buttons
  document.getElementById("btn-add-property").addEventListener("click", addSelectedProperty);
  document.getElementById("btn-add-layer").addEventListener("click", addSelectedLayer);

  // Common buttons
  document.getElementById("btn-thumbnail").addEventListener("click", generateThumbnail);
  document.getElementById("btn-send").addEventListener("click", sendToDCO);
  document.getElementById("btn-refresh").addEventListener("click", loadCompositionInfo);
  document.getElementById("server-url").value = serverUrl;
  document.getElementById("server-url").addEventListener("change", function() {
    serverUrl = this.value;
  });
  // Submenu toggle
  document.getElementById("submenu-tools-toggle").addEventListener("click", function() {
    var panel = document.getElementById("submenu-tools");
    var arrow = document.getElementById("submenu-tools-arrow");
    if (panel.style.display === "none") {
      panel.style.display = "block";
      arrow.innerHTML = "&#9652;";
    } else {
      panel.style.display = "none";
      arrow.innerHTML = "&#9662;";
    }
  });

  // Detect compositions for output variants
  document.getElementById("btn-detect-comps").addEventListener("click", function() {
    cs.evalScript("getProjectCompositions()", function(result) {
      try {
        var comps = JSON.parse(result);
        if (!Array.isArray(comps) || comps.length === 0) {
          document.getElementById("detected-comps").textContent = "No compositions found";
          return;
        }
        var names = [];
        for (var i = 0; i < comps.length; i++) {
          names.push(comps[i].name + " (" + comps[i].width + "x" + comps[i].height + ")");
        }
        document.getElementById("detected-comps").textContent = "Comps: " + names.join(", ");

        // Try to auto-fill based on aspect ratio matching
        for (var j = 0; j < comps.length; j++) {
          var c = comps[j];
          var ratio = c.width / c.height;
          if (Math.abs(ratio - 16/9) < 0.05 && !document.getElementById("ov-landscape-comp").value) {
            document.getElementById("ov-landscape-comp").value = c.name;
          } else if (Math.abs(ratio - 1) < 0.05 && !document.getElementById("ov-square-comp").value) {
            document.getElementById("ov-square-comp").value = c.name;
          } else if (Math.abs(ratio - 9/16) < 0.05 && !document.getElementById("ov-vertical-comp").value) {
            document.getElementById("ov-vertical-comp").value = c.name;
          }
        }
      } catch(e) {
        document.getElementById("detected-comps").textContent = "Error: " + e.message;
      }
    });
  });

  // Layer Switcher tool
  document.getElementById("btn-layer-switcher").addEventListener("click", function() {
    var name = prompt("Switcher name (e.g. 'Background', 'Logo Variant'):", "Layer Switch");
    if (!name) return;
    setStatus("Creating layer switcher...");
    cs.evalScript('createLayerSwitcher("' + name.replace(/"/g, '\\"') + '")', function(result) {
      try {
        var data = JSON.parse(result);
        if (data.error) {
          setStatus("Error: " + data.error, true);
        } else {
          setStatus("Layer Switcher created! " + data.layerCount + " layers linked. Drag '" + data.effectName + "' to Essential Graphics.");
        }
      } catch(e) {
        setStatus("Error: " + result, true);
      }
    });
  });

  document.getElementById("btn-copy-debug").addEventListener("click", function() {
    var text = document.getElementById("debug-output").textContent;
    if (!text) { setStatus("No debug output to copy"); return; }
    // CEP clipboard via CSInterface
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setStatus("Debug output copied to clipboard!");
    } catch(e) {
      setStatus("Copy failed: " + e.message, true);
    }
  });

  document.getElementById("btn-debug").addEventListener("click", function() {
    cs.evalScript("debugSelectedProperties()", function(result) {
      try {
        var data = JSON.parse(result);
        document.getElementById("debug-output").textContent = data.debug || data.error || result;
      } catch(e) {
        document.getElementById("debug-output").textContent = result;
      }
    });
  });

  setMode("mogrt");
});

// --- Mode Toggle ---
function setMode(mode) {
  templateMode = mode;
  document.getElementById("mode-mogrt").className = mode === "mogrt" ? "btn btn-primary btn-small" : "btn btn-small";
  document.getElementById("mode-aep").className = mode === "aep" ? "btn btn-primary btn-small" : "btn btn-small";
  document.getElementById("mogrt-controls").style.display = mode === "mogrt" ? "block" : "none";
  document.getElementById("aep-controls").style.display = mode === "aep" ? "block" : "none";
  // Clear fields when switching mode
  fields = [];
  renderFields();
}

// --- Composition Info ---
function loadCompositionInfo() {
  cs.evalScript("getActiveComposition()", function(result) {
    var data = JSON.parse(result);
    if (data.error) {
      document.getElementById("comp-info").innerHTML = '<span class="error">' + data.error + "</span>";
      return;
    }
    document.getElementById("comp-info").innerHTML =
      "<strong>" + data.name + "</strong><br>" +
      data.width + "x" + data.height + " | " + data.fps + "fps | " + data.duration.toFixed(1) + "s";
    document.getElementById("template-name").value = data.name;
  });
}

// --- MOGRT: Scan Essential Graphics ---
function reloadJSX(callback) {
  var jsxPath = cs.getSystemPath("extension") + "/jsx/hostscript.jsx";
  cs.evalScript('$.evalFile("' + jsxPath.replace(/\\/g, "\\\\") + '")', callback);
}

function scanEssentialGraphics() {
  setStatus("Reloading scripts & scanning...");
  reloadJSX(function() {
    cs.evalScript("getEssentialGraphicsParameters()", function(result) {
    document.getElementById("debug-output").textContent = "EG RAW: " + result;

    var data;
    try { data = JSON.parse(result); } catch(e) {
      setStatus("Parse error: " + e.message, true);
      return;
    }

    if (data.error) {
      setStatus(data.error, true);
      if (data.debug) {
        document.getElementById("debug-output").textContent += "\nDEBUG: " + data.debug;
      }
      return;
    }

    // Handle both array format and {params: [...], debug: "..."} format
    var paramList = Array.isArray(data) ? data : (data.params || []);
    if (data.debug) {
      document.getElementById("debug-output").textContent += "\nDEBUG: " + data.debug;
    }

    if (paramList.length === 0) {
      setStatus("No parameters found", true);
      return;
    }

    fields = [];
    for (var i = 0; i < paramList.length; i++) {
      var param = paramList[i];
      if (!param || !param.parameterName) continue;

      var fieldObj = {
        parameterName: param.parameterName,
        layerName: param.layerName || "",
        layerIndex: 0,
        propertyName: param.parameterName,
        propertyPath: "",
        fieldType: param.fieldType,
        defaultValue: param.defaultValue,
        label: param.label || param.parameterName,
        validation: null,
        composition: ""
      };
      if (param.choices && param.choices.length > 0) {
        fieldObj.choices = param.choices;
      }
      fields.push(fieldObj);
    }

    renderFields();
    setStatus("Found " + fields.length + " Essential Graphics parameters");
  });
  }); // reloadJSX callback
}

// --- MOGRT: Browse for .mogrt file ---
function browseMogrt() {
  cs.evalScript("getMogrtExportPath()", function(result) {
    try {
      var data = JSON.parse(result);
      if (data.error) {
        setStatus(data.error, true);
        return;
      }
      // Show suggested path and let user input the actual path
      var path = prompt(
        "Enter the path to your .mogrt file.\n\nSuggested location:\n" + data.suggestedPath +
        "\n\n(Export from AE: File > Export > Motion Graphics Template)",
        data.suggestedPath
      );
      if (path) {
        mogrtPath = path;
        document.getElementById("mogrt-path-display").textContent = path.split(/[/\\]/).pop();
        setStatus("MOGRT file set: " + path.split(/[/\\]/).pop());
      }
    } catch(e) {
      setStatus("Error: " + e.message, true);
    }
  });
}

// --- AEP: Add Selected Property ---
function addSelectedProperty() {
  setStatus("Reading selected property...");
  cs.evalScript("getSelectedProperties()", function(result) {
    document.getElementById("debug-output").textContent = "RAW: " + result;

    var data;
    try { data = JSON.parse(result); } catch(e) {
      setStatus("Parse error: " + e.message, true);
      return;
    }

    if (data.error) {
      setStatus(data.error, true);
      return;
    }

    if (!Array.isArray(data)) {
      setStatus("Unexpected response: " + typeof data, true);
      return;
    }

    cs.evalScript("getActiveComposition()", function(compResult) {
      var compInfo = {};
      try { compInfo = JSON.parse(compResult); } catch(e) {}
      var compName = compInfo.name || "";

      var addedCount = 0;
      for (var i = 0; i < data.length; i++) {
        var prop = data[i];
        if (!prop || !prop.layerName) continue;

        var exists = false;
        for (var j = 0; j < fields.length; j++) {
          if (fields[j].layerName === prop.layerName && fields[j].propertyPath === prop.propertyPath) {
            exists = true;
            break;
          }
        }
        if (exists) continue;

        var label = prop.label || prop.propertyName;
        if ((prop.fieldType === "image" || prop.fieldType === "video" || prop.fieldType === "audio") && label === "Source") {
          label = prop.layerName;
        }

        fields.push({
          layerName: prop.layerName,
          layerIndex: prop.layerIndex,
          propertyName: prop.propertyName,
          propertyPath: prop.propertyPath,
          fieldType: prop.fieldType,
          defaultValue: prop.defaultValue,
          label: label,
          validation: prop.validation || null,
          composition: compName,
          parameterName: ""
        });
        addedCount++;
      }

      renderFields();
      setStatus(addedCount > 0 ? "Added " + addedCount + " (total: " + fields.length + ")" : "Nothing new added");
    });
  });
}

function addSelectedLayer() {
  addSelectedProperty();
}

// --- Render Field List ---
function renderFields() {
  var container = document.getElementById("fields-list");
  if (fields.length === 0) {
    container.innerHTML = '<div class="empty">No fields added yet.</div>';
    return;
  }

  var html = "";
  for (var i = 0; i < fields.length; i++) {
    var f = fields[i];
    var typeIcon = { text: "T", color: "C", image: "I", video: "V", audio: "A", slider: "#", point: "P", checkbox: "B", dropdown: "D", font: "F" }[f.fieldType] || "?";
    var typeClass = "type-" + f.fieldType;

    html += '<div class="field-item">' +
      '<div class="field-header">' +
        '<span class="field-type ' + typeClass + '">' + typeIcon + '</span>' +
        '<input type="text" class="field-label-input" value="' + escapeHtml(f.label) + '" onchange="updateLabel(' + i + ', this.value)" />' +
        '<button class="btn-remove" onclick="removeField(' + i + ')">×</button>' +
      '</div>';

    // Show dropdown choices
    if (f.fieldType === "dropdown" && f.choices && f.choices.length > 0) {
      var choiceTexts = [];
      for (var ci = 0; ci < f.choices.length; ci++) {
        choiceTexts.push(escapeHtml(f.choices[ci]));
      }
      html += '<div class="field-choices">' + choiceTexts.join(' &middot; ') + '</div>';
    }

    // In AEP mode, show layer and property path
    if (templateMode === "aep" && f.layerName) {
      var detailText = f.layerName;
      if (f.propertyPath) detailText += ' &rsaquo; ' + f.propertyPath;
      if (f.composition) detailText += ' (' + f.composition + ')';
      html += '<div class="field-detail">' + escapeHtml(detailText) + '</div>';
    }

    html += '</div>';
  }
  container.innerHTML = html;
}

function removeField(index) {
  fields.splice(index, 1);
  renderFields();
}

function updateLabel(index, value) {
  fields[index].label = value;
}

// --- Generate Thumbnail ---
function generateThumbnail() {
  setStatus("Generating thumbnail...");

  cs.evalScript("getProjectInfo()", function(projResult) {
    var projInfo = JSON.parse(projResult);
    if (projInfo.error) {
      setStatus(projInfo.error, true);
      return;
    }

    var projDir = projInfo.path.replace(/\\/g, "/").replace(/\/[^/]+$/, "");
    var thumbPath = projDir + "/dco_thumbnail.png";

    cs.evalScript('saveFrameAsThumbnail("' + thumbPath + '")', function(result) {
      try {
        var data = JSON.parse(result);
        if (data.error) {
          setStatus(data.error, true);
          return;
        }
        thumbnailPath = data.path;
        document.getElementById("thumbnail-preview").innerHTML =
          '<img src="file:///' + thumbnailPath.replace(/\\/g, "/") + '?t=' + Date.now() + '" />';
        setStatus("Thumbnail generated!");
      } catch(e) {
        setStatus("Thumbnail error: " + result, true);
      }
    });
  });
}

// --- Send to DCO ---
function sendToDCO() {
  if (fields.length === 0) {
    setStatus("Add at least one editable field first.", true);
    return;
  }

  setStatus("Preparing upload...");

  // If MOGRT mode and no .mogrt selected, export automatically
  if (templateMode === "mogrt" && !mogrtPath) {
    setStatus("Exporting main .mogrt...");
    cs.evalScript("exportMogrt()", function(exportResult) {
      var exportData;
      try { exportData = JSON.parse(exportResult); } catch(e) {
        setStatus("MOGRT export parse error: " + e.message, true);
        return;
      }
      if (exportData.error) {
        setStatus(exportData.error, true);
        if (exportData.debug) {
          document.getElementById("debug-output").textContent = "EXPORT DEBUG: " + exportData.debug;
        }
        return;
      }
      mogrtPath = exportData.path;
      document.getElementById("mogrt-path-display").textContent = mogrtPath.split(/[/\\]/).pop();

      // Export variant MOGRTs, then generate thumbnails for all comps
      _exportVariantMogrts(function() {
        _generateAllThumbnails(function() {
          setStatus("All MOGRTs & thumbnails ready, uploading...");
          _doSendToDCO();
        });
      });
    });
    return;
  }

  // If MOGRT already selected, still export variants + thumbnails
  if (templateMode === "mogrt") {
    _exportVariantMogrts(function() {
      _generateAllThumbnails(function() {
        _doSendToDCO();
      });
    });
    return;
  }

  _doSendToDCO();
}

// variantThumbnails: { "main": path, "landscape": path, "square": path, "vertical": path }
var variantThumbnails = {};

function _generateAllThumbnails(callback) {
  variantThumbnails = {};

  // Collect all comps that need thumbnails: main + variants
  var compsToCapture = [];

  // Main comp (active)
  compsToCapture.push({ id: "main", comp: document.getElementById("template-name").value || "main" });

  // Variant comps
  if (document.getElementById("ov-landscape").checked) {
    var lComp = document.getElementById("ov-landscape-comp").value.trim();
    if (lComp) compsToCapture.push({ id: "landscape", comp: lComp });
  }
  if (document.getElementById("ov-square").checked) {
    var sComp = document.getElementById("ov-square-comp").value.trim();
    if (sComp) compsToCapture.push({ id: "square", comp: sComp });
  }
  if (document.getElementById("ov-vertical").checked) {
    var vComp = document.getElementById("ov-vertical-comp").value.trim();
    if (vComp) compsToCapture.push({ id: "vertical", comp: vComp });
  }

  cs.evalScript("getProjectInfo()", function(projResult) {
    var projInfo;
    try { projInfo = JSON.parse(projResult); } catch(e) { callback(); return; }
    if (projInfo.error) { callback(); return; }

    var projDir = projInfo.path.replace(/\\/g, "/").replace(/\/[^/]+$/, "");
    var idx = 0;

    function captureNext() {
      if (idx >= compsToCapture.length) {
        callback();
        return;
      }
      var item = compsToCapture[idx];
      var thumbPath = projDir + "/dco_thumb_" + item.id + ".png";
      setStatus("Capturing thumbnail: " + item.comp + "...");

      // For main, use active comp; for variants, use saveFrameForComp
      var script;
      if (item.id === "main") {
        script = 'saveFrameAsThumbnail("' + thumbPath.replace(/"/g, '\\"') + '")';
      } else {
        script = 'saveFrameForComp("' + item.comp.replace(/"/g, '\\"') + '","' + thumbPath.replace(/"/g, '\\"') + '")';
      }

      cs.evalScript(script, function(result) {
        try {
          var data = JSON.parse(result);
          if (data.success && data.path) {
            variantThumbnails[item.id] = data.path;
          }
        } catch(e) {}
        idx++;
        captureNext();
      });
    }
    captureNext();
  });
}

// variantMogrtPaths: { variantId: localPath }
var variantMogrtPaths = {};

function _exportVariantMogrts(callback) {
  variantMogrtPaths = {};

  // Collect output variants that have a composition name
  var variantsToExport = [];
  if (document.getElementById("ov-landscape").checked) {
    var lComp = document.getElementById("ov-landscape-comp").value.trim();
    if (lComp) variantsToExport.push({ id: "landscape", comp: lComp });
  }
  if (document.getElementById("ov-square").checked) {
    var sComp = document.getElementById("ov-square-comp").value.trim();
    if (sComp) variantsToExport.push({ id: "square", comp: sComp });
  }
  if (document.getElementById("ov-vertical").checked) {
    var vComp = document.getElementById("ov-vertical-comp").value.trim();
    if (vComp) variantsToExport.push({ id: "vertical", comp: vComp });
  }

  if (variantsToExport.length === 0) {
    callback();
    return;
  }

  var idx = 0;
  function exportNext() {
    if (idx >= variantsToExport.length) {
      callback();
      return;
    }
    var v = variantsToExport[idx];
    setStatus("Exporting MOGRT for " + v.comp + "...");
    document.getElementById("debug-output").textContent += "\nExporting variant MOGRT: " + v.id + " comp=" + v.comp;
    cs.evalScript('exportMogrtForComp("' + v.comp.replace(/"/g, '\\"') + '")', function(result) {
      document.getElementById("debug-output").textContent += "\nResult for " + v.id + ": " + result;
      try {
        var data = JSON.parse(result);
        if (data.success && data.path) {
          variantMogrtPaths[v.id] = data.path;
          setStatus("Exported: " + v.comp + " -> " + data.path.split(/[/\\]/).pop());
        } else {
          setStatus("Warning: " + (data.error || "export failed for " + v.comp));
        }
      } catch(e) {
        setStatus("Warning: variant export parse error for " + v.comp);
      }
      idx++;
      exportNext();
    });
  }
  exportNext();
}

function _doSendToDCO() {
  cs.evalScript("getProjectInfo()", function(result) {
    var projInfo = JSON.parse(result);
    if (projInfo.error && templateMode === "aep") {
      setStatus(projInfo.error, true);
      return;
    }

    cs.evalScript("saveProject()", function() {
      cs.evalScript("getActiveComposition()", function(compResult) {
        var comp = JSON.parse(compResult);
        if (comp.error) { setStatus(comp.error, true); return; }

        var templateName = document.getElementById("template-name").value || comp.name;
        var manifest = buildManifest(comp, templateName);

        if (templateMode === "mogrt") {
          uploadMogrtToDCO(templateName, manifest);
        } else {
          uploadAepToDCO(templateName, manifest, projInfo.path);
        }
      });
    });
  });
}

function buildManifest(comp, name) {
  var manifestFields = [];
  var usedIds = {};

  for (var i = 0; i < fields.length; i++) {
    var f = fields[i];
    var baseId = f.label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "field_" + i;

    var id = baseId;
    if (usedIds[id]) {
      var counter = 2;
      while (usedIds[id + "_" + counter]) counter++;
      id = id + "_" + counter;
    }
    usedIds[id] = true;

    var fieldDef = {
      id: id,
      type: f.fieldType,
      label: f.label,
      "default": f.defaultValue,
      validation: f.validation || null
    };

    if (f.choices && f.choices.length > 0) {
      fieldDef.choices = f.choices;
    }

    if (templateMode === "mogrt") {
      // MOGRT: use Essential Graphics parameter name
      fieldDef.parameterName = f.parameterName || f.label;
      // Only include layerName for media fields
      if (f.fieldType === "image" || f.fieldType === "video" || f.fieldType === "audio") {
        fieldDef.layerName = f.layerName;
      }
    } else {
      // AEP: layer-based targeting
      fieldDef.layerName = f.layerName;
      fieldDef.layerIndex = f.layerIndex;

      var fieldComp = (f.composition && f.composition !== comp.name) ? f.composition : undefined;
      if (fieldComp) fieldDef.composition = fieldComp;

      var nexrenderAsset = { type: "data", property: f.propertyPath };
      if (f.fieldType === "image") {
        nexrenderAsset = { type: "image" };
      } else if (f.fieldType === "video") {
        nexrenderAsset = { type: "footage" };
      } else if (f.fieldType === "audio") {
        nexrenderAsset = { type: "audio" };
      } else if (f.fieldType === "text") {
        nexrenderAsset = { type: "data", property: "Source Text" };
      }
      fieldDef.nexrenderAsset = nexrenderAsset;

      if (!fieldDef.validation) {
        if (f.fieldType === "text") fieldDef.validation = { maxLength: 200 };
        else if (f.fieldType === "image") fieldDef.validation = { formats: ["jpg", "png", "webp"] };
        else if (f.fieldType === "video") fieldDef.validation = { formats: ["mp4", "mov"], maxDuration: 30 };
      }
    }

    manifestFields.push(fieldDef);
  }

  var outputVariants = [];
  if (document.getElementById("ov-landscape").checked) {
    var ov = { id: "landscape", width: 1920, height: 1080, label: "16:9 Landscape" };
    var lComp = document.getElementById("ov-landscape-comp").value.trim();
    if (lComp) ov.composition = lComp;
    outputVariants.push(ov);
  }
  if (document.getElementById("ov-square").checked) {
    var ov2 = { id: "square", width: 1080, height: 1080, label: "1:1 Square" };
    var sComp = document.getElementById("ov-square-comp").value.trim();
    if (sComp) ov2.composition = sComp;
    outputVariants.push(ov2);
  }
  if (document.getElementById("ov-vertical").checked) {
    var ov3 = { id: "vertical", width: 1080, height: 1920, label: "9:16 Vertical" };
    var vComp = document.getElementById("ov-vertical-comp").value.trim();
    if (vComp) ov3.composition = vComp;
    outputVariants.push(ov3);
  }

  return {
    templateId: "",
    name: name,
    format: templateMode,
    composition: comp.name,
    outputModule: "H.264 - Match Render Settings",
    outputExt: "mp4",
    duration: comp.duration,
    fps: comp.fps,
    width: comp.width,
    height: comp.height,
    fields: manifestFields,
    scenes: [],
    outputVariants: outputVariants
  };
}

// --- MOGRT Upload ---
function uploadMogrtToDCO(templateName, manifest) {
  setStatus("Uploading template...");

  // Send local file path — server copies directly from disk (avoids binary upload corruption)
  var formData = new FormData();
  formData.append("name", templateName);
  formData.append("manifest", JSON.stringify(manifest));
  formData.append("localFilePath", mogrtPath);

  // Send variant MOGRT paths
  var variantKeys = Object.keys(variantMogrtPaths);
  if (variantKeys.length > 0) {
    formData.append("variantMogrtPaths", JSON.stringify(variantMogrtPaths));
  }

  // Send variant thumbnails
  if (Object.keys(variantThumbnails).length > 0) {
    formData.append("variantThumbnails", JSON.stringify(variantThumbnails));
  }

  // Read and attach all thumbnail files as blobs
  var thumbIds = Object.keys(variantThumbnails);
  var thumbIdx = 0;

  function attachNextThumb() {
    if (thumbIdx >= thumbIds.length) {
      doUpload(formData);
      return;
    }
    var tid = thumbIds[thumbIdx];
    var tpath = variantThumbnails[tid];
    readFileAsBlob(tpath, function(terr, tbuf) {
      if (!terr && tbuf) {
        formData.append("thumb_" + tid, new Blob([tbuf], { type: "image/png" }), "thumb_" + tid + ".png");
      }
      thumbIdx++;
      attachNextThumb();
    });
  }

  attachNextThumb();
}

// --- AEP Upload ---
function uploadAepToDCO(templateName, manifest, aepPath) {
  setStatus("Reading project file...");

  var aepFileName = aepPath.replace(/\\/g, "/").split("/").pop();

  readFileAsBlob(aepPath, function(err, aepArrayBuffer) {
    if (err) {
      setStatus("Error reading AEP: " + err.message, true);
      return;
    }

    setStatus("Read " + Math.round(aepArrayBuffer.byteLength / 1024) + "KB. Uploading...");

    var aepBlob = new Blob([aepArrayBuffer], { type: "application/octet-stream" });

    var formData = new FormData();
    formData.append("name", templateName);
    formData.append("manifest", JSON.stringify(manifest));
    formData.append("templateFile", aepBlob, aepFileName);

    if (thumbnailPath) {
      readFileAsBlob(thumbnailPath, function(terr, thumbBuffer) {
        if (!terr && thumbBuffer) {
          formData.append("thumbnail", new Blob([thumbBuffer], { type: "image/png" }), "thumbnail.png");
        }
        doUpload(formData);
      });
      return;
    }

    doUpload(formData);
  });
}

function readFileAsBlob(filePath, callback) {
  var xhr = new XMLHttpRequest();
  // Encode the file path properly to handle spaces and special characters
  var fileUrl = "file:///" + encodeURI(filePath.replace(/\\/g, "/")).replace(/#/g, "%23");
  xhr.open("GET", fileUrl, true);
  xhr.responseType = "arraybuffer";
  xhr.onload = function() {
    if (xhr.response && xhr.response.byteLength > 0) {
      callback(null, xhr.response);
    } else {
      callback(new Error("Empty response reading file"));
    }
  };
  xhr.onerror = function() { callback(new Error("XHR error reading file")); };
  xhr.send();
}

function doUpload(formData) {
  setStatus("Uploading to DCO...");

  var url = serverUrl + "/api/templates";
  var xhr = new XMLHttpRequest();
  xhr.open("POST", url, true);
  xhr.setRequestHeader("X-DCO-Panel", "true");

  xhr.onload = function() {
    if (xhr.status === 201) {
      var response = JSON.parse(xhr.responseText);
      setStatus("Uploaded! Template: " + response.id.slice(0, 8));
      document.getElementById("thumbnail-preview").innerHTML = "";
      fields = [];
      mogrtPath = "";
      document.getElementById("mogrt-path-display").textContent = "No file selected";
      renderFields();
    } else {
      var errMsg = "Upload failed: " + xhr.status;
      try { errMsg = JSON.parse(xhr.responseText).error || errMsg; } catch(e) {}
      setStatus(errMsg, true);
    }
  };

  xhr.onerror = function() {
    setStatus("Connection failed. Is DCO running at " + serverUrl + "?", true);
  };

  xhr.send(formData);
}

// --- Helpers ---
function setStatus(msg, isError) {
  var el = document.getElementById("status");
  el.textContent = msg;
  el.className = isError ? "status error" : "status";
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
