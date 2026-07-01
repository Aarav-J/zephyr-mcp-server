# Zephyr RTOS MCP Server

An MCP (Model Context Protocol) server that gives LLMs grounded access to Zephyr RTOS documentation — Kconfig symbols, Devicetree bindings, and API signatures. No more hallucinated driver structs or made-up Kconfig options.

## Quick Start

### Option 1: npx (no install)

```json
{
  "mcpServers": {
    "zephyr": {
      "command": "npx",
      "args": ["-y", "@aarav-j/zephyr-mcp-server"]
    }
  }
}
```

First startup auto-downloads the server + pre-built index (8.5 MB). Zero setup.

### Option 2: Clone from GitHub

```bash
git clone https://github.com/Aarav-J/zephyr-mcp-server.git
cd zephyr-mcp-server
npm install
npm run build
```

Add to your MCP client config (e.g. `~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "zephyr": {
      "command": "node",
      "args": ["/path/to/zephyr-mcp-server/dist/index.js"]
    }
  }
}
```

## Tools

### `get_function_signature`

Look up exact C function or macro signatures, parameters, return types, and header locations.

```
Arguments:
  name      — Function or macro name (e.g. k_sem_take, GPIO_DT_SPEC_GET)
  version?  — Zephyr version tag. Defaults to latest cached.

Returns:
  - signature    — Exact C signature with types
  - brief        — One-line description
  - params       — Typed parameter list with descriptions
  - return_type  — Return type
  - return_desc  — Return value description
  - header       — Declaring header file
  - section      — Doxygen group/section
```

> Requires Doxygen XML output to be indexed (see Building a Full Index).

### `find_kconfig`

Search Zephyr Kconfig symbols by name or description.

```
Arguments:
  pattern   — Search string (e.g. GPIO, CONFIG_I2C, USB)
  limit?    — Max results. Default 10, max 50.
  version?  — Zephyr version tag.

Returns:
  - name         — Symbol name (CONFIG_*)
  - type         — bool, string, int, hex, tristate
  - prompt       — User-visible prompt text
  - default      — Default value
  - depends_on   — Dependency symbol chain
  - path         — File path in Zephyr tree
```

### `get_dt_binding`

Look up a Devicetree binding by compatible string.

```
Arguments:
  compatible — Compatible string (e.g. st,stm32-i2c, arm,cortex-m4)
  version?   — Zephyr version tag.

Returns:
  - compatible    — Compatible string
  - description   — Binding description
  - properties    — Schema with types, required/optional status, defaults
  - child_binding — Child binding schema (if any)
  - bus           — Bus type this binding provides
  - on_bus        — Bus this binding lives on
  - path          — YAML file path in Zephyr tree
```

### `search_docs`

Full-text search across indexed documentation domains.

```
Arguments:
  query     — Search query (e.g. "semaphore", "i2c stm32", "gpio interrupt")
  domain?   — Scope: "api", "kconfig", "dt", or omit for all
  limit?    — Max results. Default 10, max 30.
  version?  — Zephyr version tag.

Returns:
  - query    — Original query
  - count    — Total results found
  - results  — Ranked list of { domain, title, snippet, path }
```

## Index

### Pre-built Index (auto-downloaded)

The server automatically downloads a pre-built index from GitHub Releases on first startup. The current index covers:

| Data | Count |
|---|---|
| Kconfig symbols | 24,118 |
| Devicetree bindings | 3,553 |
| Index size | 8.5 MB |

This is enough for the `find_kconfig`, `get_dt_binding`, and `search_docs` tools to work immediately.

### Building a Full Index (with API signatures)

To also index function signatures, you need Doxygen XML output from Zephyr's documentation build:

```bash
# Option 1: Build Zephyr docs yourself
# (requires a full Zephyr build environment)
cd /path/to/zephyr
west build -t doxygen
# Doxygen XML will be in build/zephyr-doc/xml/

# Option 2: Use the pre-built docs source
npx tsx scripts/build-index.ts v4.4.1 \
  --source /path/to/zephyr \
  --doxygen /path/to/zephyr/build/zephyr-doc/xml/
```

### Building from Source

If you want to build the index from a specific Zephyr release:

```bash
# Download and index Kconfig + DT bindings from Zephyr source
npx tsx scripts/build-index.ts v4.4.1 --source /path/to/zephyr
```

The CLI accepts a local Zephyr source directory. On first run against a new version, it will download the Zephyr source tarball automatically.

## Version Management

The server checks for new Zephyr releases on startup and logs a message when one is available:

```
[update] New Zephyr release: v4.5.0 (cached: v4.4.1)
[update] Run: cd zephyr-mcp-server && npm run build-index v4.5.0
```

## Architecture

```
zephyr-mcp-server/
├── src/
│   ├── index.ts                 # MCP server + tool handlers
│   ├── db.ts                    # SQLite FTS5 database layer
│   └── parsers/
│       ├── doxygen.ts           # Doxygen XML → FunctionRow[]
│       ├── kconfig.ts           # Kconfig → KconfigRow[]
│       └── dt-bindings.ts       # YAML bindings → DtBindingRow[]
├── scripts/
│   └── build-index.ts           # Index builder CLI
├── dist/                        # Compiled output
└── test/
    └── fixtures/                # Test fixtures
```

## Development

```bash
npm run build      # Compile TypeScript
npm run start      # Start MCP server on stdio
npm run build-index <version> --source <path>   # Build index
```

## Contributing

PRs welcome. Key areas for improvement:

- **Doxygen XML fetching** — Automate downloading or building Doxygen XML for pre-built index releases
- **Kconfig parser quality** — Current parser is regex-based; switching to kconfiglib (Python) would improve accuracy
- **RST docs chunking** — Parse Zephyr's RST documentation for richer prose search results
- **CI pipeline** — GitHub Action to auto-build indexes on new Zephyr releases

## License

MIT

---

Built for [Oh My Pi](https://github.com/Aarav-J/personal_hermes) club.
