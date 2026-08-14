import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
function getArg(name, defaultValue) {
  const idx = args.indexOf(name);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : defaultValue;
}

const target = getArg("--target", "win32-x64");
const defaultOutDir = path.join(
  process.cwd(),
  "resources",
  "libmpv-sdk",
  target,
);
const outDir = path.resolve(getArg("--out", defaultOutDir));

if (!target.startsWith("win32-")) {
  console.log(
    `[fetch-windows-libmpv] Target ${target} is not a Windows target. Skipping.`,
  );
  process.exit(0);
}

const pattern =
  target === "win32-arm64"
    ? /^mpv-dev-aarch64-[0-9].*\.7z$/i
    : /^mpv-dev-x86_64-[0-9].*\.7z$/i;

const fallbackPattern =
  target === "win32-x64" ? /^mpv-dev-x86_64-v3-[0-9].*\.7z$/i : pattern;

const candidateRepos = [
  {
    apiUrl: "https://api.github.com/repos/shinchiro/mpv-winbuild-cmake/releases?per_page=5",
    htmlUrl: "https://github.com/shinchiro/mpv-winbuild-cmake/releases",
  },
  {
    apiUrl: "https://api.github.com/repos/zhongfly/mpv-winbuild/releases?per_page=5",
    htmlUrl: "https://github.com/zhongfly/mpv-winbuild/releases",
  },
];

const fallbackDirectUrls = {
  "win32-x64": [
    "https://github.com/shinchiro/mpv-winbuild-cmake/releases/download/20250104-git-0a37340/mpv-dev-x86_64-20250104-git-0a37340.7z",
    "https://github.com/zhongfly/mpv-winbuild/releases/download/2024-12-29-df840df/mpv-dev-x86_64-20241229-git-df840df.7z",
  ],
  "win32-arm64": [
    "https://github.com/shinchiro/mpv-winbuild-cmake/releases/download/20250104-git-0a37340/mpv-dev-aarch64-20250104-git-0a37340.7z",
    "https://github.com/zhongfly/mpv-winbuild/releases/download/2024-12-29-df840df/mpv-dev-aarch64-20241229-git-df840df.7z",
  ],
};

function getAuthHeaders() {
  const headers = { "User-Agent": "Framezoo-Build-Script" };
  const token =
    process.env.GITHUB_TOKEN ||
    process.env.GH_TOKEN ||
    process.env.GITHUB_PAT ||
    process.env.CI_JOB_TOKEN;
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return headers;
}

async function fetchFromApi() {
  const headers = getAuthHeaders();
  for (const { apiUrl } of candidateRepos) {
    console.log(`[fetch-windows-libmpv] Checking API: ${apiUrl}`);
    try {
      const res = await fetch(apiUrl, { headers });
      if (!res.ok) {
        console.warn(
          `[fetch-windows-libmpv] Failed to query ${apiUrl}: ${res.status} ${res.statusText}`,
        );
        continue;
      }
      const releases = await res.json();
      if (!Array.isArray(releases)) continue;

      for (const release of releases) {
        if (!release.assets || !Array.isArray(release.assets)) continue;
        const asset =
          release.assets.find((a) => pattern.test(a.name)) ||
          release.assets.find((a) => fallbackPattern.test(a.name));
        if (asset) {
          console.log(
            `[fetch-windows-libmpv] Found asset via API: ${asset.name} (${asset.browser_download_url})`,
          );
          return { name: asset.name, url: asset.browser_download_url };
        }
      }
    } catch (error) {
      console.warn(
        `[fetch-windows-libmpv] Error checking ${apiUrl}:`,
        error.message,
      );
    }
  }
  return null;
}

