import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import importPlugin from "eslint-plugin-import";
import prettierPlugin from "eslint-plugin-prettier/recommended";

const configDir = dirname(fileURLToPath(import.meta.url));

export default tseslint.config(
  // Global ignores (replaces ignorePatterns)
  {
    ignores: [
      "public/**",
      "dist/**",
      "scripts/**",
      "*.js",
      "*.cjs",
      "*.ts",
      "*.mts",
      "*.mjs",
      "plugins/**",
      "themes/**",
      "eslint.config.mjs",
    ],
  },

  // Base configs
  eslint.configs.recommended,
  ...tseslint.configs.recommended,

  // Prettier (must be after other configs to override formatting rules)
  prettierPlugin,

  // TypeScript parser options for all TS/TSX files
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: configDir,
      },
    },
    settings: {
      "import/resolver": {
        typescript: {
          project: "./tsconfig.json",
        },
      },
      react: {
        version: "detect",
      },
    },
  },

  // React
  {
    plugins: {
      react: reactPlugin,
      "react-hooks": reactHooksPlugin,
    },
    rules: {
      ...reactPlugin.configs.recommended.rules,
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "react/jsx-uses-react": "off",
      "react/react-in-jsx-scope": "off",
      "react/require-default-props": "off",
      "react/destructuring-assignment": "off",
      "react/jsx-props-no-spreading": "off",
      "react/display-name": "off",
      "react/prop-types": "off",
      "react/jsx-key": "warn",
      "react/jsx-filename-extension": [
        "error",
        { extensions: [".js", ".tsx", ".jsx"] },
      ],
    },
  },

  // Import plugin
  {
    plugins: {
      import: importPlugin,
    },
    rules: {
      "import/prefer-default-export": "off",
      "import/no-unresolved": ["error", { ignore: ["^virtual:"] }],
      "import/extensions": [
        "error",
        "ignorePackages",
        { ts: "never", tsx: "never" },
      ],
      "import/order": [
        "error",
        {
          groups: [
            "builtin",
            "external",
            "internal",
            ["sibling", "parent"],
            "index",
            "unknown",
          ],
          "newlines-between": "always",
          alphabetize: { order: "asc", caseInsensitive: true },
        },
      ],
    },
  },

  // Project-specific rules
  {
    rules: {
      "no-underscore-dangle": "off",
      "no-console": ["warn", { allow: ["warn", "error", "debug", "info"] }],
      "no-shadow": "off",
      "no-restricted-syntax": "off",
      "no-continue": "off",
      "no-eval": "off",
      "no-await-in-loop": "off",
      "no-nested-ternary": "off",
      "no-param-reassign": "off",
      "consistent-return": "off",
      "prefer-destructuring": "off",

      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-this-alias": "off",
      "@typescript-eslint/no-empty-function": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-shadow": ["error"],
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],

      "sort-imports": [
        "error",
        {
          ignoreCase: false,
          ignoreDeclarationSort: true,
          ignoreMemberSort: false,
          memberSyntaxSortOrder: ["none", "all", "multiple", "single"],
          allowSeparatedGroups: true,
        },
      ],
    },
  },
);
