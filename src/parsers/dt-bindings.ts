import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";
import { load } from "js-yaml";
import { DtBindingRow } from "../db.js";

/**
 * Parse a single Devicetree binding YAML file and extract binding info.
 */
export function parseDtBindingFile(
  filePath: string,
  repoRoot: string
): DtBindingRow | null {
  const content = readFileSync(filePath, "utf-8");

  let parsed: Record<string, unknown>;
  try {
    parsed = load(content) as Record<string, unknown>;
  } catch {
    return null; // Not valid YAML
  }

  if (!parsed || typeof parsed !== "object") return null;
  if (!("compatible" in parsed) || typeof parsed.compatible !== "string") {
    // This binding may include others but has no compatible string — skip
    return null;
  }

  const compatible = parsed.compatible;
  const description =
    typeof parsed.description === "string" ? parsed.description : null;
  const properties =
    parsed.properties && typeof parsed.properties === "object"
      ? JSON.stringify(parsed.properties)
      : null;
  const childBinding =
    parsed["child-binding"] && typeof parsed["child-binding"] === "object"
      ? JSON.stringify(parsed["child-binding"])
      : null;
  const bus = typeof parsed.bus === "string" ? parsed.bus : null;
  const onBus = typeof parsed["on-bus"] === "string" ? parsed["on-bus"] : null;
  const path = relative(repoRoot, filePath);

  return {
    compatible,
    description,
    properties,
    child_binding: childBinding,
    bus,
    on_bus: onBus,
    path,
  };
}

/**
 * Parse all DT binding YAML files in a directory tree.
 */
export function parseDtBindingsTree(repoRoot: string): DtBindingRow[] {
  const allRows: DtBindingRow[] = [];
  const visited = new Set<string>();

  function walkDir(dirPath: string): void {
    if (!existsSync(dirPath)) return;
    const entries = readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);

      // Avoid hidden dirs and build directories
      if (entry.name.startsWith(".")) continue;
      if (entry.name === "build") continue;

      if (entry.isDirectory()) {
        walkDir(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".yaml")) {
        const absPath = fullPath;
        if (visited.has(absPath)) continue;
        visited.add(absPath);
        try {
          const row = parseDtBindingFile(absPath, repoRoot);
          if (row) allRows.push(row);
        } catch {
          continue;
        }
      }
    }
  }

  walkDir(repoRoot);
  return allRows;
}
