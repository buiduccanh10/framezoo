import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const publicModelsDir = path.join(desktopRoot, "renderer-src", "public", "models");
const vadModelPath = path.join(publicModelsDir, "silero_vad.onnx");
const SILERO_VAD_URL =
  "https://github.com/snakers4/silero-vad/raw/master/src/silero_vad/data/silero_vad.onnx";

async function main() {
  await fs.mkdir(publicModelsDir, { recursive: true });
  try {
    const stat = await fs.stat(vadModelPath);
    if (stat.isFile() && stat.size > 100_000) {
      console.log(`[vad] Silero VAD model verified: ${vadModelPath} (${stat.size} bytes)`);
      return;
    }
  } catch {
    // File doesn't exist, proceed to download
  }

  console.log(`[vad] Downloading Silero VAD ONNX model from ${SILERO_VAD_URL}...`);
  const response = await fetch(SILERO_VAD_URL);
  if (!response.ok) {
    throw new Error(`Failed to download Silero VAD model: ${response.status} ${response.statusText}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(vadModelPath, buffer);
  console.log(`[vad] Silero VAD model saved: ${vadModelPath} (${buffer.byteLength} bytes)`);
}

main().catch((err) => {
  console.error("[vad] Failed to ensure Silero VAD model:", err);
  process.exitCode = 1;
});
