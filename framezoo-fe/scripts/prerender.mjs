import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "vite";

const projectRoot = path.resolve(new URL("..", import.meta.url).pathname);
const outputDir = await mkdtemp(path.join(os.tmpdir(), "framezoo-fe-ssr-"));
const siteUrl = "https://framezoo.top";
const routes = [
  {
    pathname: "/",
    output: "index.html",
    title: "Framezoo - Fast & Smooth Video Streaming",
    description:
      "Framezoo is a high-speed video streaming player designed to be smooth, intuitive, and easy to use. Explore rich movie metadata, sync subtitles with video streams without limits, and load subtitles from multiple sources.",
  },
  {
    pathname: "/download",
    output: "download/index.html",
    title: "Downloads | Framezoo",
    description:
      "Download Framezoo for macOS and Windows. Watch movies, TV series, and video streams instantly at high speed.",
  },
  {
    pathname: "/experience",
    output: "experience/index.html",
    title: "Features & Experience | Framezoo",
    description:
      "Enjoy high-speed video streaming in a smooth, easy-to-use interface with rich movie metadata, unlimited stream subtitle sync, and subtitles from multiple sources.",
  },
  {
    pathname: "/ecosystem",
    output: "ecosystem/index.html",
    title: "Addon Ecosystem | Framezoo",
    description:
      "Extend Framezoo with high-speed stream sources, rich movie metadata catalogs, and multi-source subtitle providers.",
  },
  {
    pathname: "/create-addon",
    output: "create-addon/index.html",
    title: "Build an Addon | Framezoo",
    description:
      "Build a Framezoo addon with a simple HTTP manifest for video streams, multi-source subtitles, and movie metadata catalogs.",
  },
  {
    pathname: "/addon/subtitles/configure",
    output: "addon/subtitles/configure/index.html",
    title: "Configure Framezoo Subtitles | Framezoo",
    description:
      "Configure optional personal API keys (Wyzie, SubSource, OpenSubtitles.com) for Framezoo Subtitles.",
    noindex: true,
  },
  {
    pathname: "/guide/install",
    output: "guide/install/index.html",
    title: "Installation Guide | Framezoo",
    description:
      "Step-by-step installation and launch guide for the Framezoo desktop streaming player on macOS and Windows.",
  },
  {
    pathname: "/legal/terms",
    output: "legal/terms/index.html",
    title: "Terms of Service | Framezoo",
    description:
      "Please read these terms and the privacy policy before creating an account or using the Framezoo desktop application.",
  },
  {
    pathname: "/legal/privacy",
    output: "legal/privacy/index.html",
    title: "Privacy & Personal Data Protection Policy | Framezoo",
    description:
      "This policy describes data processing across Framezoo Desktop, Mobile, TV apps and official Framezoo servers.",
  },
  {
    pathname: "/legal/copyright",
    output: "legal/copyright/index.html",
    title: "Copyright, Notice & Takedown & Content Disclaimer | Framezoo",
    description:
      "Neutral intermediary status, 24h/72h Notice & Takedown blocklist process, and Repeat Infringer policy.",
  },
  {
    pathname: "/legal/addon-policy",
    output: "legal/addon-policy/index.html",
    title: "Addon Policy & Community Guidelines | Framezoo",
    description:
      "Safety and compliance standards for the open HTTP/JSON addon ecosystem on Framezoo.",
  },
];

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function replaceRequired(html, pattern, replacement, label) {
  if (!pattern.test(html)) {
    throw new Error(`Prerender failed: missing ${label}`);
  }
  return html.replace(pattern, replacement);
}

function setMeta(html, attribute, key, content) {
  const escapedContent = escapeHtml(content);
  return replaceRequired(
    html,
    new RegExp(`<meta\\s+${attribute}="${key}"\\s+content="[^"]*"\\s*/?>`, "i"),
    `<meta ${attribute}="${key}" content="${escapedContent}" />`,
    `meta[${attribute}="${key}"]`,
  );
}

