const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const desktopDir = path.join(rootDir, 'betamovie-desktop');
const downloadsDir = path.join(rootDir, 'downloads');

// Load environment variables from root .env file if it exists to pass VITE_BACKEND_URL to builds
const envPath = path.join(rootDir, '.env');
if (fs.existsSync(envPath)) {
  console.log('Loading environment variables from root .env file...');
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const firstEqual = trimmed.indexOf('=');
    if (firstEqual === -1) continue;
    const key = trimmed.slice(0, firstEqual).trim();
    const val = trimmed.slice(firstEqual + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
}

// 1. Create downloads folder in root if it doesn't exist
if (!fs.existsSync(downloadsDir)) {
  fs.mkdirSync(downloadsDir, { recursive: true });
}

// 2. Build desktop renderer and shell code
console.log('Building desktop renderer and shell...');
execSync('pnpm run build', { cwd: desktopDir, stdio: 'inherit' });

// 3. Package desktop application for macOS and Windows sequentially to avoid CLI flag conflicts
console.log('Packaging desktop applications for macOS and Windows...');

const targets = [];
if (process.platform === 'darwin') {
  targets.push(
    { name: 'macOS Apple Silicon (arm64)', command: 'npx electron-builder --mac dmg --arm64' },
    { name: 'macOS Intel (x64)', command: 'npx electron-builder --mac dmg --x64' },
    { name: 'macOS Universal', command: 'npx electron-builder --mac dmg --universal' }
  );
}
// Windows targets can be built on macOS, Linux, and Windows
targets.push(
  { name: 'Windows x64', command: 'npx electron-builder --win --x64' },
  { name: 'Windows ARM64', command: 'npx electron-builder --win --arm64' }
);

for (const target of targets) {
  console.log(`\n--- Building target: ${target.name} ---`);
  try {
    execSync(target.command, { cwd: desktopDir, stdio: 'inherit' });
  } catch (error) {
    console.error(`Failed to build target ${target.name}:`, error.message);
  }
}

// 4. Find version from package.json
const packageJson = JSON.parse(fs.readFileSync(path.join(desktopDir, 'package.json'), 'utf8'));
const version = packageJson.version;

// 5. Copy built artifacts to the downloads folder
const releaseDir = path.join(desktopDir, 'release');
console.log(`\nCopying packaged builds (v${version}) from ${releaseDir} to ${downloadsDir}...`);

const filesToCopy = [];
if (process.platform === 'darwin') {
  filesToCopy.push(
    `AlphaFlix-${version}-arm64.dmg`,
    `AlphaFlix-${version}-x64.dmg`,
    `AlphaFlix-${version}-universal.dmg`
  );
}
filesToCopy.push(
  `AlphaFlix-${version}-x64.exe`,
  `AlphaFlix-${version}-arm64.exe`,
  `AlphaFlix-${version}-x64.zip`,
  `AlphaFlix-${version}-arm64.zip`
);

let copiedCount = 0;
for (const file of filesToCopy) {
  const src = path.join(releaseDir, file);
  const dest = path.join(downloadsDir, file);
  if (fs.existsSync(src)) {
    console.log(`Copying ${file}...`);
    fs.copyFileSync(src, dest);
    copiedCount++;
  } else {
    console.warn(`Warning: Built file ${file} was not found in release directory.`);
  }
}

// Also copy the README.txt guide
const readmeSrc = path.join(desktopDir, 'README.txt');
const readmeDest = path.join(downloadsDir, 'README.txt');
if (fs.existsSync(readmeSrc)) {
  console.log('Copying README.txt...');
  fs.copyFileSync(readmeSrc, readmeDest);
}

console.log(`Successfully built and copied ${copiedCount} files to the downloads folder.`);

// 6. Sync to Docker volume if Docker is available
try {
  console.log('\nChecking for Docker volumes to sync...');
  // Check which volume exists
  let volumeName = null;
  const volumesList = execSync('docker volume ls -q', { encoding: 'utf8' });
  if (volumesList.includes('betamovie_backend_downloads-data')) {
    volumeName = 'betamovie_backend_downloads-data';
  } else if (volumesList.includes('betamovie_downloads-data')) {
    volumeName = 'betamovie_downloads-data';
  }
  
  if (volumeName) {
    console.log(`Syncing files to Docker volume "${volumeName}"...`);
    // Resolve absolute path to downloads folder for Docker mount
    const absDownloadsDir = path.resolve(downloadsDir);
    execSync(`docker run --rm -v "${volumeName}":/data -v "${absDownloadsDir}":/src alpine sh -c "cp -r /src/. /data/"`, { stdio: 'inherit' });
    console.log('Successfully synced files to Docker volume.');
  } else {
    console.log('No matching Docker downloads volume found to sync. Local files are preserved.');
  }
} catch (dockerError) {
  console.log('Docker is not running or volume sync failed. Continuing...');
}
