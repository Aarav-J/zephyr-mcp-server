import { XMLParser } from "fast-xml-parser";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { FunctionRow } from "../db.js";

// --- XML parsing ---

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  isArray: (name) =>
    ["compounddef", "sectiondef", "memberdef", "param", "para", "listitem"].includes(name),
  processEntities: true,
  htmlEntities: true,
});

// --- Types for Doxygen XML ---

interface DoxygenMemberdef {
  "@_kind": string;
  "@_id": string;
  type?: { "#text": string } | string;
  name: string;
  argsstring?: string;
  param?: DoxygenParam[];
  briefdescription?: { para: DoxygenPara | DoxygenPara[] };
  detaileddescription?: { para: DoxygenPara | DoxygenPara[] | string };
  location?: {
    "@_declfile"?: string;
    "@_file"?: string;
    "@_declline"?: string;
  };
}

interface DoxygenParam {
  type: { "#text"?: string } | string;
  declname?: string;
  briefdescription?: { para: DoxygenPara | DoxygenPara[] };
}

type DoxygenPara =
  | { "#text"?: string; "@_id"?: string; para?: DoxygenPara[] }
  | string
  | number;

interface DoxygenSectiondef {
  "@_kind": string;
  memberdef?: DoxygenMemberdef[];
}

interface DoxygenCompounddef {
  "@_kind": string;
  compoundname?: string;
  title?: string;
  sectiondef?: DoxygenSectiondef[];
  memberdef?: DoxygenMemberdef[];
  briefdescription?: { para: DoxygenPara | DoxygenPara[] };
}

interface DoxygenRoot {
  doxygen: {
    compounddef: DoxygenCompounddef[];
  };
}

// --- Text extraction ---

/** Extract plain text from a Doxygen para element (may contain nested formatting). */
function extractParaText(para: unknown): string {
  if (para === null || para === undefined) return "";
  if (typeof para === "string") return para;
  if (typeof para === "number") return String(para);

  if (Array.isArray(para)) {
    return para.map(extractParaText).join(" ").trim();
  }

  if (typeof para !== "object") return "";

  // Direct text content
  if ("#text" in para && typeof (para as Record<string, unknown>)["#text"] === "string") {
    return (para as Record<string, unknown>)["#text"] as string;
  }

  const obj = para as Record<string, unknown>;

  // Nested paragraph
  if (obj.para) return extractParaText(obj.para);

  // ulink element
  if (obj.ulink && typeof obj.ulink === "object") {
    const ulink = obj.ulink as Record<string, unknown>;
    const url = typeof ulink["@_url"] === "string" ? ulink["@_url"] : "";
    const text = extractParaText(ulink.para ?? obj.ulink);
    return text || url;
  }

  // Formatted inline elements
  for (const key of ["bold", "emphasis", "computeroutput"]) {
    if (obj[key]) return extractParaText(obj[key]);
  }

  // ref element
  if (obj.ref && typeof obj.ref === "object") {
    const ref = obj.ref as Record<string, unknown>;
    const text = typeof ref["#text"] === "string" ? ref["#text"] : "";
    return text || extractParaText(ref);
  }

  return "";
}

/** Extract text from a brief/detailed description block. */
function extractDescription(desc: unknown): string {
  if (!desc) return "";
  if (typeof desc !== "object") return "";
  const d = desc as Record<string, unknown>;
  return extractParaText(d.para ?? d);
}

/** Build full function signature from type + name + args. */
function buildSignature(member: DoxygenMemberdef): string {
  let returnType = "";
  if (member.type) {
    if (typeof member.type === "string") {
      returnType = member.type;
    } else if ("#text" in member.type) {
      returnType = member.type["#text"] ?? "";
    }
  }

  const name = member.name ?? "";
  const args = member.argsstring ?? "()";

  if (args.startsWith("(")) {
    return `${returnType} ${name}${args}`;
  }
  if (args.startsWith(returnType) || returnType === "") {
    return args;
  }
  return `${returnType} ${name}${args.startsWith("(") ? args : `(${args})`}`;
}

/** Extract name from a param element. */
function extractParamName(param: DoxygenParam): string {
  return param.declname ?? "";
}

/** Extract type string from a Doxygen type element. */
function extractTypeString(typeVal: unknown): string {
  if (!typeVal) return "";
  if (typeof typeVal === "string") return typeVal;
  if (typeof typeVal === "object" && "#text" in (typeVal as Record<string, unknown>)) {
    const v = (typeVal as Record<string, unknown>)["#text"];
    return typeof v === "string" ? v : "";
  }
  return "";
}

// --- Parsing engine ---

/** Parse a single Doxygen compounddef and extract all functions. */
function parseCompounddef(
  compound: DoxygenCompounddef,
  _sourcePath: string
): FunctionRow[] {
  const rows: FunctionRow[] = [];

  const groupId = compound.compoundname ?? null;
  const section = compound.title ?? null;

  const candidates: DoxygenMemberdef[] = [];

  if (compound.sectiondef) {
    for (const sectiondef of compound.sectiondef) {
      if (sectiondef["@_kind"] === "func" && sectiondef.memberdef) {
        candidates.push(...sectiondef.memberdef);
      }
    }
  }

  if (compound.memberdef) {
    candidates.push(...compound.memberdef);
  }

  for (const member of candidates) {
    if (member["@_kind"] !== "function") continue;
    if (!member.name) continue;

    const params = (member.param ?? []).map((p) => ({
      name: extractParamName(p),
      type: extractTypeString(p.type),
      description: extractDescription(p.briefdescription),
    }));

    const row: FunctionRow = {
      name: member.name,
      signature: buildSignature(member),
      brief: extractDescription(member.briefdescription) || null,
      description: extractDescription(member.detaileddescription) || null,
      params: params.length > 0 ? JSON.stringify(params) : null,
      return_type: extractTypeString(member.type) || null,
      return_desc: null,
      header: member.location?.["@_declfile"] ?? member.location?.["@_file"] ?? null,
      section: section ?? null,
      group_id: groupId,
    };

    rows.push(row);
  }

  return rows;
}

// --- Public API ---

export interface ParseResult {
  functions: FunctionRow[];
  sourcePath: string;
}

/**
 * Parse a single Doxygen XML file and return extracted functions.
 */
export function parseDoxygenFile(filePath: string): ParseResult {
  const xml = readFileSync(filePath, "utf-8");
  const parsed = parser.parse(xml) as DoxygenRoot;
  const compounds = parsed.doxygen?.compounddef ?? [];
  const functions: FunctionRow[] = [];

  for (const compound of compounds) {
    const rows = parseCompounddef(compound, filePath);
    functions.push(...rows);
  }

  return { functions, sourcePath: filePath };
}

/**
 * Parse all Doxygen XML files in a directory, extracting functions.
 */
export function parseDoxygenDirectory(dirPath: string): ParseResult {
  const allFunctions: FunctionRow[] = [];

  if (!existsSync(dirPath)) {
    throw new Error(`Doxygen XML directory not found: ${dirPath}`);
  }

  const entries = readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".xml")) continue;
    if (entry.name === "index.xml") continue;

    const filePath = join(dirPath, entry.name);
    try {
      const result = parseDoxygenFile(filePath);
      allFunctions.push(...result.functions);
    } catch {
      continue;
    }
  }

  return { functions: allFunctions, sourcePath: dirPath };
}
