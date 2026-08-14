import { allThemes, defaultTheme, safeThemeList } from "./themes";
import type { Config } from "tailwindcss";
import plugin from "tailwindcss/plugin";
import path from "node:path";

const themer = require("tailwindcss-themer");

const config: Config = {
  content: [
    path.resolve(__dirname, "index.html"),
    path.resolve(__dirname, "src/**/*.{js,ts,jsx,tsx}"),
  ],
  safelist: safeThemeList,
  theme: {
    extend: {
      /* breakpoints */
      screens: {
        xs: "350px",
        ssm: "400px",
        "2xl": "1921px", // Custom breakpoint for screens at least 1920px wide
        "3xl": "2650px", // Custom breakpoint for screens at least 2650px wide
        "4xl": "3840px", // Custom breakpoint for screens at least 4096px wide
      },

      /* fonts */
      fontFamily: {
        main: "'DM Sans'", // "main": "'Open Sans'",
      },

      /* animations */
      keyframes: {
        "loading-pin": {
          "0%, 40%, 100%": { height: "0.5em", "background-color": "#282336" },
          "20%": { height: "1em", "background-color": "white" },
        },
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "seek-left": {
          "0%": { transform: "translateX(0) scale(1)", opacity: "1" },
          "100%": { transform: "translateX(-50px) scale(1.2)", opacity: "0" },
        },
        "seek-right": {
          "0%": { transform: "translateX(0) scale(1)", opacity: "1" },
          "100%": { transform: "translateX(50px) scale(1.2)", opacity: "0" },
        },
        "ai-progress-scan": {
          "0%": {
            left: "-18%",
            transform: "scaleX(0.75)",
            opacity: "0",
          },
          "12%": { left: "0%", opacity: "1" },
          "48%": {
            left: "48%",
            transform: "scaleX(1)",
            opacity: "0.95",
          },
          "78%, 100%": {
            left: "118%",
            transform: "scaleX(1.2)",
            opacity: "0",
          },
        },
        "ai-progress-shimmer": {
          "0%": { backgroundPosition: "200% 0" },
          "100%": { backgroundPosition: "-20% 0" },
        },
        "ai-progress-grid": {
          "0%": { backgroundPosition: "0 0" },
          "100%": { backgroundPosition: "28px 0" },
        },
        "ai-progress-orbit": {
          "0%": { transform: "rotate(0deg) scale(0.9)", opacity: "0.45" },
          "50%": { transform: "rotate(180deg) scale(1)", opacity: "1" },
          "100%": { transform: "rotate(360deg) scale(0.9)", opacity: "0.45" },
        },
      },
      animation: {
        "loading-pin": "loading-pin 1.8s ease-in-out infinite",
        "fade-in": "fade-in 200ms ease-out forwards",
        "seek-left": "seek-left 0.5s cubic-bezier(0, 0, 0.2, 1) forwards",
        "seek-right": "seek-right 0.5s cubic-bezier(0, 0, 0.2, 1) forwards",
        "ai-progress-scan":
          "ai-progress-scan 1.8s cubic-bezier(0.4, 0, 0.2, 1) infinite",
        "ai-progress-shimmer": "ai-progress-shimmer 1.6s linear infinite",
        "ai-progress-grid": "ai-progress-grid 1.4s linear infinite",
        "ai-progress-orbit": "ai-progress-orbit 1.8s linear infinite",
      },
    },
  },
  plugins: [
    require("tailwind-scrollbar"),
    themer({
      defaultTheme: defaultTheme,
      themes: [
        {
          name: "default",
          selectors: [".theme-default"],
          ...defaultTheme,
        },
        ...allThemes,
      ],
    }),
    plugin(({ addVariant }) => {
      addVariant("dir-neutral", "[dir] &");
    }),
  ],
};

export default config;
