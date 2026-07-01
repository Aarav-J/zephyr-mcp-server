/**
 * Index builder CLI: downloads Zephyr release artifacts and builds the
 * SQLite FTS5 index for the MCP server.
 *
 * Usage:
 *   npx tsx scripts/build-index.ts                       # Build latest version
 *   npx tsx scripts/build-index.ts v4.0.0                 # Build specific version
 *   npx tsx scripts/build-index.ts --source ./zephyr      # Use local Zephyr source
 *   npx tsx scripts/build-index.ts --doxygen ./xml        # Use local Doxygen XML
 */
import { ZephyrDatabase, getCacheDir } from "../src/db.js";
import { parseDoxygenDirectory } from "../src/parsers/doxygen.js";
import { parseKconfigTree } from "../src/parsers/kconfig.js";
import { parseDtBindingsTree } from "../src/parsers/dt-bindings.js";
import { join } from "node:path";
import { mkdirSync, existsSync, writeFileSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";

// --- Helpers ---

function log(msg: string): void {
  console.error(`[build-index] ${msg}`);
}

async function fetchLatestVersion(): Promise<string> {
  const resp = await fetch(
    "https://api.github.com/repos/zephyrproject-rtos/zephyr/releases/latest"
  );
  const data = (await resp.json()) as { tag_name: string };
  return data.tag_name;
}

function downloadAndExtract(version: string, destDir: string): string {
  const url = `https://api.github.com/repos/zephyrproject-rtos/zephyr/tarball/${version}`;
  const tarballPath = join(destDir, `${version}.tar.gz`);
  const extractDir = join(destDir, "src");

  if (existsSync(extractDir)) {
    log(`Source already extracted at ${extractDir}`);
    return extractDir;
  }

  if (!existsSync(tarballPath)) {
    log(`Downloading ${version} from GitHub...`);
    execSync(`curl -sL -o "${tarballPath}" "${url}"`, {
      stdio: "inherit",
      timeout: 300_000,
    });
  }

  log(`Extracting to ${extractDir}...`);
  mkdirSync(extractDir, { recursive: true });
  execSync(`tar xzf "${tarballPath}" -C "${extractDir}" --strip-components=1`, {
    stdio: "inherit",
    timeout: 120_000,
  });

  return extractDir;
}

// --- Main ---

interface BuildOptions {
  version: string;
  doxygenDir?: string;
  sourceDir?: string;
  cacheDir: string;
}

async function buildIndex(opts: BuildOptions): Promise<string> {
  const { version, doxygenDir, sourceDir, cacheDir } = opts;

  const indexDir = join(cacheDir, version);
  mkdirSync(indexDir, { recursive: true });

  const dbPath = join(indexDir, "zephyr-index.db");
  const db = new ZephyrDatabase(dbPath);
  db.initialize();

  log(`Building index for Zephyr ${version}`);

  // 1. Parse Doxygen XML
  if (doxygenDir && existsSync(doxygenDir)) {
    log(`Parsing Doxygen XML from: ${doxygenDir}`);
    const result = parseDoxygenDirectory(doxygenDir);
    if (result.functions.length > 0) {
      db.insertFunctionsBatch(result.functions);
      log(`  \u2192 ${result.functions.length} functions indexed`);
    } else {
      log(`  \u2192 No functions found in Doxygen XML`);
      log(`  Tip: Ensure the directory contains Doxygen XML output files`);
    }
  } else {
    log(`No Doxygen XML directory provided — skipping API function indexing`);
    log(`  Pass --doxygen <path> with Doxygen XML files to index functions`);
  }

  // 2. Parse Kconfig files
  let kconfigCount = 0;
  if (sourceDir && existsSync(sourceDir)) {
    log(`Parsing Kconfig symbols from: ${sourceDir}`);
    const kconfigRows = parseKconfigTree(sourceDir);
    if (kconfigRows.length > 0) {
      db.insertKconfigsBatch(kconfigRows);
      kconfigCount = kconfigRows.length;
      log(`  \u2192 ${kconfigCount} Kconfig symbols indexed`);
    } else {
      log(`  \u2192 No Kconfig symbols found`);
    }
  } else {
    log(`No source directory provided — skipping Kconfig indexing`);
  }

  // 3. Parse DT bindings
  let dtCount = 0;
  if (sourceDir && existsSync(sourceDir)) {
    log(`Parsing Devicetree bindings from: ${sourceDir}`);
    const dtRows = parseDtBindingsTree(sourceDir);
    if (dtRows.length > 0) {
      db.insertDtBindingsBatch(dtRows);
      dtCount = dtRows.length;
      log(`  \u2192 ${dtCount} DT bindings indexed`);
    } else {
      log(`  \u2192 No DT bindings found`);
    }
  }

  // 4. Rebuild FTS indexes
  log(`Rebuilding FTS search indexes...`);
  db.rebuildFts();

  // 5. Write metadata
  db.setMeta("version", version);
  db.setMeta("built_at", new Date().toISOString());

  const fnCount = db.getMeta("version") ? "done" : "unknown";
  writeFileSync(
    join(indexDir, "meta.json"),
    JSON.stringify({ version, built_at: new Date().toISOString() }, null, 2)
  );

  db.close();
  log(`\nIndex built successfully:`);
  log(`  Location: ${dbPath}`);
  log(`  Kconfig symbols: ${kconfigCount}`);
  log(`  DT bindings: ${dtCount}`);
  return dbPath;
}

// --- CLI ---

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  const doxygenIdx = args.indexOf("--doxygen");
  const doxygenDir = doxygenIdx >= 0 ? args[doxygenIdx + 1] : undefined;

  const sourceIdx = args.indexOf("--source");
  const sourceDir = sourceIdx >= 0 ? args[sourceIdx + 1] : undefined;

  const version = args.find((a) => !a.startsWith("--")) ?? (await fetchLatestVersion());

  const options: BuildOptions = {
    version,
    doxygenDir,
    sourceDir,
    cacheDir: getCacheDir(),
  };

  log(`Version: ${version}, doxygen=${doxygenDir ?? "none"}, source=${sourceDir ?? "none"}`);

  const dbPath = await buildIndex(options);
  console.log(dbPath);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
