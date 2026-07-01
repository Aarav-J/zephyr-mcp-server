import Database from "better-sqlite3";
import { mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// --- Types ---

export interface FunctionRow {
  id?: number;
  name: string;
  signature: string;
  brief: string | null;
  description: string | null;
  params: string | null; // JSON array
  return_type: string | null;
  return_desc: string | null;
  header: string | null;
  section: string | null;
  group_id: string | null;
}

export interface KconfigRow {
  id?: number;
  name: string;
  type: string | null;
  prompt: string | null;
  default_val: string | null;
  depends_on: string | null; // JSON array
  select_list: string | null; // JSON array
  range_min: string | null;
  range_max: string | null;
  help_text: string | null;
  path: string | null;
}

export interface DtBindingRow {
  id?: number;
  compatible: string;
  description: string | null;
  properties: string | null; // JSON
  child_binding: string | null; // JSON
  bus: string | null;
  on_bus: string | null;
  path: string | null;
}

export interface DocChunkRow {
  id?: number;
  title: string | null;
  heading_path: string | null;
  body: string | null;
  source_url: string | null;
  domain: string | null;
}

// --- Database Manager ---

export function getCacheDir(): string {
  const dir = join(homedir(), ".zephyr-mcp", "indexes");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export class ZephyrDatabase {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
  }

  /** Create or migrate schema. Idempotent. */
  initialize(): void {
    this.db.exec(`
      -- Functions table
      CREATE TABLE IF NOT EXISTS functions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        signature TEXT NOT NULL,
        brief TEXT,
        description TEXT,
        params TEXT,
        return_type TEXT,
        return_desc TEXT,
        header TEXT,
        section TEXT,
        group_id TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_functions_name ON functions(name);

      -- Kconfig symbols table
      CREATE TABLE IF NOT EXISTS kconfig_symbols (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        type TEXT,
        prompt TEXT,
        default_val TEXT,
        depends_on TEXT,
        select_list TEXT,
        range_min TEXT,
        range_max TEXT,
        help_text TEXT,
        path TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_kconfig_name ON kconfig_symbols(name);

      -- Devicetree bindings table
      CREATE TABLE IF NOT EXISTS dt_bindings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        compatible TEXT NOT NULL,
        description TEXT,
        properties TEXT,
        child_binding TEXT,
        bus TEXT,
        on_bus TEXT,
        path TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_dt_compatible ON dt_bindings(compatible);

      -- Docs chunks table
      CREATE TABLE IF NOT EXISTS docs_chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT,
        heading_path TEXT,
        body TEXT,
        source_url TEXT,
        domain TEXT
      );

      -- FTS indexes
      CREATE VIRTUAL TABLE IF NOT EXISTS functions_fts USING fts5(
        name, signature, brief, description, params,
        content='functions',
        content_rowid='id'
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS kconfig_fts USING fts5(
        name, prompt, help_text,
        content='kconfig_symbols',
        content_rowid='id'
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS dt_fts USING fts5(
        compatible, description, properties,
        content='dt_bindings',
        content_rowid='id'
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(
        title, heading_path, body,
        content='docs_chunks',
        content_rowid='id'
      );

      -- Meta table for version tracking
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  // --- Insert helpers ---

  insertFunction(row: FunctionRow): void {
    const stmt = this.db.prepare(
      `INSERT INTO functions (name, signature, brief, description, params, return_type, return_desc, header, section, group_id)
       VALUES (@name, @signature, @brief, @description, @params, @return_type, @return_desc, @header, @section, @group_id)`
    );
    stmt.run({
      name: row.name,
      signature: row.signature,
      brief: row.brief ?? null,
      description: row.description ?? null,
      params: row.params ?? null,
      return_type: row.return_type ?? null,
      return_desc: row.return_desc ?? null,
      header: row.header ?? null,
      section: row.section ?? null,
      group_id: row.group_id ?? null,
    });
  }

  insertFunctionsBatch(rows: FunctionRow[]): void {
    const stmt = this.db.prepare(
      `INSERT INTO functions (name, signature, brief, description, params, return_type, return_desc, header, section, group_id)
       VALUES (@name, @signature, @brief, @description, @params, @return_type, @return_desc, @header, @section, @group_id)`
    );
    const txn = this.db.transaction((items: FunctionRow[]) => {
      for (const row of items) {
        stmt.run({
          name: row.name,
          signature: row.signature,
          brief: row.brief ?? null,
          description: row.description ?? null,
          params: row.params ?? null,
          return_type: row.return_type ?? null,
          return_desc: row.return_desc ?? null,
          header: row.header ?? null,
          section: row.section ?? null,
          group_id: row.group_id ?? null,
        });
      }
    });
    txn(rows);
  }

  insertKconfig(row: KconfigRow): void {
    const stmt = this.db.prepare(
      `INSERT INTO kconfig_symbols (name, type, prompt, default_val, depends_on, select_list, range_min, range_max, help_text, path)
       VALUES (@name, @type, @prompt, @default_val, @depends_on, @select_list, @range_min, @range_max, @help_text, @path)`
    );
    stmt.run({
      name: row.name,
      type: row.type ?? null,
      prompt: row.prompt ?? null,
      default_val: row.default_val ?? null,
      depends_on: row.depends_on ?? null,
      select_list: row.select_list ?? null,
      range_min: row.range_min ?? null,
      range_max: row.range_max ?? null,
      help_text: row.help_text ?? null,
      path: row.path ?? null,
    });
  }

  insertKconfigsBatch(rows: KconfigRow[]): void {
    const stmt = this.db.prepare(
      `INSERT INTO kconfig_symbols (name, type, prompt, default_val, depends_on, select_list, range_min, range_max, help_text, path)
       VALUES (@name, @type, @prompt, @default_val, @depends_on, @select_list, @range_min, @range_max, @help_text, @path)`
    );
    const txn = this.db.transaction((items: KconfigRow[]) => {
      for (const row of items) {
        stmt.run({
          name: row.name,
          type: row.type ?? null,
          prompt: row.prompt ?? null,
          default_val: row.default_val ?? null,
          depends_on: row.depends_on ?? null,
          select_list: row.select_list ?? null,
          range_min: row.range_min ?? null,
          range_max: row.range_max ?? null,
          help_text: row.help_text ?? null,
          path: row.path ?? null,
        });
      }
    });
    txn(rows);
  }

  insertDtBinding(row: DtBindingRow): void {
    const stmt = this.db.prepare(
      `INSERT INTO dt_bindings (compatible, description, properties, child_binding, bus, on_bus, path)
       VALUES (@compatible, @description, @properties, @child_binding, @bus, @on_bus, @path)`
    );
    stmt.run({
      compatible: row.compatible,
      description: row.description ?? null,
      properties: row.properties ?? null,
      child_binding: row.child_binding ?? null,
      bus: row.bus ?? null,
      on_bus: row.on_bus ?? null,
      path: row.path ?? null,
    });
  }

  insertDtBindingsBatch(rows: DtBindingRow[]): void {
    const stmt = this.db.prepare(
      `INSERT INTO dt_bindings (compatible, description, properties, child_binding, bus, on_bus, path)
       VALUES (@compatible, @description, @properties, @child_binding, @bus, @on_bus, @path)`
    );
    const txn = this.db.transaction((items: DtBindingRow[]) => {
      for (const row of items) {
        stmt.run({
          compatible: row.compatible,
          description: row.description ?? null,
          properties: row.properties ?? null,
          child_binding: row.child_binding ?? null,
          bus: row.bus ?? null,
          on_bus: row.on_bus ?? null,
          path: row.path ?? null,
        });
      }
    });
    txn(rows);
  }

  insertDocChunk(row: DocChunkRow): void {
    const stmt = this.db.prepare(
      `INSERT INTO docs_chunks (title, heading_path, body, source_url, domain)
       VALUES (@title, @heading_path, @body, @source_url, @domain)`
    );
    stmt.run({
      title: row.title ?? null,
      heading_path: row.heading_path ?? null,
      body: row.body ?? null,
      source_url: row.source_url ?? null,
      domain: row.domain ?? null,
    });
  }

  insertDocChunksBatch(rows: DocChunkRow[]): void {
    const stmt = this.db.prepare(
      `INSERT INTO docs_chunks (title, heading_path, body, source_url, domain)
       VALUES (@title, @heading_path, @body, @source_url, @domain)`
    );
    const txn = this.db.transaction((items: DocChunkRow[]) => {
      for (const row of items) {
        stmt.run({
          title: row.title ?? null,
          heading_path: row.heading_path ?? null,
          body: row.body ?? null,
          source_url: row.source_url ?? null,
          domain: row.domain ?? null,
        });
      }
    });
    txn(rows);
  }

  // --- FTS rebuild ---

  rebuildFts(): void {
    this.db.exec(`
      INSERT INTO functions_fts(rowid, name, signature, brief, description, params)
        SELECT id, name, signature, brief, description, params FROM functions;
      INSERT INTO kconfig_fts(rowid, name, prompt, help_text)
        SELECT id, name, prompt, help_text FROM kconfig_symbols;
      INSERT INTO dt_fts(rowid, compatible, description, properties)
        SELECT id, compatible, description, properties FROM dt_bindings;
      INSERT INTO docs_fts(rowid, title, heading_path, body)
        SELECT id, title, heading_path, body FROM docs_chunks;
    `);
  }

  // --- Meta ---

  setMeta(key: string, value: string): void {
    this.db
      .prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)")
      .run(key, value);
  }

  getMeta(key: string): string | undefined {
    const row = this.db
      .prepare("SELECT value FROM meta WHERE key = ?")
      .get(key) as { value: string } | undefined;
    return row?.value;
  }

  /** Add FTS5 prefix wildcard to last token, and escape special characters. */
  private ftsQuery(query: string): string {
    const trimmed = query.trim();
    if (trimmed.length === 0) return query;

    // Already escaped as a phrase or has wildcard — return as-is
    if (trimmed.endsWith("*") || (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
      return trimmed;
    }

    // If query contains special FTS5 chars (,, , (, ), NEAR, etc.), treat as phrase
    if (/[,()]/.test(trimmed)) {
      return `"${trimmed}"`;
    }

    // Add prefix wildcard to last token
    const tokens = trimmed.split(/\s+/);
    if (tokens.length === 0) return query;
    tokens[tokens.length - 1] = tokens[tokens.length - 1] + "*";
    return tokens.join(" ");
  }

  // --- Query helpers ---

  getFunctionByName(name: string): FunctionRow | undefined {
    return this.db
      .prepare("SELECT * FROM functions WHERE name = ? ORDER BY id LIMIT 1")
      .get(name) as FunctionRow | undefined;
  }

  getBindingByCompatible(compatible: string): DtBindingRow | undefined {
    return this.db
      .prepare("SELECT * FROM dt_bindings WHERE compatible = ? ORDER BY id LIMIT 1")
      .get(compatible) as DtBindingRow | undefined;
  }


  searchFunctions(query: string, limit = 10): FunctionRow[] {
    const fts = this.ftsQuery(query);
    return this.db
      .prepare(
        `SELECT f.* FROM functions_fts ft
         JOIN functions f ON f.id = ft.rowid
         WHERE functions_fts MATCH ?
         ORDER BY rank
         LIMIT ?`
      )
      .all(fts, limit) as FunctionRow[];
  }

  searchKconfig(query: string, limit = 10): KconfigRow[] {
    const fts = this.ftsQuery(query);
    return this.db
      .prepare(
        `SELECT k.* FROM kconfig_fts ft
         JOIN kconfig_symbols k ON k.id = ft.rowid
         WHERE kconfig_fts MATCH ?
         ORDER BY rank
         LIMIT ?`
      )
      .all(fts, limit) as KconfigRow[];
  }

  searchBindings(query: string, limit = 10): DtBindingRow[] {
    const fts = this.ftsQuery(query);
    return this.db
      .prepare(
        `SELECT d.* FROM dt_fts ft
         JOIN dt_bindings d ON d.id = ft.rowid
         WHERE dt_fts MATCH ?
         ORDER BY rank
         LIMIT ?`
      )
      .all(fts, limit) as DtBindingRow[];
  }

  searchDocs(query: string, limit = 10): DocChunkRow[] {
    const fts = this.ftsQuery(query);
    return this.db
      .prepare(
        `SELECT d.* FROM docs_fts ft
         JOIN docs_chunks d ON d.id = ft.rowid
         WHERE docs_fts MATCH ?
         ORDER BY rank
         LIMIT ?`
      )
      .all(fts, limit) as DocChunkRow[];
  }

  close(): void {
    this.db.close();
  }
}
