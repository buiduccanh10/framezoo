#!/usr/bin/env node

import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const LANDING_DIR = path.join(ROOT, "src/landing");
const LOCALES_DIR = path.join(LANDING_DIR, "locales");
const EN_FILE = path.join(LOCALES_DIR, "en.json");
const MANIFEST_FILE = path.join(LANDING_DIR, "locale-manifest.json");

const PLACEHOLDER_RE = /(\{\{[^{}]+\}\}|<[^>]+>)/g;
const WORD_RE = /[A-Za-z]{3,}/;
const URL_RE = /^https?:\/\/\S+$/;
const MAX_CONCURRENCY = 6;

function parseArgs(argv) {
  const args = { command: "audit", locale: null, write: false, force: false };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "audit" || arg === "translate") args.command = arg;
    else if (arg === "--write") args.write = true;
    else if (arg === "--force") args.force = true;
    else if (arg.startsWith("--locale="))
      args.locale = arg.slice("--locale=".length);
    else if (arg === "--locale" && argv[index + 1]) {
      args.locale = argv[index + 1];
      index += 1;
    }
  }

  return args;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function flattenLeaves(value, prefix = "", output = new Map()) {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      flattenLeaves(item, `${prefix}.${index}`, output),
    );
    return output;
  }

  if (isObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      const next = prefix ? `${prefix}.${key}` : key;
      flattenLeaves(item, next, output);
    }
    return output;
  }

  output.set(prefix, value);
  return output;
}

function getByPath(value, keyPath) {
  let current = value;
  for (const part of keyPath.split(".")) {
    if (!isObject(current) && !Array.isArray(current)) return undefined;
    current = current[part];
  }
  return current;
}

function setByPath(value, keyPath, nextValue) {
  const parts = keyPath.split(".");
  let current = value;

  for (let index = 0; index < parts.length - 1; index += 1) {
    const part = parts[index];
    const nextPart = parts[index + 1];
    if (!current[part]) current[part] = /^\d+$/.test(nextPart) ? [] : {};
    current = current[part];
  }

  current[parts.at(-1)] = nextValue;
}

function cloneSchema(value) {
  if (Array.isArray(value)) return value.map((item) => cloneSchema(item));
  if (isObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, cloneSchema(item)]),
    );
  }
  return value;
}

function shouldTranslate(value) {
  if (typeof value !== "string") return false;
  const text = value.trim();
  if (!text || URL_RE.test(text)) return false;
  return WORD_RE.test(text);
}

function maskPlaceholders(value) {
  const placeholders = [];
  const masked = value.replace(PLACEHOLDER_RE, (placeholder) => {
    const token = `__PH_${placeholders.length}__`;
    placeholders.push([token, placeholder]);
    return token;
  });
  return { masked, placeholders };
}

function restorePlaceholders(value, placeholders) {
  return placeholders.reduce(
    (output, [token, placeholder]) => output.replaceAll(token, placeholder),
    value,
  );
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

async function readOrCreateLocale(file, schema) {
  if (!fsSync.existsSync(file)) return cloneSchema(schema);
  return readJson(file);
}

async function translateText(source, targetLanguage) {
  const url = new URL("https://translate.googleapis.com/translate_a/single");
  url.searchParams.set("client", "gtx");
  url.searchParams.set("sl", "en");
  url.searchParams.set("tl", targetLanguage);
  url.searchParams.set("dt", "t");
  url.searchParams.set("q", source);

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const translated =
        data?.[0]?.map((segment) => segment?.[0] ?? "").join("") ?? "";
      if (translated) return translated;
    } catch (error) {
      if (attempt === 3) {
        console.error(`Translation failed: ${error.message}`);
      } else {
        await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
      }
    }
  }

  return null;
}

async function mapWithConcurrency(items, worker) {
  let nextIndex = 0;
  const results = new Array(items.length);

  async function runWorker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(MAX_CONCURRENCY, items.length) },
      () => runWorker(),
    ),
  );
  return results;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [manifest, enJson] = await Promise.all([
    readJson(MANIFEST_FILE),
    readJson(EN_FILE),
  ]);
  const enLeaves = flattenLeaves(enJson);
  const selected = manifest.filter(
    (locale) => !args.locale || locale.id === args.locale,
  );

  if (selected.length === 0) {
    throw new Error(`Unknown landing locale: ${args.locale}`);
  }

  if (args.command === "audit") {
    console.log("locale\ttranslated\ttotal\tmissing_file");
    for (const locale of selected) {
      const file = path.join(LOCALES_DIR, `${locale.file}.json`);
      const missingFile = !fsSync.existsSync(file);
      const localeJson = missingFile ? {} : await readJson(file);
      const localeLeaves = flattenLeaves(localeJson);
      let translated = 0;

      for (const [key, source] of enLeaves) {
        const value = localeLeaves.get(key);
        if (typeof source === "string" && value && value !== source) {
          translated += 1;
        }
      }

      console.log(
        `${locale.id}\t${translated}\t${enLeaves.size}\t${missingFile}`,
      );
    }
    return;
  }

  if (!args.write) {
    console.log("Dry run. Add --write to update locale files.");
  }

  for (const locale of selected) {
    if (locale.id === "en") continue;

    const file = path.join(LOCALES_DIR, `${locale.file}.json`);
    const localeJson = await readOrCreateLocale(file, enJson);
    const localeLeaves = flattenLeaves(localeJson);
    const candidates = [];

    for (const [key, source] of enLeaves) {
      if (typeof source !== "string" || !shouldTranslate(source)) continue;
      const current = localeLeaves.get(key);
      if (args.force || typeof current !== "string" || current === source) {
        candidates.push([key, source]);
      }
    }

    console.log(
      `${locale.id}: translating ${candidates.length}/${enLeaves.size} keys`,
    );
    await mapWithConcurrency(candidates, async ([key, source]) => {
      const { masked, placeholders } = maskPlaceholders(source);
      const translated = await translateText(masked, locale.google);
      if (translated) {
        setByPath(
          localeJson,
          key,
          restorePlaceholders(translated, placeholders),
        );
      }
    });

    if (args.write) {
      await fs.writeFile(
        file,
        `${JSON.stringify(localeJson, null, 2)}\n`,
        "utf8",
      );
      console.log(`${locale.id}: saved ${path.relative(ROOT, file)}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
