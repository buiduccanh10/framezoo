import { readFileSync, writeFileSync } from "node:fs";

import themesModule from "../../framezoo-desktop/renderer-src/themes/all.ts";
import defaultModule from "../../framezoo-desktop/renderer-src/themes/default.ts";
import colorModule from "../../framezoo-desktop/renderer-src/src/utils/color.ts";
import customModule from "../../framezoo-desktop/renderer-src/themes/custom.ts";

const { allThemes } = themesModule;
const { defaultTheme } = defaultModule;
const { colorToRgbString } = colorModule;
const { primaryOptions, secondaryOptions, tertiaryOptions } = customModule;

function merge(base, override) {
  return Object.fromEntries(Object.keys(base).map((key) => [
    key,
    typeof base[key] === "object" ? merge(base[key], override?.[key] ?? {}) : override?.[key] ?? base[key],
  ]));
}

function flatten(value, prefix = "") {
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
    const name = prefix ? `${prefix}.${key}` : key;
    if (typeof item === "object") return Object.entries(flatten(item, name));
    const rgb = colorToRgbString(item).split(" ").map(Number);
    if (rgb.length !== 3 || rgb.some((channel) => !Number.isInteger(channel) || channel < 0 || channel > 255)) {
      throw new Error(`Invalid color: ${name}=${item}`);
    }
    return [[name, `#${rgb.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`]];
  }));
}

const themes = Object.fromEntries([
  ["default", defaultTheme],
  ...allThemes.map((theme) => [theme.name, theme]),
].map(([name, theme]) => [name, flatten(merge(defaultTheme.extend.colors, theme.extend.colors))]));

const customParts = Object.fromEntries([
  ["primary", primaryOptions], ["secondary", secondaryOptions], ["tertiary", tertiaryOptions],
].map(([name, options]) => [name, Object.keys(options[0].colors).map((key) => key.slice("--colors-".length).replaceAll("-", "."))]));
const labels = JSON.parse(readFileSync(new URL("../../framezoo-desktop/renderer-src/src/assets/locales/vi.json", import.meta.url), "utf8"))
  .settings.appearance.themes;
for (const name of [...Object.keys(themes), "custom"]) {
  if (!labels[name]) throw new Error(`Thiếu nhãn theme: ${name}`);
}
const outputs = [
  [new URL("../app/src/main/assets/themes.json", import.meta.url), `${JSON.stringify(themes, null, 2)}\n`],
  [new URL("../app/src/main/assets/custom-parts.json", import.meta.url), `${JSON.stringify(customParts, null, 2)}\n`],
];
if (process.argv.includes("--check")) {
  for (const [output, json] of outputs) {
    if (readFileSync(output, "utf8") !== json) throw new Error(`${output.pathname} khác token của framezoo-desktop`);
  }
} else {
  for (const [output, json] of outputs) writeFileSync(output, json);
}
