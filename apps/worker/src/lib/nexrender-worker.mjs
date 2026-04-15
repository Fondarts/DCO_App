// Standalone nexrender worker script
// Executed as a child process from the Next.js API
// Usage: node nexrender-worker.mjs <job-json-path> <output-path>

import { readFileSync, writeFileSync, existsSync } from "fs";
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
  console.log("[nexrender] Starting render...");
  console.log("[nexrender] Format:", isMogrt ? "MOGRT" : "AEP");
  console.log("[nexrender] Binary:", binary);
  console.log("[nexrender] Template:", jobData.template.src);
  console.log("[nexrender] Composition:", jobData.template.composition);

  const result = await render(jobData, {
    binary,
    workpath: jobData.workpath || "./storage/tmp/nexrender",
    skipCleanup: true,
    addLicense: false,
    debug: true,
  });

  console.log("[nexrender] Render complete. Output:", result.output);
  console.log("[nexrender] Template dest:", result.template?.dest);

  // For MOGRT, nexrender may not set result.output correctly.
  // The rendered file is result.mp4 in the workpath.
  let outputFile = result.output;
  if (!outputFile || !existsSync(outputFile)) {
    // Try to find the output in the workdir
    const workdir = result.workpath || jobData.workpath;
    const uid = result.uid;
    if (workdir && uid) {
      const candidates = ["output.mp4", "result.mp4", "result.avi"];
      const { readdirSync } = await import("fs");
      const dir = workdir + "/" + uid;
      try {
        const files = readdirSync(dir);
        console.log("[nexrender] Workdir files:", files.join(", "));
        // Check exact candidates first
        for (const c of candidates) {
          const p = dir + "/" + c;
          if (existsSync(p)) {
            outputFile = p;
            console.log("[nexrender] Found output at:", p);
            break;
          }
        }
        // If not found, look for PNG files (single-frame preview renders)
        if (!outputFile || !existsSync(outputFile)) {
          const pngFile = files.find(f => f.startsWith("result_") && f.endsWith(".png"));
          if (pngFile) {
            outputFile = dir + "/" + pngFile;
            console.log("[nexrender] Found PNG output at:", outputFile);
          }
        }
      } catch(e) {
        console.log("[nexrender] Could not read workdir:", e.message);
      }
    }
  }

  writeFileSync(resultPath, JSON.stringify({ output: outputFile }));
} catch (err) {
  console.error("[nexrender] Error:", err.message);
  writeFileSync(resultPath, JSON.stringify({ error: err.message }));
  process.exit(1);
}
