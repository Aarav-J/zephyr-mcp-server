#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { ZephyrDatabase, getCacheDir, FunctionRow } from "./db.js";
import { existsSync, readdirSync } from "node:fs";
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
    .reverse(); // newest first

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
        // corrupt index, try next
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

// --- Request handlers ---

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [GET_FUNCTION_SIGNATURE_TOOL],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const tool = request.params.name;
  const args = request.params.arguments ?? {};

  switch (tool) {
    case "get_function_signature": {
      const name = String(args.name ?? "");
      if (!name) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "Missing required argument: name"
        );
      }

      if (!db) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  name,
                  error: "No index loaded. Run `npm run build-index` to build the Zephyr docs index first.",
                },
                null,
                2
              ),
            },
          ],
        };
      }

      const fn = db.getFunctionByName(name);
      if (!fn) {
        // Try prefix search via FTS
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

    default:
      throw new McpError(
        ErrorCode.MethodNotFound,
        `Unknown tool: ${tool}`
      );
  }
});

// --- Start ---

async function main() {
  loadLatestIndex();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Zephyr MCP server started on stdio");
  if (db) {
    console.error(`Active index: ${currentVersion}`);
    const fnCount = 1; // will add proper count from meta later
    console.error(`  Functions: ${fnCount} entries`);
  } else {
    console.error("No index loaded. Run `npm run build-index` to build one.");
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
