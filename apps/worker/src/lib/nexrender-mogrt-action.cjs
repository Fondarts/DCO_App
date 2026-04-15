/**
 * Local nexrender action: replaces nexrender-action-mogrt-template
 * Uses adm-zip instead of the 'mogrt' npm package (which can't read AE Beta .mogrt files).
 *
 * Phase 1 (predownload): Injects essential parameters script, re-registers as prerender.
 * Phase 2 (prerender): Extracts .aep from .mogrt into job workdir, sets template.dest.
 */
const fs = require("fs");
const path = require("path");
const AdmZip = require("adm-zip");

// Path to our JSX that applies essential values
const EG_JSX_PATH = path.resolve(__dirname, "mogrt-apply-essential.jsx");

module.exports = (job, settings, action, type) => {
  if (type === "predownload") {
    return Promise.resolve(predownload(job, settings, action));
  }
  if (type === "prerender" && action.automaticallyAdded) {
    return Promise.resolve(prerender(job, settings, action));
  }
  return Promise.resolve(job);
};

function predownload(job, settings, action) {
  const essentialParameters = action.essentialParameters || {};

  // Read the JSX template
  let jsxBody = "";
  if (fs.existsSync(EG_JSX_PATH)) {
    jsxBody = fs.readFileSync(EG_JSX_PATH, "utf-8");
  } else {
    console.log("[mogrt-action] WARNING: mogrt-apply-essential.jsx not found at", EG_JSX_PATH);
  }

  // Build preamble that sets _essential map (composition will be injected in prerender)
  const paramsJson = JSON.stringify(essentialParameters);
  const preamble = [
    "var _essentialParams = " + paramsJson + ";",
    "var _essentialComp = '__COMP_PLACEHOLDER__';",
    "var _essentialMap = { composition: _essentialComp, essentialParameters: _essentialParams };",
    "var _essential = { get: function(k) { return _essentialMap[k]; } };",
  ].join("\n");

  // Write script to a temp file and reference it
  const scriptContent = preamble + "\n" + jsxBody;
  const tmpDir = path.resolve("storage/tmp");
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const scriptPath = path.join(tmpDir, "mogrt-eg-" + Date.now() + ".jsx");
  fs.writeFileSync(scriptPath, scriptContent);

  const scriptUrl = "file:///" + scriptPath.replace(/\\/g, "/").replace(/ /g, "%20");
  console.log("[mogrt-action] Script written to:", scriptPath);

  // Add script as asset
  job.assets.push({
    type: "script",
    src: scriptUrl,
  });

  // Re-register as prerender to extract .aep later
  if (!job.actions.prerender) job.actions.prerender = [];
  job.actions.prerender.push({
    module: action.module || __filename,
    automaticallyAdded: true,
  });

  // Will be updated with real comp name in prerender
  job.template.composition = "__temp_mogrt__";

  return job;
}

function prerender(job, settings, action) {
  const templateSrc = job.template.dest || job.template.src;
  if (!templateSrc) {
    console.log("[mogrt-action] No template source found");
    return job;
  }

  // Resolve the actual file path
  let mogrtPath = templateSrc;
  if (mogrtPath.startsWith("file:///")) {
    mogrtPath = decodeURIComponent(mogrtPath.replace("file:///", ""));
  }

  if (!mogrtPath.endsWith(".mogrt") || !fs.existsSync(mogrtPath)) {
    console.log("[mogrt-action] Not a .mogrt or file not found:", mogrtPath);
    return job;
  }

  console.log("[mogrt-action] Extracting MOGRT:", mogrtPath);

  // Step 1: Open outer ZIP (.mogrt)
  const outerZip = new AdmZip(mogrtPath);
  const workdir = path.dirname(mogrtPath);

  // Step 2: Read definition.json for comp name
  let compName = "Comp 1";
  try {
    const defBuf = outerZip.readFile("definition.json");
    if (defBuf) {
      const def = JSON.parse(defBuf.toString());
      const sourceInfo = def.sourceInfoLocalized && def.sourceInfoLocalized.en_US;
      if (sourceInfo && sourceInfo.name) compName = sourceInfo.name;
    }
  } catch (e) {
    console.log("[mogrt-action] Could not read definition.json:", e.message);
  }

  console.log("[mogrt-action] Composition name:", compName);

  // Step 3: Extract project.aegraphic (inner ZIP)
  const aegraphicEntry = outerZip.getEntry("project.aegraphic");
  if (aegraphicEntry) {
    const aegraphicData = outerZip.readFile(aegraphicEntry);
    const innerZip = new AdmZip(aegraphicData);
    innerZip.extractAllTo(workdir, true);
    console.log("[mogrt-action] Extracted project.aegraphic to", workdir);
  } else {
    // No inner ZIP — extract everything from outer
    outerZip.extractAllTo(workdir, true);
  }

  // Step 4: Find the .aep file and rename to safe name (no spaces/parens)
  const files = fs.readdirSync(workdir);
  const aepFile = files.find((f) => f.endsWith(".aep"));
  if (!aepFile) {
    console.log("[mogrt-action] ERROR: No .aep found in extracted files:", files);
    return job;
  }

  // Rename to a clean filename (aerender can choke on spaces/parens)
  const safeAepName = "template.aep";
  const origPath = path.join(workdir, aepFile);
  const aepPath = path.join(workdir, safeAepName);
  if (origPath !== aepPath) {
    fs.renameSync(origPath, aepPath);
    console.log("[mogrt-action] Renamed", aepFile, "->", safeAepName);
  }
  console.log("[mogrt-action] AEP:", aepPath);

  // Step 5: Replace template with extracted .aep and set real comp name
  job.template.dest = aepPath;
  job.template.extension = "aep";
  job.template.composition = compName;
  console.log("[mogrt-action] Set composition to:", compName);

  // Step 6: Inject comp name into ALL scripts in the workdir that have the placeholder
  const allFiles = fs.readdirSync(workdir);
  for (const f of allFiles) {
    if (f.endsWith(".jsx") || f.endsWith(".txt")) {
      const fullPath = path.join(workdir, f);
      try {
        let content = fs.readFileSync(fullPath, "utf-8");
        if (content.includes("__COMP_PLACEHOLDER__")) {
          content = content.replace(
            /__COMP_PLACEHOLDER__/g,
            compName.replace(/'/g, "\\'")
          );
          fs.writeFileSync(fullPath, content);
          console.log("[mogrt-action] Updated", f, "with comp name:", compName);
        }
      } catch (e) {
        // Skip binary files
      }
    }
  }

  return job;
}
