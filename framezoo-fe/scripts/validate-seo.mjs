import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const rootDir = path.resolve(new URL("..", import.meta.url).pathname);
const indexHtml = await readFile(path.join(rootDir, "index.html"), "utf8");
const jsonLdMatch = indexHtml.match(
  /<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/,
);

if (!jsonLdMatch) {
  throw new Error("Missing JSON-LD script.");
}

const document = JSON.parse(jsonLdMatch[1]);
const graph = Array.isArray(document["@graph"]) ? document["@graph"] : [];
const softwareApplication = graph.find(
  (item) => item["@type"] === "SoftwareApplication",
);

const requiredSnippets = [
  '<html lang="en">',
  "<title>Framezoo - Fast & Smooth Video Streaming</title>",
  'name="robots" content="index,follow,max-image-preview:large"',
  'name="thumbnail" content="https://framezoo.top/og-preview.jpg?v=2"',
  'rel="canonical" href="https://framezoo.top/"',
  'property="og:image"',
  'property="og:image:width" content="1024"',
  'property="og:image:height" content="595"',
  'name="twitter:card"',
];

for (const snippet of requiredSnippets) {
  if (!indexHtml.includes(snippet)) {
    throw new Error(`Missing SEO markup: ${snippet}`);
  }
}

if (!softwareApplication) {
  throw new Error("Missing SoftwareApplication JSON-LD.");
}

const navigationList = graph.find((item) => item["@type"] === "ItemList");
if (!navigationList || !Array.isArray(navigationList.itemListElement)) {
  throw new Error("Missing ItemList/SiteNavigationElement in JSON-LD.");
}

if (
  softwareApplication.offers?.["@type"] !== "Offer" ||
  softwareApplication.offers.price !== 0 ||
  softwareApplication.offers.priceCurrency !== "USD"
) {
  throw new Error("SoftwareApplication must declare a free USD Offer.");
}

if (
  !Array.isArray(softwareApplication.featureList) ||
  softwareApplication.featureList.length === 0
) {
  throw new Error("SoftwareApplication featureList is missing.");
}

function readTagContent(html, pattern, label) {
  const match = html.match(pattern);
  if (!match) throw new Error(`Missing ${label}`);
  return match[1].trim();
}

async function checkPublicMediaBudget(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await checkPublicMediaBudget(fullPath);
      continue;
    }
    if (!/\.(gif|mp4|webm|png|jpe?g|webp)$/i.test(entry.name)) continue;
    const { size } = await stat(fullPath);
    if (size > 5 * 1024 * 1024) {
      throw new Error(
        `Oversized media asset (${(size / 1024 / 1024).toFixed(1)} MB > 5 MB): ${path.relative(rootDir, fullPath)}`,
      );
    }
  }
}

await checkPublicMediaBudget(path.join(rootDir, "public"));

const distDir = path.join(rootDir, "dist");
if (existsSync(path.join(distDir, "index.html"))) {
  const sitemapXml = await readFile(path.join(rootDir, "public/sitemap.xml"), "utf8");
  const sitemapUrls = [...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(
    (m) => m[1].trim(),
  );

  const seenTitles = new Set();
  const seenDescriptions = new Set();

  for (const loc of sitemapUrls) {
    const pathname = new URL(loc).pathname;
    const htmlPath =
      pathname === "/"
        ? path.join(distDir, "index.html")
        : path.join(distDir, pathname.replace(/^\/+/, ""), "index.html");
    const html = await readFile(htmlPath, "utf8");

    const title = readTagContent(html, /<title>([^<]+)<\/title>/i, `${pathname} title`);
    const description = readTagContent(
      html,
      /<meta\s+name="description"\s+content="([^"]*)"/i,
      `${pathname} description`,
    );
    const ogTitle = readTagContent(
      html,
      /<meta\s+property="og:title"\s+content="([^"]*)"/i,
      `${pathname} og:title`,
    );
    const ogDescription = readTagContent(
      html,
      /<meta\s+property="og:description"\s+content="([^"]*)"/i,
      `${pathname} og:description`,
    );
    const ogUrl = readTagContent(
      html,
      /<meta\s+property="og:url"\s+content="([^"]*)"/i,
      `${pathname} og:url`,
    );
    const canonical = readTagContent(
      html,
      /<link\s+rel="canonical"\s+href="([^"]*)"/i,
      `${pathname} canonical`,
    );

    if (ogTitle !== title || ogDescription !== description) {
      throw new Error(`OG title/description mismatch on ${pathname}`);
    }
    if (canonical !== loc || ogUrl !== loc) {
      throw new Error(`Canonical/og:url mismatch on ${pathname}`);
    }
    if (seenTitles.has(title) || seenDescriptions.has(description)) {
      throw new Error(`Duplicate title or description on ${pathname}`);
    }
    if (html.includes('<div id="root"><link rel="preload"')) {
      throw new Error(`Preload link hoisted inside #root on ${pathname}`);
    }
    seenTitles.add(title);
    seenDescriptions.add(description);
  }

  const configureHtml = await readFile(
    path.join(distDir, "addon/subtitles/configure/index.html"),
    "utf8",
  );
  if (!configureHtml.includes('name="robots" content="noindex,follow"')) {
    throw new Error("Configure page must declare noindex,follow.");
  }
}

console.log("SEO metadata and JSON-LD are valid.");
