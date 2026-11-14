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
      "Configure your personal Wyzie Subtitles API Key to enjoy fast, multi-source subtitles without shared rate limits.",
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
      "Terms of Service and software license for the Framezoo desktop media player.",
  },
  {
    pathname: "/legal/privacy",
    output: "legal/privacy/index.html",
    title: "Privacy & Personal Data Protection Policy | Framezoo",
    description:
      "Privacy policy and personal data protection compliance (Vietnam 2026 PDPD Law) for Framezoo.",
  },
  {
    pathname: "/legal/copyright",
    output: "legal/copyright/index.html",
    title: "Copyright, DMCA & Content Disclaimer | Framezoo",
    description:
      "Intermediary software disclaimer, metadata attribution, and DMCA notice procedure for Framezoo.",
  },
  {
    pathname: "/legal/addon-policy",
    output: "legal/addon-policy/index.html",
    title: "Addon Policy & Community Guidelines | Framezoo",
    description:
      "Safety standards and legal compliance guidelines for third-party community addons on Framezoo.",
  },
];

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function setMeta(html, attribute, key, content) {
  const escapedContent = escapeHtml(content);
  return html.replace(
    new RegExp(`<meta ${attribute}="${key}" content="[^"]*"\\s*/>`),
    `<meta ${attribute}="${key}" content="${escapedContent}" />`,
  );
}

function applyRouteSeo(html, route) {
  if (route.pathname === "/") return html;

  const canonical = `${siteUrl}${route.pathname}`;
  let output = html.replace(
    /<title>[^<]*<\/title>/,
    `<title>${escapeHtml(route.title)}</title>`,
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
  output = output.replace(
    /<link rel="canonical" href="[^"]*" \/>/,
    `<link rel="canonical" href="${canonical}" />`,
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
          url: `${siteUrl}/embed-preview-1.png`,
          width: 1200,
          height: 782,
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

  return output.replace(
    /<script type="application\/ld\+json">[\s\S]*?<\/script>/,
    `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`,
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

    const renderedApp = renderer.renderApp(route.pathname);
    const routeHtml = applyRouteSeo(
      template.replace(rootPlaceholder, `<div id="root">${renderedApp}</div>`),
      route,
    );

    const outputPath = path.join(projectRoot, "dist", route.output);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, routeHtml);
  }
} finally {
  await rm(outputDir, { recursive: true, force: true });
}
