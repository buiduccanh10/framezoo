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
    title: "Framezoo Player | AI Subtitle Sync",
    description:
      "Framezoo is a player with AI subtitle sync, dual subtitles, rich media metadata, and addon support.",
  },
  {
    pathname: "/experience",
    output: "experience/index.html",
    title: "Everything You Need in a Player | Framezoo",
    description:
      "Sync subtitles with AI, keep dual subtitles visible, explore media metadata, and control playback in Framezoo.",
  },
  {
    pathname: "/ecosystem",
    output: "ecosystem/index.html",
    title: "Framezoo Addon Ecosystem | Sources, Catalogs and Tools",
    description:
      "Extend Framezoo with source connectors, catalog metadata, subtitle tools, and community addons.",
  },
  {
    pathname: "/create-addon",
    output: "create-addon/index.html",
    title: "Create a Framezoo Addon | Addon Guide",
    description:
      "Build a Framezoo addon with a manifest, stream resources, subtitles, and catalog endpoints.",
  },
  {
    pathname: "/download",
    output: "download/index.html",
    title: "Download Framezoo | macOS and Windows",
    description: "Download the Framezoo desktop player for macOS or Windows.",
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
