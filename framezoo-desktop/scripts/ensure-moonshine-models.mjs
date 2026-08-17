import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  loadMoonshineModule,
  ModelArch,
  modelArchToString,
} from "@moonshine-ai/moonshine-wasm";

const desktopRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const publicRoot = path.join(desktopRoot, "renderer-src", "public");
const modelRoot = path.join(publicRoot, "moonshine", "models");
const catalogPath = path.join(publicRoot, "moonshine", "catalog.json");
const runtimeRoot = path.join(publicRoot, "moonshine", "runtime");

const languages = ["en", "es", "zh", "ja", "ko", "vi", "uk", "ar"];
const bundledLanguages = new Set(["en", "ko"]);
const architectures = [
  { name: "tiny", value: ModelArch.Tiny },
  { name: "base", value: ModelArch.Base },
];

async function readExistingAsset(filePath, expectedSize) {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile() && stat.size === expectedSize;
  } catch {
    return false;
  }
}

async function downloadAsset(url, filePath, expectedSize) {
  if (await readExistingAsset(filePath, expectedSize)) return;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Moonshine model download failed: ${response.status} ${response.statusText} ${url}`,
    );
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength !== expectedSize) {
    throw new Error(
      `Moonshine model size mismatch for ${url}: expected ${expectedSize}, got ${bytes.byteLength}`,
    );
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, bytes);
}

async function main() {
  const packageRoot = await fs.realpath(
    path.join(
      desktopRoot,
      "node_modules",
      "@moonshine-ai",
      "moonshine-wasm",
    ),
  );
  await fs.rm(runtimeRoot, { recursive: true, force: true });
  await fs.cp(path.join(packageRoot, "dist"), runtimeRoot, {
    recursive: true,
  });

  const module = await loadMoonshineModule();
  const catalog = {
    version: 1,
    generatedAt: new Date().toISOString(),
    unsupportedLanguages: [],
    unsupportedByArchitecture: {},
    models: {},
  };

  for (const architecture of architectures) {
    const architectureName = modelArchToString(architecture.value);
    catalog.models[architectureName] = {};
    catalog.unsupportedByArchitecture[architectureName] = [];

    for (const language of languages) {
      let manifest;
      try {
        manifest = JSON.parse(
          module.sttDependencies(
            language,
            String(architecture.value),
            false,
          ),
        );
      } catch {
        if (
          !catalog.unsupportedByArchitecture[architectureName].includes(
            language,
          )
        ) {
          catalog.unsupportedByArchitecture[architectureName].push(language);
        }
        continue;
      }
      const files = manifest.groups?.flatMap((group) => group.files ?? []) ?? [];

      if (files.length === 0) {
        catalog.unsupportedByArchitecture[architectureName].push(language);
        continue;
      }

      catalog.models[architectureName][language] = {
        language,
        architecture: architectureName,
        bundled:
          architectureName === "tiny" && bundledLanguages.has(language),
        files: files.map((file) => ({
          name: file.name,
          url: file.url,
          size: file.size,
          checksum: file.checksum ?? null,
          checksumType: file.checksum_type ?? null,
        })),
      };

      if (
        architectureName === "tiny" &&
        bundledLanguages.has(language)
      ) {
        for (const file of files) {
          await downloadAsset(
            file.url,
            path.join(modelRoot, architectureName, language, file.name),
            file.size,
          );
        }
      }
    }
  }

  catalog.unsupportedLanguages = languages.filter(
    (language) =>
      !architectures.some(({ name }) => catalog.models[name][language]),
  );
  await fs.mkdir(path.dirname(catalogPath), { recursive: true });
  await fs.writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
  console.log(
    `[moonshine] catalog ready: ${catalogPath} (bundled: ${[
      ...bundledLanguages,
    ].join(", ")})`,
  );
}

main().catch((error) => {
  console.error(
    `[moonshine] model preparation failed: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  process.exitCode = 1;
});
