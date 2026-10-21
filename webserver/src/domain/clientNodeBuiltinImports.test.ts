import { existsSync, readFileSync, statSync } from "node:fs";
import { isBuiltin } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * * The client bundle starts at webserver/client/index.html and must not reach a
 *   Node builtin. Vite externalises `node:*` and Rollup then fails the Dokploy
 *   build (`readFile is not exported by __vite-browser-external`).
 *   Type-only edges are not followed: esbuild erases them before Rollup.
 *   A type-only `node:*` import inside a file the bundle does reach is still reported.
 */

const webserverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const repoRoot = path.resolve(webserverRoot, "..");
const clientDir = path.join(webserverRoot, "client");

const CODE_EXT = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".mts", ".cts"]);

interface SpecifierUse {
  specifier: string;
  typeOnly: boolean;
  names: string[];
}

interface Offender {
  file: string;
  uses: SpecifierUse[];
  chain: string[];
  alsoImportedBy: string[];
}

function toPosix(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function repoPath(filePath: string): string {
  return toPosix(path.relative(repoRoot, filePath));
}

function stripComments(source: string): string {
  let out = "";
  let index = 0;
  let mode: "code" | "line" | "block" | "single" | "double" | "template" = "code";
  while (index < source.length) {
    const char = source[index] ?? "";
    const next = source[index + 1] ?? "";
    if (mode === "code") {
      if (char === "/" && next === "/") {
        mode = "line";
        index += 2;
        continue;
      }
      if (char === "/" && next === "*") {
        mode = "block";
        index += 2;
        continue;
      }
      if (char === "'") mode = "single";
      else if (char === '"') mode = "double";
      else if (char === "`") mode = "template";
      out += char;
      index += 1;
      continue;
    }
    if (mode === "line") {
      if (char === "\n") {
        mode = "code";
        out += char;
      }
      index += 1;
      continue;
    }
    if (mode === "block") {
      if (char === "*" && next === "/") {
        mode = "code";
        out += " ";
        index += 2;
        continue;
      }
      if (char === "\n") out += char;
      index += 1;
      continue;
    }
    out += char;
    if (char === "\\") {
      out += next;
      index += 2;
      continue;
    }
    const quote = mode === "single" ? "'" : mode === "double" ? '"' : "`";
    if (char === quote) mode = "code";
    index += 1;
  }
  return out;
}

function importedNames(clause: string): string[] {
  const braced = clause.match(/\{([\s\S]*)\}/u);
  if (braced?.[1] !== undefined) {
    return braced[1]
      .split(",")
      .map((part) => part.trim().replace(/^type\s+/u, "").split(/\s+as\s+/u)[0]?.trim() ?? "")
      .filter((name) => name !== "");
  }
  const namespace = clause.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/u);
  if (namespace?.[1] !== undefined) return [namespace[1]];
  if (clause.trim() === "*") return ["*"];
  const binding = clause.trim().match(/^([A-Za-z_$][\w$]*)/u);
  if (binding?.[1] !== undefined && binding[1] !== "from") return [binding[1]];
  return [];
}

function clauseIsTypeOnly(markedType: boolean, clause: string): boolean {
  if (markedType) return true;
  const body = clause.trim();
  if (!body.startsWith("{")) return false;
  const inner = body.slice(1, body.lastIndexOf("}"));
  const parts = inner
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");
  return parts.length > 0 && parts.every((part) => part.startsWith("type "));
}

function cleanSpecifier(specifier: string): string {
  const noQuery = specifier.split("?")[0] ?? specifier;
  return noQuery.split("#")[0] ?? noQuery;
}

function findImports(source: string): SpecifierUse[] {
  const cleaned = stripComments(source);
  const found: SpecifierUse[] = [];
  const fromPattern =
    /(?:^|[\n;])\s*(import|export)\s+(type\s+)?([\s\S]*?)\sfrom\s*["']([^"']+)["']/gu;
  for (const match of cleaned.matchAll(fromPattern)) {
    const clause = match[3] ?? "";
    const typeOnly = clauseIsTypeOnly(match[2] !== undefined, clause);
    found.push({
      specifier: cleanSpecifier(match[4] ?? ""),
      typeOnly,
      names: importedNames(clause),
    });
  }
  const sideEffect = /(?:^|[\n;])\s*import\s*["']([^"']+)["']/gu;
  for (const match of cleaned.matchAll(sideEffect)) {
    found.push({ specifier: cleanSpecifier(match[1] ?? ""), typeOnly: false, names: [] });
  }
  const dynamic = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/gu;
  for (const match of cleaned.matchAll(dynamic)) {
    found.push({ specifier: cleanSpecifier(match[1] ?? ""), typeOnly: false, names: [] });
  }
  const required = /\brequire\s*\(\s*["']([^"']+)["']\s*\)/gu;
  for (const match of cleaned.matchAll(required)) {
    found.push({ specifier: cleanSpecifier(match[1] ?? ""), typeOnly: false, names: [] });
  }
  return found.filter((item) => item.specifier !== "");
}