async function fetchFromHtmlScrape() {
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  };

  for (const { htmlUrl } of candidateRepos) {
    console.log(`[fetch-windows-libmpv] Scraping releases HTML: ${htmlUrl}`);
    try {
      const res = await fetch(htmlUrl, { headers });
      if (!res.ok) {
        console.warn(
          `[fetch-windows-libmpv] Failed to scrape HTML from ${htmlUrl}: ${res.status} ${res.statusText}`,
        );
        continue;
      }
      const html = await res.text();
      const hrefRegex =
        /href="(\/[^"]+\/releases\/download\/[^"]+\/(mpv-dev-[^"]+\.7z))"/gi;
      let match;
      while ((match = hrefRegex.exec(html)) !== null) {
        const assetPath = match[1];
        const assetName = match[2];
        if (pattern.test(assetName) || fallbackPattern.test(assetName)) {
          const downloadUrl = `https://github.com${assetPath}`;
          console.log(
            `[fetch-windows-libmpv] Found asset via HTML scrape: ${assetName} (${downloadUrl})`,
          );
          return { name: assetName, url: downloadUrl };
        }
      }
    } catch (error) {
      console.warn(
        `[fetch-windows-libmpv] Error scraping ${htmlUrl}:`,
        error.message,
      );
    }
  }
  return null;
}

async function fetchReleaseAsset() {
  const apiAsset = await fetchFromApi();
  if (apiAsset) return apiAsset;

  console.log(
    "[fetch-windows-libmpv] API queries failed or rate-limited; attempting HTML scraping...",
  );
  const htmlAsset = await fetchFromHtmlScrape();
  if (htmlAsset) return htmlAsset;

  console.log(
    "[fetch-windows-libmpv] Scraping failed; falling back to pinned direct URLs...",
  );
  const directUrls = fallbackDirectUrls[target] || [];
  for (const directUrl of directUrls) {
    const assetName = path.basename(directUrl);
    console.log(
      `[fetch-windows-libmpv] Using pinned fallback asset: ${assetName} (${directUrl})`,
    );
    return { name: assetName, url: directUrl };
  }

  throw new Error(
    `[fetch-windows-libmpv] Could not find suitable prebuilt libmpv dev asset for target ${target}`,
  );
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });

  const asset = await fetchReleaseAsset();
  const tmpFile = path.join(os.tmpdir(), `mpv-sdk-${Date.now()}-${asset.name}`);

  console.log(`[fetch-windows-libmpv] Downloading ${asset.url}...`);
  const downloadRes = await fetch(asset.url, {
    headers: { "User-Agent": "Framezoo-Build-Script" },
  });
  if (!downloadRes.ok) {
    throw new Error(
      `Failed to download ${asset.url}: ${downloadRes.status} ${downloadRes.statusText}`,
    );
  }
  const buffer = Buffer.from(await downloadRes.arrayBuffer());
  fs.writeFileSync(tmpFile, buffer);
  console.log(
    `[fetch-windows-libmpv] Saved temporary archive (${(buffer.length / 1024 / 1024).toFixed(2)} MB) to ${tmpFile}`,
  );

  console.log(
    `[fetch-windows-libmpv] Extracting archive using 7z to ${outDir}...`,
  );
  try {
    execFileSync("7z", ["x", "-y", `-o${outDir}`, tmpFile], {
      stdio: "inherit",
    });
  } catch (error) {
    throw new Error(
      `Failed to extract archive using '7z'. Ensure 7-Zip (7z) is installed and in PATH. Details: ${error.message}`,
    );
  } finally {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }

  function findMpvRoot(directory) {
    if (
      fs.existsSync(path.join(directory, "include", "mpv", "client.h")) ||
      fs.existsSync(path.join(directory, "libmpv-2.dll")) ||
      fs.existsSync(path.join(directory, "mpv-2.dll")) ||
      fs.existsSync(path.join(directory, "lib", "libmpv.dll.a"))
    ) {
      return directory;
    }
    const entries = fs.readdirSync(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const sub = path.join(directory, entry.name);
        if (
          fs.existsSync(path.join(sub, "include")) ||
          fs.existsSync(path.join(sub, "libmpv-2.dll")) ||
          fs.existsSync(path.join(sub, "mpv-2.dll")) ||
          fs.existsSync(path.join(sub, "lib", "libmpv.dll.a"))
        ) {
          return sub;
        }
      }
    }
    return directory;
  }

  const libmpvRoot = findMpvRoot(outDir);
  console.log(`[fetch-windows-libmpv] SDK Ready at: ${libmpvRoot}`);

  if (process.env.GITHUB_ENV) {
    fs.appendFileSync(
      process.env.GITHUB_ENV,
      `LIBMPV_ROOT=${libmpvRoot}\n`,
      "utf8",
    );
    console.log(
      `[fetch-windows-libmpv] Appended LIBMPV_ROOT=${libmpvRoot} to GITHUB_ENV`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
