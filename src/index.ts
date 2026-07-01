#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { ZephyrDatabase, getCacheDir, FunctionRow, KconfigRow, DtBindingRow } from "./db.js";
import { existsSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// --- Database loading ---

let db: ZephyrDatabase | null = null;
let currentVersion: string | null = null;

function loadLatestIndex(): void {
  const cacheDir = getCacheDir();
  if (!existsSync(cacheDir)) return;

  const entries = readdirSync(cacheDir, { withFileTypes: true });
  const versionDirs = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
    .reverse();

  for (const ver of versionDirs) {
    const dbPath = join(cacheDir, ver, "zephyr-index.db");
    if (existsSync(dbPath)) {
      try {
        const candidate = new ZephyrDatabase(dbPath);
        const stored = candidate.getMeta("version");
        if (stored) {
          db = candidate;
          currentVersion = stored;
          console.error(`Loaded index: ${stored} from ${dbPath}`);
          return;
        }
        candidate.close();
      } catch {
        continue;
      }
    }
  }
}

// --- Server setup ---

const server = new Server(
  { name: "@personalhermes/zephyr-mcp-server", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

// --- Tool definitions ---

const GET_FUNCTION_SIGNATURE_TOOL = {
  name: "get_function_signature",
  description:
    "Look up the exact C function or macro signature, parameters, return type, and header location from Zephyr's Doxygen API docs.",
  inputSchema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Function or macro name (e.g. k_sem_take, GPIO_DT_SPEC_GET)",
      },
      version: {
        type: "string",
        description: "Zephyr version tag (e.g. v4.1.0). Defaults to latest cached.",
      },
    },
    required: ["name"],
  },
};

const FIND_KCONFIG_TOOL = {
  name: "find_kconfig",
  description:
    "Search Zephyr Kconfig symbols by name or description. Returns matching symbols with their type, prompt, default value, and dependency chain.",
  inputSchema: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description: "Search pattern (e.g. GPIO, CONFIG_I2C, USB)",
      },
      limit: {
        type: "number",
        description: "Maximum results. Default 10, max 50.",
        default: 10,
      },
      version: {
        type: "string",
        description: "Zephyr version tag. Defaults to latest cached.",
      },
    },
    required: ["pattern"],
  },
};

const GET_DT_BINDING_TOOL = {
  name: "get_dt_binding",
  description:
    "Look up a Devicetree binding by compatible string. Returns the binding schema including required and optional properties, bus information, and child bindings.",
  inputSchema: {
    type: "object",
    properties: {
      compatible: {
        type: "string",
        description: "Devicetree compatible string (e.g. st,stm32-i2c, arm,cortex-m4)",
      },
      version: {
        type: "string",
        description: "Zephyr version tag. Defaults to latest cached.",
      },
    },
    required: ["compatible"],
  },
};

const SEARCH_DOCS_TOOL = {
  name: "search_docs",
  description:
    "Full-text search across Zephyr documentation, API reference, Kconfig help text, and DT binding descriptions.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Search query (e.g. 'semaphore timeout', 'gpio interrupt', 'i2c stm32')",
      },
      domain: {
        type: "string",
        description: "Scope: 'api', 'kconfig', 'dt', or omit for all",
        enum: ["api", "kconfig", "dt"],
      },
      limit: {
        type: "number",
        description: "Maximum results. Default 10, max 30.",
        default: 10,
      },
      version: {
        type: "string",
        description: "Zephyr version tag. Defaults to latest cached.",
      },
    },
    required: ["query"],
  },
};