function isNodeModule(specifier: string): boolean {
  if (specifier.startsWith("node:")) return true;
  return isBuiltin(specifier);
}

function resolveRelative(fromFile: string, specifier: string): string | null {
  const target = path.resolve(path.dirname(fromFile), specifier);
  const extension = path.extname(target);
  const candidates: string[] = [];
  if (extension === ".js" || extension === ".jsx" || extension === ".mjs" || extension === ".cjs") {
    const stem = target.slice(0, -extension.length);
    candidates.push(`${stem}.ts`, `${stem}.tsx`, `${stem}.mts`, `${stem}.cts`, target);
  } else if (extension === ".ts" || extension === ".tsx" || extension === ".mts" || extension === ".cts") {
    candidates.push(target);
  } else if (extension !== "") {
    candidates.push(target);
  } else {
    for (const suffix of [".ts", ".tsx", ".mts", ".js", ".mjs", ".json"]) {
      candidates.push(`${target}${suffix}`);
    }
    for (const suffix of [".ts", ".tsx", ".js"]) {
      candidates.push(path.join(target, `index${suffix}`));
    }
  }
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function clientEntries(): string[] {
  const htmlPath = path.join(clientDir, "index.html");
  const html = readFileSync(htmlPath, "utf8");
  const entries: string[] = [];
  for (const match of html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/giu)) {
    const src = match[1] ?? "";
    if (src === "") continue;
    const relative = src.startsWith("/") ? src.slice(1) : src;
    entries.push(path.resolve(clientDir, relative));
  }
  if (entries.length === 0) {
    throw new Error(`No script entry in ${repoPath(htmlPath)}`);
  }
  for (const entry of entries) {
    if (!existsSync(entry)) throw new Error(`Client entry is missing: ${repoPath(entry)}`);
  }
  return entries;
}

function describeUse(use: SpecifierUse): string {
  const names = use.names.length > 0 ? ` {${use.names.join(", ")}}` : "";
  const kind = use.typeOnly ? " (type-only)" : "";
  return `${use.specifier}${names}${kind}`;
}

/** * Value-import graph of the client bundle, plus every Node builtin it reaches. */
function clientNodeBuiltinChains(): string[] {
  const entries = clientEntries();
  const parent = new Map<string, string | null>();
  const importers = new Map<string, Set<string>>();
  const forbidden = new Map<string, SpecifierUse[]>();
  const queue = [...entries];
  for (const entry of entries) parent.set(entry, null);

  while (queue.length > 0) {
    const file = queue.shift();
    if (file === undefined) break;
    const extension = path.extname(file);
    if (!CODE_EXT.has(extension)) continue;
    const uses = findImports(readFileSync(file, "utf8"));
    const hits = uses.filter((use) => isNodeModule(use.specifier));
    if (hits.length > 0) forbidden.set(file, hits);
    for (const use of uses) {
      if (use.typeOnly || !use.specifier.startsWith(".")) continue;
      const next = resolveRelative(file, use.specifier);
      if (next === null) {
        throw new Error(`Unresolved client import ${use.specifier} from ${repoPath(file)}`);
      }
      const known = importers.get(next) ?? new Set<string>();
      known.add(file);
      importers.set(next, known);
      if (parent.has(next)) continue;
      parent.set(next, file);
      queue.push(next);
    }
  }

  const offenders: Offender[] = [];
  for (const [file, uses] of forbidden) {
    const chain: string[] = [];
    let cursor: string | null = file;
    const guard = new Set<string>();
    while (cursor !== null && !guard.has(cursor)) {
      guard.add(cursor);
      chain.push(cursor);
      cursor = parent.get(cursor) ?? null;
    }
    chain.reverse();
    const alsoImportedBy = [...(importers.get(file) ?? [])]
      .filter((importer) => importer !== chain[chain.length - 2])
      .map(repoPath)
      .sort();
    offenders.push({ file, uses, chain, alsoImportedBy });
  }

  return offenders.map((offender) => {
    const lines = offender.chain.map((file, index) => {
      const rendered = repoPath(file);
      return index === 0 ? rendered : `  → ${rendered}`;
    });
    lines.push(`  → ${offender.uses.map(describeUse).join(", ")}`);
    if (offender.alsoImportedBy.length > 0) {
      lines.push(`Also imported from the client graph by: ${offender.alsoImportedBy.join(", ")}`);
    }
    return lines.join("\n");
  });
}

describe("client bundle and Node builtins", () => {
  it.fails("keeps Node builtins out of the files reached from webserver/client/src", () => {
    const chains = clientNodeBuiltinChains();
    expect(chains, chains.join("\n\n")).toEqual([]);
  });
});
