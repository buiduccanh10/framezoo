#!/usr/bin/env node

import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const LOCALES_DIR = fsSync.existsSync(
  path.join(ROOT, "renderer-src/src/assets/locales"),
)
  ? path.join(ROOT, "renderer-src/src/assets/locales")
  : path.join(ROOT, "src/assets/locales");
const EN_FILE = path.join(LOCALES_DIR, "en.json");

const PLACEHOLDER_RE = /(\{\{[^{}]+\}\}|<[^>]+>)/g;
const WORD_RE = /[A-Za-z]{3,}/;
const URL_RE = /^https?:\/\/\S+$/;

const SKIP_EXACT = new Set(["https://", "2x", ">ᴗ<"]);
const SKIP_LOCALES = new Set([
  "en",
  "futhark",
  "kitty",
  "minion",
  "nv",
  "pirate",
  "tok",
  "umb",
  "uwu",
]);

const GOOGLE_LANG_MAP = {
  "ca@valencia": "ca",
  "de-CH": "de",
  "fi-FI": "fi",
  he: "iw",
  "pt-BR": "pt",
  "pt-PT": "pt",
  ur_PK: "ur",
  "zh-Hant": "zh-TW",
  zh: "zh-CN",
};

function parseArgs(argv) {
  const args = { cmd: "audit", locale: null, write: false, forceKeys: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "audit" || arg === "translate") args.cmd = arg;
    else if (arg.startsWith("--locale="))
      args.locale = arg.slice("--locale=".length);
    else if (arg.startsWith("--force-keys="))
      args.forceKeys = arg
        .slice("--force-keys=".length)
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean);
    else if (arg === "--force-keys") {
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        args.forceKeys = next
          .split(",")
          .map((k) => k.trim())
          .filter(Boolean);
        i++;
      }
    } else if (arg === "--write") args.write = true;
  }
  return args;
}

function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function flattenLeaves(obj, prefix = "", out = new Map()) {
  if (Array.isArray(obj)) {
    obj.forEach((v, idx) => flattenLeaves(v, `${prefix}.${idx}`, out));
    return out;
  }
  if (isObject(obj)) {
    for (const [k, v] of Object.entries(obj)) {
      const next = prefix ? `${prefix}.${k}` : k;
      flattenLeaves(v, next, out);
    }
    return out;
  }
  out.set(prefix, obj);
  return out;
}

function getByPath(obj, keyPath) {
  const parts = keyPath.split(".");
  let cur = obj;
  for (const p of parts) {
    if (Array.isArray(cur)) {
      const i = Number(p);
      if (Number.isNaN(i) || i >= cur.length) return undefined;
      cur = cur[i];
      continue;
    }
    if (!isObject(cur) || !(p in cur)) return undefined;
    cur = cur[p];
  }
  return cur;
}

function setByPath(obj, keyPath, value) {
  const parts = keyPath.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const p = parts[i];
    const next = parts[i + 1];
    if (Array.isArray(cur)) {
      const idx = Number(p);
      if (!cur[idx]) cur[idx] = Number.isNaN(Number(next)) ? {} : [];
      cur = cur[idx];
      continue;
    }
    if (!(p in cur)) cur[p] = Number.isNaN(Number(next)) ? {} : [];
    cur = cur[p];
  }
  const last = parts.at(-1);
  if (Array.isArray(cur)) cur[Number(last)] = value;
  else cur[last] = value;
}

function shouldTranslate(text) {
  if (typeof text !== "string") return false;
  const t = text.trim();
  if (!t || SKIP_EXACT.has(t)) return false;
  if (URL_RE.test(t)) return false;
  if (t.startsWith("/") && !t.includes(" ")) return false;
  return WORD_RE.test(t);
}

function maskPlaceholders(text) {
  const saved = [];
  const masked = text.replace(PLACEHOLDER_RE, (m) => {
    const token = `__PH_${saved.length}__`;
    saved.push([token, m]);
    return token;
  });
  return { masked, saved };
}

function unmaskPlaceholders(text, saved) {
  let out = text;
  for (const [token, raw] of saved) out = out.replaceAll(token, raw);
  return out;
}

async function translateText(source, targetLang) {
  const url = new URL("https://translate.googleapis.com/translate_a/single");
  url.searchParams.set("client", "gtx");
  url.searchParams.set("sl", "en");
  url.searchParams.set("tl", targetLang);
  url.searchParams.set("dt", "t");
  url.searchParams.set("q", source);

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const translated = data?.[0]?.map((x) => x?.[0] ?? "").join("") ?? "";
      if (translated) return translated;
    } catch {
      if (attempt < 3)
        await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  return null;
}