// --- Request handlers ---

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    GET_FUNCTION_SIGNATURE_TOOL,
    FIND_KCONFIG_TOOL,
    GET_DT_BINDING_TOOL,
    SEARCH_DOCS_TOOL,
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const tool = request.params.name;
  const args = request.params.arguments ?? {};

  if (!db) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              error: "No index loaded.",
              hint: "Run `npx tsx scripts/build-index.ts --source /path/to/zephyr` to build the index first.",
            },
            null,
            2
          ),
        },
      ],
    };
  }

  switch (tool) {
    // --- get_function_signature ---
    case "get_function_signature": {
      const name = String(args.name ?? "");
      if (!name) {
        throw new McpError(ErrorCode.InvalidParams, "Missing required argument: name");
      }

      const fn = db.getFunctionByName(name);
      if (!fn) {
        const results = db.searchFunctions(name, 5);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  name,
                  found: false,
                  suggestions: results
                    .filter((r: FunctionRow) => r.name.toLowerCase() !== name.toLowerCase())
                    .map((r: FunctionRow) => ({
                      name: r.name,
                      signature: r.signature,
                      header: r.header,
                    })),
                  version: currentVersion,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                name: fn.name,
                signature: fn.signature,
                brief: fn.brief,
                params: fn.params ? JSON.parse(fn.params) : [],
                return_type: fn.return_type,
                return_desc: fn.return_desc,
                header: fn.header,
                section: fn.section,
                version: currentVersion,
              },
              null,
              2
            ),
          },
        ],
      };
    }

    // --- find_kconfig ---
    case "find_kconfig": {
      const pattern = String(args.pattern ?? "");
      if (!pattern) {
        throw new McpError(ErrorCode.InvalidParams, "Missing required argument: pattern");
      }

      const limit = Math.min(Math.max(Number(args.limit ?? 10), 1), 50);
      const results = db.searchKconfig(pattern, limit);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                pattern,
                found: results.length > 0,
                count: results.length,
                results: results.map((r: KconfigRow) => ({
                  name: r.name,
                  type: r.type,
                  prompt: r.prompt,
                  default: r.default_val,
                  depends_on: r.depends_on ? JSON.parse(r.depends_on) : [],
                  path: r.path,
                })),
                version: currentVersion,
              },
              null,
              2
            ),
          },
        ],
      };
    }

    // --- get_dt_binding ---
    case "get_dt_binding": {
      const compatible = String(args.compatible ?? "");
      if (!compatible) {
        throw new McpError(ErrorCode.InvalidParams, "Missing required argument: compatible");
      }

      // Try exact match first (avoids FTS5 comma syntax issues)
      let binding = db.getBindingByCompatible(compatible);

      if (!binding) {
        // Fall back to FTS search
        const results = db.searchBindings(compatible, 5);
        binding = results.find((r: DtBindingRow) => r.compatible === compatible) ?? results[0] ?? null;
      }

      if (!binding) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  compatible,
                  found: false,
                  suggestions: [],
                  version: currentVersion,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                compatible: binding.compatible,
                description: binding.description,
                properties: binding.properties ? JSON.parse(binding.properties) : null,
                child_binding: binding.child_binding ? JSON.parse(binding.child_binding) : null,
                bus: binding.bus,
                on_bus: binding.on_bus,
                path: binding.path,
                version: currentVersion,
              },
              null,
              2
            ),
          },
        ],
      };
    }

    // --- search_docs ---
    case "search_docs": {
      const query = String(args.query ?? "");
      if (!query) {
        throw new McpError(ErrorCode.InvalidParams, "Missing required argument: query");
      }

      const domain = String(args.domain ?? "");
      const limit = Math.min(Math.max(Number(args.limit ?? 10), 1), 30);

      type SearchResult = {
        domain: string;
        title: string;
        snippet: string;
        path?: string;
      };

      const allResults: SearchResult[] = [];

      if (!domain || domain === "api") {
        const fnResults = db.searchFunctions(query, limit);
        for (const r of fnResults as FunctionRow[]) {
          allResults.push({
            domain: "api",
            title: r.name,
            snippet: r.signature,
            path: r.header ?? undefined,
          });
        }
      }

      if (!domain || domain === "kconfig") {
        const kcResults = db.searchKconfig(query, limit);
        for (const r of kcResults as KconfigRow[]) {
          allResults.push({
            domain: "kconfig",
            title: r.name,
            snippet: r.prompt ?? r.help_text ?? "",
            path: r.path ?? undefined,
          });
        }
      }

      if (!domain || domain === "dt") {
        const dtResults = db.searchBindings(query, limit);
        for (const r of dtResults as DtBindingRow[]) {
          allResults.push({
            domain: "dt",
            title: r.compatible,
            snippet: r.description ?? "",
            path: r.path ?? undefined,
          });
        }
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                query,
                count: allResults.length,
                results: allResults.slice(0, limit),
                version: currentVersion,
              },
              null,
              2
            ),
          },
        ],
      };
    }

    default:
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${tool}`);
  }
});

// --- Start ---

// --- Version check ---

const GITHUB_API = "https://api.github.com/repos/zephyrproject-rtos/zephyr/releases/latest";

async function checkLatestVersion(): Promise<string | null> {
  try {
    const resp = await fetch(GITHUB_API, {
      headers: { "Accept": "application/vnd.github.v3+json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as { tag_name: string };
    return data.tag_name;
  } catch {
    return null;
  }
}

// --- Start ---

async function downloadPrebuiltIndex(): Promise<ZephyrDatabase | null> {
  const REPO = "Aarav-J/zephyr-mcp-server";
  const RELEASES_API = `https://api.github.com/repos/${REPO}/releases/latest`;

  try {
    console.error("[download] Checking for pre-built index...");
    const resp = await fetch(RELEASES_API, {
      headers: { "Accept": "application/vnd.github.v3+json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) {
      console.error(`[download] Failed to fetch release info: ${resp.status}`);
      return null;
    }

    const data = (await resp.json()) as {
      tag_name: string;
      assets: { name: string; browser_download_url: string }[];
    };

    // Find the index asset
    const asset = data.assets.find((a) => a.name.endsWith(".db"));
    if (!asset) {
      console.error("[download] No index asset found in latest release");
      return null;
    }

    console.error(`[download] Downloading ${asset.name}...`);
    const dbResp = await fetch(asset.browser_download_url, {
      signal: AbortSignal.timeout(60_000),
    });
    if (!dbResp.ok) {
      console.error(`[download] Download failed: ${dbResp.status}`);
      return null;
    }

    const buffer = await dbResp.arrayBuffer();
    const cacheDir = getCacheDir();
    const versionDir = join(cacheDir, data.tag_name);
    mkdirSync(versionDir, { recursive: true });
    const dbPath = join(versionDir, "zephyr-index.db");
    writeFileSync(dbPath, Buffer.from(buffer));

    console.error(`[download] Saved index to ${dbPath}`);
    const loaded = new ZephyrDatabase(dbPath);
    const stored = loaded.getMeta("version");
    if (stored) {
      db = loaded;
      currentVersion = stored;
      console.error(`[download] Loaded index: ${stored}`);
      return loaded;
    }
    loaded.close();
    return null;
  } catch (err) {
    console.error(`[download] Error: ${err}`);
    return null;
  }
}

// --- Start ---

async function main() {
  // Try local cache first
  loadLatestIndex();

  // If no local index, download pre-built one
  if (!db) {
    console.error("No local index found. Attempting to download pre-built index...");
    await downloadPrebuiltIndex();
  }

  // Fire-and-forget version check
  checkLatestVersion().then((latest) => {
    if (latest && currentVersion && latest !== currentVersion) {
      console.error(`[update] New Zephyr release: ${latest} (cached: ${currentVersion})`);
      console.error(`[update] Run: cd zephyr-mcp-server && npm run build-index ${latest}`);
    } else if (latest && !currentVersion) {
      console.error(`[update] Latest Zephyr release: ${latest}`);
      console.error(`[update] Run: cd zephyr-mcp-server && npm run build-index ${latest}`);
    } else if (latest && latest === currentVersion) {
      console.error(`[update] Index is up-to-date (${latest})`);
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Zephyr MCP server started on stdio");
  if (db) {
    console.error(`Active index: ${currentVersion}`);
  } else {
    console.error("No index loaded.");
    console.error("  If first run, the server should auto-download a pre-built index.");
    console.error("  Otherwise, run: git clone https://github.com/Aarav-J/zephyr-mcp-server.git");
    console.error("  Then: cd zephyr-mcp-server && npm install && npm run build");
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
