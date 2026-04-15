import { init } from "@nexrender/core";
try {
  init({
    binary: "C:\Program Files\Adobe\Adobe After Effects (Beta)\Support Files\aerender.exe",
    workpath: "./storage/tmp/nexrender",
  });
  console.log("Patch installed successfully!");
} catch(e) {
  console.error("Error:", e.message);
}
