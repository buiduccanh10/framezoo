import { readFile } from "node:fs/promises";

const indexHtml = await readFile(new URL("../index.html", import.meta.url), "utf8");
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
  "<title>Framezoo Player | AI Subtitle Sync</title>",
  'name="robots" content="index,follow,max-image-preview:large"',
  'name="thumbnail" content="https://framezoo.top/embed-preview-1.png"',
  'rel="canonical" href="https://framezoo.top/"',
  'property="og:image"',
  'property="og:image:width" content="1200"',
  'property="og:image:height" content="782"',
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

console.log("SEO metadata and JSON-LD are valid.");
