import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

export interface SampleRow {
  id?: number;
  name: string;
  description: string | null;
  path: string;
  prj_conf: string | null;
  overlay: string | null;
  boards: string | null; // JSON array of board-specific config names
  category: string | null; // e.g. "drivers/gpio", "kernel"
  doc_url: string | null;
}

/** Parse a sample.yaml or README for description */
function extractDescription(sampleDir: string): string | null {
  // Try sample.yaml first
  const yamlPath = join(sampleDir, "sample.yaml");
  if (existsSync(yamlPath)) {
    try {
      const content = readFileSync(yamlPath, "utf-8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.startsWith("description:")) {
          return trimmed.slice("description:".length).trim().replace(/^"(.*)"$/, "$1");
        }
      }
    } catch {
      // fall through
    }
  }

  // Try README.rst
  const rstPath = join(sampleDir, "README.rst");
  if (existsSync(rstPath)) {
    try {
      const lines = readFileSync(rstPath, "utf-8").split("\n");
      // First non-empty, non-heading line
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith("=") && !trimmed.startsWith("-") && !trimmed.startsWith("..")) {
          return trimmed.slice(0, 200);
        }
      }
    } catch {
      // fall through
    }
  }

  return null;
}

/** Read prj.conf from a sample directory */
function readPrjConf(sampleDir: string): string | null {
  const prjPath = join(sampleDir, "prj.conf");
  if (existsSync(prjPath)) {
    try {
      return readFileSync(prjPath, "utf-8");
    } catch {
      return null;
    }
  }
  return null;
}

/** Read app.overlay from a sample directory */
function readOverlay(sampleDir: string): string | null {
  const overlayPath = join(sampleDir, "app.overlay");
  if (existsSync(overlayPath)) {
    try {
      return readFileSync(overlayPath, "utf-8");
    } catch {
      return null;
    }
  }
  return null;
}

/** Find board-specific configs (prj_<board>.conf) */
function findBoardConfigs(sampleDir: string): string[] {
  if (!existsSync(sampleDir)) return [];
  const boards: string[] = [];
  try {
    const entries = readdirSync(sampleDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.startsWith("prj_") && entry.name.endsWith(".conf")) {
        const board = entry.name.slice(4, -5); // prj_<board>.conf → <board>
        boards.push(board);
      }
    }
  } catch {
    // ignore
  }
  return boards;
}

/** Determine sample category from its path relative to samples/ */
function extractCategory(samplePath: string, repoRoot: string): string | null {
  const rel = relative(repoRoot, samplePath);
  // Path is like: samples/drivers/gpio/blinky
  const parts = rel.split("/");
  if (parts.length >= 3 && parts[0] === "samples") {
    return parts.slice(1, -1).join("/"); // e.g. "drivers/gpio"
  }
  return null;
}

/**
 * Parse all samples in a Zephyr source tree.
 * Walks samples/<category>/<sample>/ directories.
 */
export function parseSamplesTree(repoRoot: string): SampleRow[] {
  const allRows: SampleRow[] = [];
  const samplesDir = join(repoRoot, "samples");

  if (!existsSync(samplesDir)) return allRows;

  try {
    const categories = readdirSync(samplesDir, { withFileTypes: true });

    for (const cat of categories) {
      if (!cat.isDirectory() || cat.name.startsWith(".")) continue;
      const catPath = join(samplesDir, cat.name);

      try {
        const sampleDirs = readdirSync(catPath, { withFileTypes: true });

        for (const sample of sampleDirs) {
          if (!sample.isDirectory() || sample.name.startsWith(".")) continue;
          const samplePath = join(catPath, sample.name);

          // Skip samples with no prj.conf — they're likely README-only or submodules
          const prjConf = readPrjConf(samplePath);
          if (!prjConf && !existsSync(join(samplePath, "app.overlay"))) {
            // Still include if they have a sample.yaml
            if (!existsSync(join(samplePath, "sample.yaml"))) continue;
          }

          allRows.push({
            name: sample.name,
            description: extractDescription(samplePath),
            path: relative(repoRoot, samplePath),
            prj_conf: prjConf,
            overlay: readOverlay(samplePath),
            boards: (() => {
              const boards = findBoardConfigs(samplePath);
              return boards.length > 0 ? JSON.stringify(boards) : null;
            })(),
            category: extractCategory(samplePath, repoRoot),
            doc_url: `https://docs.zephyrproject.org/latest/samples/${cat.name}/${sample.name}/README.html`,
          });
        }
      } catch {
        continue;
      }
    }
  } catch {
    // ignore
  }

  return allRows;
}