function localeToGoogle(locale) {
  return GOOGLE_LANG_MAP[locale] ?? locale;
}

function normalizeLocaleFromFile(file) {
  return file.replace(/\.json$/, "");
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function buildSchemaOnlyFromEn(enObj) {
  if (Array.isArray(enObj))
    return enObj.map((x) => buildSchemaOnlyFromEn(x));
  if (isObject(enObj)) {
    const out = {};
    for (const [k, v] of Object.entries(enObj))
      out[k] = buildSchemaOnlyFromEn(v);
    return out;
  }
  return enObj;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const enJson = await readJson(EN_FILE);
  const enLeaves = flattenLeaves(enJson);
  const files = (await fs.readdir(LOCALES_DIR))
    .filter((f) => f.endsWith(".json"))
    .sort((a, b) => a.localeCompare(b));

  const pickedFiles = files.filter((f) => {
    const locale = normalizeLocaleFromFile(f);
    return args.locale ? locale === args.locale : true;
  });

  if (!pickedFiles.length) {
    console.log("No locale files matched.");
    process.exit(0);
  }

  if (args.cmd === "audit") {
    console.log("locale\tsame_as_en\ttotal_leaf_keys");
    for (const file of pickedFiles) {
      const locale = normalizeLocaleFromFile(file);
      if (locale === "en") continue;
      const localeJson = await readJson(path.join(LOCALES_DIR, file));
      const leaves = flattenLeaves(localeJson);
      let sameAsEn = 0;
      for (const [k, enVal] of enLeaves.entries()) {
        const v = leaves.get(k);
        if (
          typeof v === "string" &&
          typeof enVal === "string" &&
          v === enVal
        ) {
          sameAsEn += 1;
        }
      }
      console.log(`${locale}\t${sameAsEn}\t${enLeaves.size}`);
    }
    return;
  }

  let localeIndex = 0;
  for (const file of pickedFiles) {
    const locale = normalizeLocaleFromFile(file);
    if (locale === "en") continue;

    localeIndex += 1;
    const localePath = path.join(LOCALES_DIR, file);
    const rawLocale = await readJson(localePath);
    const localeJson = buildSchemaOnlyFromEn(enJson);

    for (const [k] of enLeaves.entries()) {
      const existing = getByPath(rawLocale, k);
      if (existing !== undefined) setByPath(localeJson, k, existing);
    }

    if (SKIP_LOCALES.has(locale)) {
      console.log(
        `[${localeIndex}/${pickedFiles.length}] ${locale}: skipped (custom locale)`,
      );
      continue;
    }

    const targetLang = localeToGoogle(locale);
    const leaves = flattenLeaves(localeJson);
    const candidates = [];

    for (const [k, enVal] of enLeaves.entries()) {
      const forceTranslate = args.forceKeys.includes(k);
      const cur = leaves.get(k);

      if (typeof enVal !== "string") continue;

      if (forceTranslate) {
        if (!shouldTranslate(enVal)) continue;
        candidates.push([k, enVal]);
        continue;
      }

      if (typeof cur !== "string") continue;
      if (cur !== enVal) continue;
      if (!shouldTranslate(cur)) continue;
      candidates.push([k, cur]);
    }

    console.log(
      `[${localeIndex}/${pickedFiles.length}] ${locale}: ${candidates.length} keys to translate`,
    );

    let done = 0;
    for (const [k, source] of candidates) {
      const { masked, saved } = maskPlaceholders(source);
      const translated = await translateText(masked, targetLang);

      if (translated !== null) {
        const restored = unmaskPlaceholders(translated, saved);
        setByPath(localeJson, k, restored);
      } else {
        console.error(`  - Failed to translate ${k} for ${locale}`);
      }

      done += 1;
      const percent = Math.round((done / candidates.length) * 100);
      if (done % 25 === 0 || done === candidates.length) {
        console.log(`  - ${locale}: ${done}/${candidates.length} (${percent}%)`);
      }

      // Sleep to avoid rate limit
      await new Promise((r) => setTimeout(r, 1000));
    }

    if (args.write) {
      await fs.writeFile(
        localePath,
        `${JSON.stringify(localeJson, null, 2)}\n`,
        "utf8",
      );
      console.log(`  saved: ${file}`);
    } else {
      console.log(`  dry-run: ${file} not written (use --write)`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
