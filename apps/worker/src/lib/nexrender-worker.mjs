// Standalone nexrender worker script
// Executed as a child process from the render engine
// Usage: node nexrender-worker.mjs <job-json-path> <output-path>

import { readFileSync, writeFileSync, existsSync, readdirSync, copyFileSync, mkdirSync } from "fs";
import path from "path";
import { init, render } from "@nexrender/core";

const jobPath = process.argv[2];
const resultPath = process.argv[3];

if (!jobPath || !resultPath) {
  console.error("Usage: node nexrender-worker.mjs <job-json-path> <result-path>");
  process.exit(1);
}

const jobData = JSON.parse(readFileSync(jobPath, "utf-8"));

// Find aerender — prefer env var, then auto-detect
const aerenderPaths = [
  process.env.AERENDER_PATH,
  "C:\\Program Files\\Adobe\\Adobe After Effects 2025\\Support Files\\aerender.exe",
  "C:\\Program Files\\Adobe\\Adobe After Effects 2026\\Support Files\\aerender.exe",
  "C:\\Program Files\\Adobe\\Adobe After Effects 2024\\Support Files\\aerender.exe",
  "C:\\Program Files\\Adobe\\Adobe After Effects (Beta)\\Support Files\\aerender.exe",
].filter(Boolean);

let binary = null;
for (const p of aerenderPaths) {
  if (existsSync(p)) { binary = p; break; }
}

if (!binary) {
  writeFileSync(resultPath, JSON.stringify({ error: "aerender.exe not found. Set AERENDER_PATH env var." }));
  process.exit(1);
}

try {
  const isMogrt = jobData.template.src.endsWith(".mogrt");
  const workpath = jobData.workpath || "./storage/tmp/nexrender";

  console.log("[nexrender] Starting render...");
  console.log("[nexrender] Format:", isMogrt ? "MOGRT" : "AEP");
  console.log("[nexrender] Binary:", binary);
  console.log("[nexrender] Template:", jobData.template.src);
  console.log("[nexrender] Composition:", jobData.template.composition);
  console.log("[nexrender] OutputExt:", jobData.template.outputExt || "avi");
  console.log("[nexrender] FrameStart:", jobData.template.frameStart, "FrameEnd:", jobData.template.frameEnd);

  const result = await render(jobData, {
    binary,
    workpath,
    skipCleanup: true, // We handle cleanup ourselves
    addLicense: false,
    debug: true,
  });

  console.log("[nexrender] Render complete. Output:", result.output);
  console.log("[nexrender] UID:", result.uid);

  let outputFile = null;

  // Search the workdir for the output file
  const workdir = path.join(workpath, result.uid);
  if (existsSync(workdir)) {
    const files = readdirSync(workdir);
    console.log("[nexrender] Workdir files:", files.join(", "));

    // Priority: PNG sequence > MP4 > AVI
    const pngFile = files.find(f => f.startsWith("result_") && f.endsWith(".png"));
    const mp4File = files.find(f => f === "output.mp4" || f === "result.mp4");
    const aviFile = files.find(f => f === "result.avi");
    const anyPng = files.find(f => f.endsWith(".png") && !f.includes("script"));

    const found = pngFile || mp4File || aviFile || anyPng;
    if (found) {
      // Copy to a safe location outside the workdir
      const safeName = "output-" + result.uid + path.extname(found);
      const safePath = path.join(workpath, safeName);
      copyFileSync(path.join(workdir, found), safePath);
      outputFile = safePath;
      console.log("[nexrender] Saved output to:", safePath);
    }
  } else {
    console.log("[nexrender] Workdir not found:", workdir);
    // Try result.output directly
    if (result.output && existsSync(result.output)) {
      outputFile = result.output;
    }
  }

  if (!outputFile) {
    throw new Error("Render completed but no output file found in: " + workdir);
  }

  writeFileSync(resultPath, JSON.stringify({ output: outputFile }));
} catch (err) {
  console.error("[nexrender] Error:", err.message);
  writeFileSync(resultPath, JSON.stringify({ error: err.message }));
  process.exit(1);
}
