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

  const { readdirSync } = await import("fs");
  let outputFile = result.output;

  // Resolve PNG sequence pattern (result_[#####].png → result_00015.png)
  if (outputFile && outputFile.includes("[#####]")) {
    const dir = outputFile.substring(0, outputFile.lastIndexOf("/") === -1 ? outputFile.lastIndexOf("\\") : outputFile.lastIndexOf("/"));
    const parentDir = dir || (result.workpath || jobData.workpath) + "/" + result.uid;
    try {
      const files = readdirSync(parentDir);
      const pngFile = files.find(f => f.startsWith("result_") && f.endsWith(".png"));
      if (pngFile) {
        outputFile = parentDir + "/" + pngFile;
        console.log("[nexrender] Resolved PNG pattern to:", outputFile);
      }
    } catch(e) {
      console.log("[nexrender] Could not resolve PNG pattern:", e.message);
    }
  }

  // If output still not found, search workdir
  if (!outputFile || !existsSync(outputFile)) {
    const workdir = result.workpath || jobData.workpath;
    const uid = result.uid;
    if (workdir && uid) {
      const candidates = ["output.mp4", "result.mp4", "result.avi"];
      const dir = workdir + "/" + uid;
      try {
        const files = readdirSync(dir);
        console.log("[nexrender] Workdir files:", files.join(", "));
        for (const c of candidates) {
          const p = dir + "/" + c;
          if (existsSync(p)) {
            outputFile = p;
            console.log("[nexrender] Found output at:", p);
            break;
          }
        }
        // Look for any PNG
        if (!outputFile || !existsSync(outputFile)) {
          const pngFile = files.find(f => f.endsWith(".png"));
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
