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

// Find aerender
const aerenderPaths = [
  "C:\\Program Files\\Adobe\\Adobe After Effects 2025\\Support Files\\aerender.exe",
  "C:\\Program Files\\Adobe\\Adobe After Effects 2026\\Support Files\\aerender.exe",
  "C:\\Program Files\\Adobe\\Adobe After Effects 2024\\Support Files\\aerender.exe",
];

let binary = null;
for (const p of aerenderPaths) {
  if (existsSync(p)) { binary = p; break; }
}

if (!binary) {
  writeFileSync(resultPath, JSON.stringify({ error: "aerender.exe not found" }));
  process.exit(1);
}

try {
  console.log("[nexrender] Starting render...");
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
  writeFileSync(resultPath, JSON.stringify({ output: result.output }));
} catch (err) {
  console.error("[nexrender] Error:", err.message);
  writeFileSync(resultPath, JSON.stringify({ error: err.message }));
  process.exit(1);
}
