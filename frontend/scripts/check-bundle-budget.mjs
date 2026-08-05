import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const ASSET_DIRECTORY = fileURLToPath(new URL('../dist/assets/', import.meta.url));

// These limits leave roughly 8-13% headroom over the optimized July 2026
// baseline while keeping every JavaScript chunk below Vite's 500 kB warning.
const BUDGETS = {
  '.js': {
    label: 'JavaScript',
    maxFileBytes: 500_000,
    maxFileGzipBytes: 170_000,
    maxTotalBytes: 900_000,
    maxTotalGzipBytes: 310_000,
  },
  '.css': {
    label: 'CSS',
    maxFileBytes: 300_000,
    maxFileGzipBytes: 140_000,
    maxTotalBytes: 375_000,
    maxTotalGzipBytes: 160_000,
  },
};

async function assetFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? assetFiles(path) : [path];
  }));
  return files.flat();
}

function formatBytes(bytes) {
  return `${(bytes / 1_000).toFixed(2)} kB`;
}

function overBudget(actual, limit) {
  return actual > limit;
}

let files;
try {
  files = await assetFiles(ASSET_DIRECTORY);
} catch (error) {
  console.error(`Bundle budget check could not read ${ASSET_DIRECTORY}: ${error.message}`);
  process.exit(1);
}

const failures = [];

for (const [extension, budget] of Object.entries(BUDGETS)) {
  const assets = [];
  for (const path of files.filter((candidate) => extname(candidate) === extension)) {
    const contents = await readFile(path);
    assets.push({
      path: relative(ASSET_DIRECTORY, path),
      bytes: contents.byteLength,
      gzipBytes: gzipSync(contents, { level: 9 }).byteLength,
    });
  }

  if (assets.length === 0) {
    failures.push(`${budget.label}: no ${extension} assets were found`);
    continue;
  }

  const totalBytes = assets.reduce((sum, asset) => sum + asset.bytes, 0);
  const totalGzipBytes = assets.reduce((sum, asset) => sum + asset.gzipBytes, 0);
  const largest = assets.reduce((current, asset) => asset.bytes > current.bytes ? asset : current);
  const largestGzip = assets.reduce(
    (current, asset) => asset.gzipBytes > current.gzipBytes ? asset : current,
  );

  console.log(
    `${budget.label}: ${assets.length} files, `
    + `total ${formatBytes(totalBytes)} / ${formatBytes(budget.maxTotalBytes)}, `
    + `gzip ${formatBytes(totalGzipBytes)} / ${formatBytes(budget.maxTotalGzipBytes)}`,
  );
  console.log(
    `  largest raw: ${largest.path} ${formatBytes(largest.bytes)} `
    + `/ ${formatBytes(budget.maxFileBytes)}`,
  );
  console.log(
    `  largest gzip: ${largestGzip.path} ${formatBytes(largestGzip.gzipBytes)} `
    + `/ ${formatBytes(budget.maxFileGzipBytes)}`,
  );

  for (const asset of assets) {
    if (overBudget(asset.bytes, budget.maxFileBytes)) {
      failures.push(
        `${budget.label} asset ${asset.path} is ${formatBytes(asset.bytes)}; `
        + `limit is ${formatBytes(budget.maxFileBytes)}`,
      );
    }
    if (overBudget(asset.gzipBytes, budget.maxFileGzipBytes)) {
      failures.push(
        `${budget.label} asset ${asset.path} is ${formatBytes(asset.gzipBytes)} gzip; `
        + `limit is ${formatBytes(budget.maxFileGzipBytes)}`,
      );
    }
  }
  if (overBudget(totalBytes, budget.maxTotalBytes)) {
    failures.push(
      `${budget.label} assets total ${formatBytes(totalBytes)}; `
      + `limit is ${formatBytes(budget.maxTotalBytes)}`,
    );
  }
  if (overBudget(totalGzipBytes, budget.maxTotalGzipBytes)) {
    failures.push(
      `${budget.label} assets total ${formatBytes(totalGzipBytes)} gzip; `
      + `limit is ${formatBytes(budget.maxTotalGzipBytes)}`,
    );
  }
}

if (failures.length > 0) {
  console.error('\nBundle budget exceeded:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('Bundle budget passed.');
