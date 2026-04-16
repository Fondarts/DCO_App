/**
 * DCO Server Launcher
 * Starts all required services for remote rendering:
 *   1. Redis (job queue)
 *   2. Next.js web server (UI + API)
 *   3. Render worker (job processor)
 *
 * Also verifies After Effects and FFmpeg are available.
 *
 * Usage:
 *   node start-server.js
 *   (or double-click "DCO Server.bat")
 */

const { spawn, execSync } = require("child_process");
const { existsSync, readFileSync } = require("fs");
const path = require("path");
const os = require("os");

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const ROOT = __dirname;

const REDIS_PATHS = [
  "C:\\Program Files\\Redis\\redis-server.exe",
  "C:\\Redis\\redis-server.exe",
  path.join(process.env.LOCALAPPDATA || "", "Redis", "redis-server.exe"),
];

const AERENDER_PATHS = [
  "C:\\Program Files\\Adobe\\Adobe After Effects 2025\\Support Files\\aerender.exe",
  "C:\\Program Files\\Adobe\\Adobe After Effects 2026\\Support Files\\aerender.exe",
  "C:\\Program Files\\Adobe\\Adobe After Effects 2024\\Support Files\\aerender.exe",
  "C:\\Program Files\\Adobe\\Adobe After Effects (Beta)\\Support Files\\aerender.exe",
];

const FFMPEG_PATHS = [
  path.join(
    process.env.LOCALAPPDATA || "",
    "Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-8.0.1-full_build\\bin\\ffmpeg.exe"
  ),
];

// Console colors
const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  bgRed: "\x1b[41m",
  bgGreen: "\x1b[42m",
  bgBlue: "\x1b[44m",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(prefix, color, msg) {
  const ts = new Date().toLocaleTimeString("es-ES", { hour12: false });
  console.log(`${C.dim}${ts}${C.reset} ${color}${C.bold}[${prefix}]${C.reset} ${msg}`);
}

function banner(text) {
  const line = "=".repeat(60);
  console.log(`\n${C.cyan}${C.bold}${line}${C.reset}`);
  console.log(`${C.cyan}${C.bold}  ${text}${C.reset}`);
  console.log(`${C.cyan}${C.bold}${line}${C.reset}\n`);
}