function hoistPreloadLinks(html, renderedApp) {
  const preloadPattern = /<link\b[^>]*rel="preload"[^>]*\/?>/gi;
  const preloads = renderedApp.match(preloadPattern) ?? [];
  if (preloads.length === 0) {
    return { html, renderedApp };
  }

  const uniqueNewPreloads = [...new Set(preloads)].filter(
    (tag) => !html.includes(tag),
  );
  const nextHtml =
    uniqueNewPreloads.length > 0
      ? html.replace("</head>", `  ${uniqueNewPreloads.join("\n    ")}\n  </head>`)
      : html;

  return {
    html: nextHtml,
    renderedApp: renderedApp.replace(preloadPattern, ""),
  };
}

function applyRouteSeo(html, route) {
  if (route.pathname === "/") return html;

  const canonical = `${siteUrl}${route.pathname}`;
  let output = replaceRequired(
    html,
    /<title>[^<]*<\/title>/i,
    `<title>${escapeHtml(route.title)}</title>`,
    "<title>",
  );
  output = setMeta(output, "name", "description", route.description);
  if (route.noindex) {
    output = setMeta(output, "name", "robots", "noindex,follow");
  }
  output = setMeta(output, "property", "og:title", route.title);
  output = setMeta(output, "property", "og:description", route.description);
  output = setMeta(output, "property", "og:url", canonical);
  output = setMeta(output, "name", "twitter:title", route.title);
  output = setMeta(output, "name", "twitter:description", route.description);
  output = replaceRequired(
    output,
    /<link\s+rel="canonical"\s+href="[^"]*"\s*\/?>/i,
    `<link rel="canonical" href="${canonical}" />`,
    'link[rel="canonical"]',
  );

  const pageShortTitle = route.title
    .replace(" | Framezoo", "")
    .replace("Framezoo | ", "");

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${siteUrl}/#website`,
        name: "Framezoo",
        url: `${siteUrl}/`,
      },
      {
        "@type": "WebPage",
        "@id": `${canonical}#webpage`,
        name: route.title,
        url: canonical,
        description: route.description,
        isPartOf: {
          "@id": `${siteUrl}/#website`,
        },
        primaryImageOfPage: {
          "@type": "ImageObject",
          url: `${siteUrl}/og-preview.jpg?v=2`,
          width: 1024,
          height: 595,
        },
      },
      {
        "@type": "BreadcrumbList",
        "@id": `${canonical}#breadcrumb`,
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: "Home",
            item: `${siteUrl}/`,
          },
          {
            "@type": "ListItem",
            position: 2,
            name: pageShortTitle,
            item: canonical,
          },
        ],
      },
    ],
  };

  return replaceRequired(
    output,
    /<script\s+type="application\/ld\+json">[\s\S]*?<\/script>/i,
    `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`,
    "application/ld+json",
  );
}

try {
  await build({
    root: projectRoot,
    configFile: path.join(projectRoot, "vite.config.mts"),
    ssr: {
      noExternal: true,
    },
    build: {
      ssr: path.join(projectRoot, "src/ssr.tsx"),
      outDir: outputDir,
      emptyOutDir: true,
      rollupOptions: {
        output: {
          entryFileNames: "server.mjs",
        },
      },
    },
  });

  const renderer = await import(
    pathToFileURL(path.join(outputDir, "server.mjs")).href
  );
  const template = await readFile(
    path.join(projectRoot, "dist/index.html"),
    "utf8",
  );
  const rootPlaceholder = '<div id="root"></div>';

  for (const route of routes) {
    if (!template.includes(rootPlaceholder)) {
      throw new Error(
        "Prerender target does not contain the root placeholder.",
      );
    }

    const { html: withPreloads, renderedApp } = hoistPreloadLinks(
      template,
      renderer.renderApp(route.pathname),
    );
    const routeHtml = applyRouteSeo(
      withPreloads.replace(
        rootPlaceholder,
        `<div id="root">${renderedApp}</div>`,
      ),
      route,
    );

    const outputPath = path.join(projectRoot, "dist", route.output);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, routeHtml);
  }
} finally {
  await rm(outputDir, { recursive: true, force: true });
}
