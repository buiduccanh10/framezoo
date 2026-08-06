import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = resolve(fileURLToPath(new URL(".", import.meta.url)));
const iconSourcePath = resolve(
  scriptDirectory,
  "../../framezoo-desktop/renderer-src/src/components/Icon.tsx",
);
const logoOutputPath = resolve(
  scriptDirectory,
  "../public/framezoo-logo.svg",
);

const iconSource = readFileSync(iconSourcePath, "utf8");
const logoMatch = iconSource.match(/\n  logo: `([\s\S]*?)\n`,\n  discord:/);

if (!logoMatch) {
  throw new Error(`Icons.LOGO was not found in ${iconSourcePath}`);
}

writeFileSync(logoOutputPath, `${logoMatch[1]}\n`);