function findBinary(envVar, paths) {
  const envPath = process.env[envVar];
  if (envPath && existsSync(envPath)) return envPath;
  for (const p of paths) {
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * Load .env file from apps/web/.env and return as object.
 * The worker needs these vars (especially REDIS_URL) to connect
 * to the same cloud Redis (Upstash) that Vercel uses.
 */
function loadDotEnv() {
  const envPath = path.join(ROOT, "apps", "web", ".env");
  const vars = {};
  if (!existsSync(envPath)) return vars;
  const lines = readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    // Remove surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    vars[key] = val;
  }
  return vars;
}

// ---------------------------------------------------------------------------
// Process management
// ---------------------------------------------------------------------------

const children = [];
let shuttingDown = false;

function spawnService(name, command, args, options, color) {
  const proc = spawn(command, args, {
    ...options,
    stdio: ["ignore", "pipe", "pipe"],
    shell: true,
  });

  children.push({ name, proc });

  proc.stdout.on("data", (data) => {
    const lines = data.toString().split("\n").filter((l) => l.trim());
    for (const line of lines) {
      log(name, color, line);
    }
  });

  proc.stderr.on("data", (data) => {
    const lines = data.toString().split("\n").filter((l) => l.trim());
    for (const line of lines) {
      log(name, C.red, line);
    }
  });

  proc.on("exit", (code) => {
    if (!shuttingDown) {
      log(name, code === 0 ? C.yellow : C.red, `Process exited with code ${code}`);
    }
  });

  return proc;
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log("");
  banner("Shutting down DCO Server...");

  for (const { name, proc } of children.reverse()) {
    try {
      log("SHUTDOWN", C.yellow, `Stopping ${name}...`);
      // On Windows, spawn taskkill to kill the process tree
      spawn("taskkill", ["/pid", proc.pid.toString(), "/T", "/F"], {
        stdio: "ignore",
        shell: true,
      });
    } catch {
      // ignore
    }
  }

  setTimeout(() => {
    log("SHUTDOWN", C.green, "All services stopped. Goodbye!");
    process.exit(0);
  }, 2000);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  banner("DCO Server Launcher");

  log("SYSTEM", C.cyan, `Platform: ${os.platform()} ${os.release()}`);
  log("SYSTEM", C.cyan, `Node.js: ${process.version}`);
  log("SYSTEM", C.cyan, `Working dir: ${ROOT}`);
  console.log("");

  // --- 1. Load .env ---
  const dotEnv = loadDotEnv();
  const redisUrl = dotEnv.REDIS_URL || process.env.REDIS_URL || "";
  const isCloudRedis = redisUrl.includes("upstash") || redisUrl.startsWith("rediss://");

  // --- 2. Check dependencies ---
  banner("Checking dependencies");

  // After Effects
  const aerender = findBinary("AERENDER_PATH", AERENDER_PATHS);
  if (aerender) {
    log("CHECK", C.green, `After Effects: ${aerender}`);
  } else {
    log("CHECK", C.red, "After Effects: NOT FOUND");
    log("CHECK", C.red, "  Renders will fail without aerender.exe!");
    log("CHECK", C.yellow, "  Set AERENDER_PATH env var or install Adobe After Effects.");
  }

  // FFmpeg
  const ffmpeg = findBinary("FFMPEG_PATH", FFMPEG_PATHS);
  if (ffmpeg) {
    log("CHECK", C.green, `FFmpeg: ${ffmpeg}`);
  } else {
    log("CHECK", C.red, "FFmpeg: NOT FOUND");
    log("CHECK", C.red, "  Video encoding will fail without ffmpeg.exe!");
    log("CHECK", C.yellow, "  Set FFMPEG_PATH or install FFmpeg via winget.");
  }

  // Redis
  if (isCloudRedis) {
    const host = redisUrl.replace(/^rediss?:\/\/[^@]*@/, "").replace(/:.*/, "");
    log("CHECK", C.green, `Redis: Cloud (${host})`);
  } else if (redisUrl) {
    log("CHECK", C.yellow, `Redis: ${redisUrl}`);
  } else {
    log("CHECK", C.red, "Redis: NOT CONFIGURED — set REDIS_URL in apps/web/.env");
  }

  // .env
  const envPath = path.join(ROOT, "apps", "web", ".env");
  if (existsSync(envPath)) {
    log("CHECK", C.green, `.env file: ${envPath}`);
  } else {
    log("CHECK", C.yellow, ".env file: NOT FOUND — using defaults");
  }

  console.log("");

  // --- 3. Start services ---
  banner("Starting services");

  // Build env for worker: inherit system env + .env vars
  const workerEnv = {
    ...process.env,
    ...dotEnv,
    FORCE_COLOR: "1",
    // Worker connects to the same cloud Redis as Vercel
    REDIS_URL: redisUrl,
    // Worker reports to local web server (shares Neon DB with Vercel)
    API_URL: dotEnv.API_URL || "http://localhost:3000",
    WORKER_API_KEY: dotEnv.WORKER_API_KEY || "worker-secret",
    STORAGE_ROOT: path.resolve(ROOT, "apps", "web", dotEnv.STORAGE_PATH || "./storage"),
    WORKER_WORKDIR: path.resolve(ROOT, "apps", "web", dotEnv.STORAGE_PATH || "./storage", "tmp", "nexrender"),
  };

  // Start web server (Next.js loads .env automatically)
  log("WEB", C.blue, "Starting Next.js web server (port 3000)...");
  spawnService(
    "WEB",
    "npm",
    ["run", "dev"],
    { cwd: ROOT, env: { ...process.env, FORCE_COLOR: "1" } },
    C.cyan
  );

  // Give the web server a head start
  await new Promise((r) => setTimeout(r, 3000));

  // Start worker with cloud Redis URL
  if (redisUrl) {
    log("WORKER", C.blue, "Starting render worker...");
    log("WORKER", C.blue, `  Redis: ${isCloudRedis ? "Cloud (Upstash)" : redisUrl}`);
    spawnService(
      "WORKER",
      "npm",
      ["run", "dev:worker"],
      { cwd: ROOT, env: workerEnv },
      C.green
    );
  } else {
    log("WORKER", C.red, "Skipping worker — no REDIS_URL configured.");
  }

  // --- 4. Summary ---
  console.log("");
  banner("DCO Server Running");

  const services = [
    redisUrl
      ? `${C.green}  [OK]${C.reset} Redis         → ${isCloudRedis ? "Cloud (Upstash)" : redisUrl}`
      : `${C.red}  [!!]${C.reset} Redis         → NOT CONFIGURED`,
    `${C.green}  [OK]${C.reset} Web Server    → http://localhost:3000`,
    redisUrl
      ? `${C.green}  [OK]${C.reset} Render Worker → listening on queue`
      : `${C.red}  [!!]${C.reset} Render Worker → not started`,
    aerender ? `${C.green}  [OK]${C.reset} After Effects → ready` : `${C.red}  [!!]${C.reset} After Effects → NOT FOUND`,
    ffmpeg ? `${C.green}  [OK]${C.reset} FFmpeg        → ready` : `${C.red}  [!!]${C.reset} FFmpeg        → NOT FOUND`,
  ];

  for (const s of services) {
    console.log(s);
  }

  console.log("");
  log("SYSTEM", C.cyan, "Press Ctrl+C to stop all services.");
  console.log("");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
