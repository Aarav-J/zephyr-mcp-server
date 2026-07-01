/**
 * Minimal Kconfig parser that extracts symbols from Kconfig* files.
 * Uses regex-based extraction — not as accurate as kconfiglib, but
 * captures the vast majority of symbols in Zephyr's Kconfig tree.
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { KconfigRow } from "../db.js";

const CONFIG_RE = /^config\s+(\w+)/m;
const TYPE_RE = /^\s*(bool|string|int|hex|tristate)\s*(.*)$/m;
const PROMPT_RE = /^\s*prompt\s+"(.+?)"/m;
const DEFAULT_RE = /^\s*default\s+(.+?)(?:\s+if\s+.+)?$/m;
const DEPENDS_RE = /^\s*depends\s+on\s+(.+)$/m;
const SELECT_RE = /^\s*select\s+(\w+)/m;
const RANGE_RE = /^\s*range\s+(\S+)\s+(\S+)/m;
const HELP_RE = /^\s*help$/m;
const SOURCE_RE = /^source\s+\"(.+?)\"/m;
const MENU_RE = /^(menu|if|choice|endmenu|endif|endchoice)\b/m;

/** Check if a file is a Kconfig file by name. */
function isKconfigFile(name: string): boolean {
  return name.startsWith("Kconfig") || name.startsWith("Kconfig.");
}

/**
 * Parse a single Kconfig file and extract config symbols.
 * This is a simplified parser — it doesn't handle the full Kconfig grammar.
 */
export function parseKconfigFile(
  filePath: string,
  repoRoot: string
): KconfigRow[] {
  const rows: KconfigRow[] = [];
  const content = readFileSync(filePath, "utf-8");
  const lines = content.split("\n");

  const relPath = relative(repoRoot, filePath);
  let i = 0;
  const len = lines.length;

  while (i < len) {
    const line = lines[i].trim();

    // Check for config symbol start
    const configMatch = line.match(CONFIG_RE);
    if (configMatch) {
      const name = `CONFIG_${configMatch[1]}`;
      i++;

      // Collect attributes until next config/menu/source/end-of-file
      let type: string | null = null;
      let prompt: string | null = null;
      let defaultVal: string | null = null;
      let dependsOn: string[] = [];
      let selects: string[] = [];
      let rangeMin: string | null = null;
      let rangeMax: string | null = null;
      let helpLines: string[] = [];
      let inHelp = false;

      while (i < len) {
        const attrLine = lines[i].trim();

        // Stop at next config, menu keyword, or source
        if (CONFIG_RE.test(attrLine) || MENU_RE.test(attrLine) || SOURCE_RE.test(attrLine)) {
          break;
        }

        // Skip source lines embedded in config
        if (attrLine.startsWith("source ")) {
          break;
        }

        // In help text, collect lines
        if (inHelp) {
          if (attrLine === "" || attrLine.startsWith(" ") || attrLine.startsWith("\t")) {
            helpLines.push(lines[i]);
            i++;
            continue;
          } else {
            inHelp = false;
            // Don't break — may be another attribute
            continue;
          }
        }

        // Type (bool, string, int, hex, tristate)
        const typeMatch = attrLine.match(TYPE_RE);
        if (typeMatch) {
          type = typeMatch[1];
          // Prompt may be on same line or separate
          if (typeMatch[2].trim().startsWith('"')) {
            const promptMatch = typeMatch[2].trim().match(/^"(.+?)"/);
            if (promptMatch) prompt = promptMatch[1];
          }
          i++;
          continue;
        }

        // Prompt
        const promptMatch = attrLine.match(PROMPT_RE);
        if (promptMatch) {
          prompt = promptMatch[1];
          i++;
          continue;
        }

        // Default
        const defaultMatch = attrLine.match(DEFAULT_RE);
        if (defaultMatch) {
          defaultVal = defaultMatch[1].trim();
          i++;
          continue;
        }

        // Depends on
        const dependsMatch = attrLine.match(DEPENDS_RE);
        if (dependsMatch) {
          const deps = dependsMatch[1]
            .split(/&&|\|\|/)
            .map((d: string) => d.trim().replace(/^!/, ""))
            .filter((d: string) => d.length > 0 && d !== "y" && d !== "n")
            .map((d: string) => (d.startsWith("CONFIG_") ? d : `CONFIG_${d}`));
          dependsOn.push(...deps);
          i++;
          continue;
        }
        // Range
        const rangeMatch = attrLine.match(RANGE_RE);
        if (rangeMatch) {
          rangeMin = rangeMatch[1];
          rangeMax = rangeMatch[2];
          i++;
          continue;
        }

        // Help start
        if (HELP_RE.test(attrLine)) {
          inHelp = true;
          i++;
          continue;
        }

        i++;
      }

      rows.push({
        name,
        type,
        prompt,
        default_val: defaultVal,
        depends_on: dependsOn.length > 0 ? JSON.stringify(dependsOn) : null,
        select_list: selects.length > 0 ? JSON.stringify(selects) : null,
        range_min: rangeMin,
        range_max: rangeMax,
        help_text: helpLines.length > 0 ? helpLines.join("\n").trim() : null,
        path: relPath,
      });

      continue;
    }

    i++;
  }

  return rows;
}

/**
 * Parse all Kconfig files in a directory tree.
 */
export function parseKconfigTree(repoRoot: string): KconfigRow[] {
  const allRows: KconfigRow[] = [];
  const visited = new Set<string>();

  function walkDir(dirPath: string): void {
    if (!existsSync(dirPath)) return;
    const entries = readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);
      const relPath = relative(repoRoot, fullPath);

      // Avoid symlinks, hidden dirs, build directories
      if (entry.name.startsWith(".")) continue;
      if (entry.name === "build") continue;
      if (entry.name === "modules") continue; // external modules

      if (entry.isDirectory()) {
        walkDir(fullPath);
      } else if (entry.isFile() && isKconfigFile(entry.name)) {
        if (visited.has(relPath)) continue;
        visited.add(relPath);
        try {
          const rows = parseKconfigFile(fullPath, repoRoot);
          allRows.push(...rows);
        } catch (err) {
          // Silently skip unparseable files
          continue;
        }
      }
    }
  }

  walkDir(repoRoot);
  return allRows;
}
