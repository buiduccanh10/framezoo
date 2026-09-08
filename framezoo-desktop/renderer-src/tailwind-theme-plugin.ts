import merge from "lodash.merge";
import plugin from "tailwindcss/plugin";

import { colorToRgbString } from "./src/utils/color";
import { allThemes } from "./themes/all";
import { defaultTheme } from "./themes/default";

type ThemeDefinition = {
  name: string;
  selectors?: string[];
  extend: {
    colors: Record<string, unknown>;
  };
};

function flattenValues(
  value: Record<string, unknown>,
  path: string[] = [],
): Array<[string, string]> {
  return Object.entries(value).flatMap(([key, nestedValue]) => {
    const nextPath = [...path, key];
    if (nestedValue && typeof nestedValue === "object") {
      return flattenValues(nestedValue as Record<string, unknown>, nextPath);
    }

    return [[nextPath.join("-"), String(nestedValue)]];
  });
}

function createThemeVariables(colors: Record<string, unknown>) {
  return Object.fromEntries(
    flattenValues(colors).map(([key, value]) => [
      `--colors-${key}`,
      colorToRgbString(value),
    ]),
  );
}

const themeDefinitions: ThemeDefinition[] = [
  {
    name: "__default",
    extend: defaultTheme.extend,
  },
  ...allThemes,
];

function createColorExtension(value: Record<string, unknown>, path: string[] = []) {
  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => {
      const nextPath = [...path, key];
      if (nestedValue && typeof nestedValue === "object") {
        return [key, createColorExtension(nestedValue as Record<string, unknown>, nextPath)];
      }

      return [
        key,
        `rgb(var(--colors-${nextPath.join("-")}) / <alpha-value>)`,
      ];
    }),
  );
}

const colorExtension = createColorExtension(defaultTheme.extend.colors);

export const framezooThemePlugin = plugin(
  ({ addBase, addVariant }) => {
    for (const theme of themeDefinitions) {
      const mergedColors = merge({}, defaultTheme.extend.colors, theme.extend.colors);
      const selectors = theme.selectors ?? [":root"];

      addBase({
        [selectors.join(", ")]: createThemeVariables(mergedColors),
      });

      if (theme.name !== "__default" && theme.selectors) {
        addVariant(
          theme.name,
          theme.selectors.flatMap(selector => [`${selector} &`, `&${selector}`]),
        );
      }
    }
  },
  {
    theme: {
      extend: {
        colors: colorExtension,
      },
    },
  },
);
