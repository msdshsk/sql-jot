import type {
  Candidate,
  CandidatesResult,
  SchemaResolver,
} from "./types.js";

const ID_CHAR = /[a-zA-Z0-9_]/;

interface Trigger {
  kind:
    | "table" // tables expected (start of input or after JOIN '+')
    | "column" // bare column expected (after >, ?, :, #, $, ',', '<', '|', '=', '[')
    | "qualified-column" // after '<table>.'
    | "alias" // after '@' (no candidates by default)
    | "none"; // no useful context detected
  qualifier?: string;
}

/**
 * Returns candidate identifiers for the cursor position.
 * The host decides UX (popup, inline ghost text, Tab-only, etc.).
 */
export function getCandidates(
  input: string,
  cursorOffset: number,
  resolver: SchemaResolver,
): CandidatesResult {
  const { prefix, prefixStart } = extractPrefix(input, cursorOffset);
  const trigger = detectTrigger(input, prefixStart);
  const tablesInScope = scanTables(input, prefixStart);

  let candidates: Candidate[] = [];
  switch (trigger.kind) {
    case "table":
      if (resolver.listTables) {
        const tables = resolver.listTables() ?? [];
        candidates = tables
          .filter((t) => t.startsWith(prefix))
          .map((name) => ({ insertText: name, kind: "table" }));
      }
      break;
    case "column":
      candidates = collectColumnCandidates(prefix, tablesInScope, resolver);
      break;
    case "qualified-column": {
      const tableName = resolveAlias(trigger.qualifier!, tablesInScope);
      const cols = resolver.listColumns(tableName) ?? [];
      candidates = cols
        .filter((c) => c.startsWith(prefix))
        .map((name) => ({
          insertText: name,
          kind: "column",
          detail: tableName,
        }));
      break;
    }
    case "alias":
    case "none":
      break;
  }

  return {
    prefix,
    candidates,
    range: { start: prefixStart, end: cursorOffset },
  };
}

/**
 * Longest common prefix among candidates that share the user's typed prefix.
 * Useful for Tab-style prefix expansion (no popup).
 */
export function longestCommonPrefix(strings: string[]): string {
  if (strings.length === 0) return "";
  if (strings.length === 1) return strings[0]!;
  let prefix = strings[0]!;
  for (let i = 1; i < strings.length; i++) {
    const s = strings[i]!;
    let j = 0;
    while (j < prefix.length && j < s.length && prefix[j] === s[j]) j++;
    prefix = prefix.slice(0, j);
    if (prefix === "") break;
  }
  return prefix;
}

/* ---------- internal helpers ---------- */

function extractPrefix(
  input: string,
  cursor: number,
): { prefix: string; prefixStart: number } {
  let start = cursor;
  while (start > 0 && ID_CHAR.test(input[start - 1]!)) start--;
  return { prefix: input.slice(start, cursor), prefixStart: start };
}

function detectTrigger(input: string, prefixStart: number): Trigger {
  // Look at the char immediately before the prefix (skip spaces).
  let i = prefixStart - 1;
  while (i >= 0 && /\s/.test(input[i]!)) i--;
  if (i < 0) return { kind: "table" };
  const ch = input[i]!;

  switch (ch) {
    case ">":
    case "?":
    case ":":
    case "#":
    case "$":
    case ",":
    case "<":
    case "|":
    case "=":
    case "[":
      return { kind: "column" };
    case "+":
    case "-":
      return { kind: "table" };
    case "@":
      return { kind: "alias" };
    case ".": {
      // Walk back to capture the qualifier identifier.
      let q = i;
      while (q > 0 && ID_CHAR.test(input[q - 1]!)) q--;
      const qualifier = input.slice(q, i);
      return qualifier
        ? { kind: "qualified-column", qualifier }
        : { kind: "none" };
    }
    default:
      return { kind: "none" };
  }
}

interface ScopeTable {
  name: string;
  alias: string | null;
}

/**
 * Heuristic: pull table references out of the input by scanning for the patterns
 * that introduce a table — start of input, after `+`, after `-`, after `=`,
 * after `(`. We treat `<name>(@<alias>)?` immediately following such a marker
 * as a table reference. Good enough for completion context detection.
 */
function scanTables(input: string, upTo: number): ScopeTable[] {
  const slice = input.slice(0, upTo);
  const out: ScopeTable[] = [];
  const re = /(^|[+\-={(\s])([a-zA-Z_][a-zA-Z0-9_]*)(?:@([a-zA-Z_][a-zA-Z0-9_]*))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(slice)) !== null) {
    const lead = m[1] ?? "";
    if (lead === "" && m.index !== 0) continue;
    out.push({ name: m[2]!, alias: m[3] ?? null });
  }
  return out;
}

function resolveAlias(handle: string, tables: ScopeTable[]): string {
  for (const t of tables) {
    if (t.alias === handle) return t.name;
    if (t.name === handle) return t.name;
  }
  return handle;
}

function collectColumnCandidates(
  prefix: string,
  tables: ScopeTable[],
  resolver: SchemaResolver,
): Candidate[] {
  const seen = new Map<string, Candidate>();
  for (const t of tables) {
    const cols = resolver.listColumns(t.name);
    if (!cols) continue;
    const handle = t.alias ?? t.name;
    for (const c of cols) {
      if (!c.startsWith(prefix)) continue;
      // De-dupe by column name; keep first detail
      if (!seen.has(c)) {
        seen.set(c, { insertText: c, kind: "column", detail: handle });
      }
    }
  }
  return [...seen.values()];
}
