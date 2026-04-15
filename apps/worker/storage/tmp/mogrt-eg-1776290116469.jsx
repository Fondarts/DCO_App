var _essentialParams = {"Vendor":2,"SCENE":3,"Layer Switch":3,"Find it in":"Find it in","99.99":"Just $1004d","NEW Civic Hatchback":"NEW Civic Hatchback"};
var _essentialComp = '__COMP_PLACEHOLDER__';
var _essentialMap = { composition: _essentialComp, essentialParameters: _essentialParams };
var _essential = { get: function(k) { return _essentialMap[k]; } };
(function () {
    var log = [];

    try {
        var compName = typeof _essential !== 'undefined' && _essential.get('composition') || 'Comp 1';
        var essentialParameters = typeof _essential !== 'undefined' && _essential.get('essentialParameters') || {};

        log.push("compName: " + compName);
        log.push("params: " + (function() { var k = []; for (var p in essentialParameters) k.push(p); return k.join(", "); })());

        // Find the composition
        var comp = null;
        for (var ci = 1; ci <= app.project.items.length; ci++) {
            var item = app.project.items[ci];
            if (item instanceof CompItem) {
                log.push("Comp[" + ci + "]: '" + item.name + "'");
                if (item.name === compName) comp = item;
            }
        }

        if (!comp) {
            log.push("ERROR: Comp '" + compName + "' not found!");
            throw new Error("Comp not found: " + compName);
        }
        log.push("Using comp: " + comp.name + " " + comp.width + "x" + comp.height + " layers=" + comp.numLayers);

        // Apply values directly to layers in the comp
        for (var i = 1; i <= comp.numLayers; i++) {
            var layer = comp.layer(i);
            var layerName = layer.name;

            // Check text layers
            if (layer instanceof TextLayer) {
                var paramVal = essentialParameters[layerName];
                if (typeof paramVal !== "undefined") {
                    try {
                        var srcText = layer.property("ADBE Text Properties").property("ADBE Text Document");
                        var td = srcText.value;
                        td.text = String(paramVal);
                        srcText.setValue(td);
                        log.push("OK text: " + layerName + " = " + String(paramVal).slice(0, 40));
                    } catch(e) {
                        log.push("FAIL text " + layerName + ": " + e.message);
                    }
                }
            }

            // Check effects (Expression Controls: Dropdown, Slider, Color, etc.)
            // Match by: effect name, layer name, or derived name from "[CTRL] X" layer pattern
            try {
                var effects = layer.property("ADBE Effect Parade");
                if (effects && effects.numProperties > 0) {
                    // Derive controller name from "[CTRL] X" layer naming convention
                    var derivedName = "";
                    if (layerName.indexOf("[CTRL] ") === 0) {
                        derivedName = layerName.substring(7);
                    }

                    for (var ef = 1; ef <= effects.numProperties; ef++) {
                        var effect = effects.property(ef);
                        var effectName = effect.name;

                        // Try matching: effect name, derived layer name, or layer name
                        var paramValue = essentialParameters[effectName];
                        if (typeof paramValue === "undefined" && derivedName) {
                            paramValue = essentialParameters[derivedName];
                        }
                        if (typeof paramValue === "undefined") {
                            paramValue = essentialParameters[layerName];
                        }

                        if (typeof paramValue === "undefined") continue;

                        // Set the first settable property of the effect
                        for (var ep = 1; ep <= effect.numProperties; ep++) {
                            var prop = effect.property(ep);
                            if (typeof prop.setValue !== "function") continue;
                            try {
                                prop.setValue(paramValue);
                                log.push("OK effect: " + layerName + "/" + effectName + " = " + String(paramValue).slice(0, 40));
                            } catch(e) {
                                log.push("FAIL effect " + effectName + ": " + e.message);
                            }
                            break;
                        }
                    }
                }
            } catch(e) {
                log.push("FAIL effects scan " + layerName + ": " + e.message);
            }
        }

    } catch(mainErr) {
        log.push("FATAL: " + mainErr.message + " line:" + (mainErr.line || "?"));
    }

    // Write log
    try {
        var logFile = new File(Folder.temp.fsName + "/dco_eg_log.txt");
        logFile.open("w");
        logFile.write(log.join("\n"));
        logFile.close();
    } catch(e) {}
})();
