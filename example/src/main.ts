import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";

import {
  expand,
  getCandidates,
  longestCommonPrefix,
  parse,
  validate,
} from "../../src/index.js";
import { EXAMPLES } from "./examples.js";
import { registerSqlEmmetLanguage } from "./language.js";
import { demoSchema } from "./schema.js";

(self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
  getWorker() {
    return new editorWorker();
  },
};

registerSqlEmmetLanguage();

const emmetEl = document.getElementById("emmet-editor")!;
const sqlEl = document.getElementById("sql-editor")!;
const statusEl = document.getElementById("status")!;
const examplesEl = document.getElementById("examples")!;

const initial = EXAMPLES[0]!.source;

const emmetEditor = monaco.editor.create(emmetEl, {
  value: initial,
  language: "sql-emmet",
  theme: "sql-emmet-dark",
  fontSize: 14,
  fontFamily: 'ui-monospace, "JetBrains Mono", Menlo, monospace',
  minimap: { enabled: false },
  lineNumbers: "off",
  wordWrap: "on",
  automaticLayout: true,
  scrollBeyondLastLine: false,
});

const sqlEditor = monaco.editor.create(sqlEl, {
  value: "",
  language: "sql",
  theme: "vs-dark",
  fontSize: 14,
  fontFamily: 'ui-monospace, "JetBrains Mono", Menlo, monospace',
  minimap: { enabled: false },
  readOnly: true,
  wordWrap: "on",
  automaticLayout: true,
  scrollBeyondLastLine: false,
});

const SQL_BREAK_KEYWORDS =
  /\s+(FROM|WHERE|GROUP BY|HAVING|ORDER BY|LIMIT|OFFSET|VALUES|SET|INNER JOIN|LEFT JOIN|RIGHT JOIN|FULL JOIN|CROSS JOIN|WITH|UNION ALL|UNION)\b/g;

function format(sql: string): string {
  return sql.replace(SQL_BREAK_KEYWORDS, "\n$1");
}

function setStatus(text: string, ok: boolean) {
  statusEl.textContent = text;
  statusEl.classList.toggle("status-ok", ok);
  statusEl.classList.toggle("status-error", !ok);
}

/* ---------- live preview + validation (Pattern A: red squiggles) ---------- */

const MARKER_OWNER = "sql-emmet";

function refresh() {
  const model = emmetEditor.getModel();
  if (!model) return;
  const src = model.getValue().trim();
  if (!src) {
    sqlEditor.setValue("");
    monaco.editor.setModelMarkers(model, MARKER_OWNER, []);
    setStatus("empty", true);
    return;
  }
  try {
    const sql = expand(src, { schema: demoSchema });
    sqlEditor.setValue(format(sql));
    const ast = parse(src);
    const issues = validate(ast, demoSchema);
    monaco.editor.setModelMarkers(
      model,
      MARKER_OWNER,
      issuesToMarkers(issues, model.getValue()),
    );
    if (issues.length === 0) {
      setStatus(`ok · ${sql.length} chars`, true);
    } else {
      setStatus(`ok · ${issues.length} warning(s)`, true);
    }
  } catch (e) {
    monaco.editor.setModelMarkers(model, MARKER_OWNER, []);
    sqlEditor.setValue("");
    const msg = (e as Error).message.split("\n")[0] ?? "parse error";
    setStatus(`error · ${msg}`, false);
  }
}

function issuesToMarkers(
  issues: ReturnType<typeof validate>,
  source: string,
): monaco.editor.IMarkerData[] {
  const model = emmetEditor.getModel();
  if (!model) return [];
  const markers: monaco.editor.IMarkerData[] = [];
  for (const issue of issues) {
    if (!issue.ref) continue;
    const range = findIdentifier(source, issue.ref.name);
    if (!range) continue;
    const startPos = model.getPositionAt(range[0]);
    const endPos = model.getPositionAt(range[1]);
    markers.push({
      severity:
        issue.severity === "error"
          ? monaco.MarkerSeverity.Error
          : monaco.MarkerSeverity.Warning,
      message: issue.message,
      startLineNumber: startPos.lineNumber,
      startColumn: startPos.column,
      endLineNumber: endPos.lineNumber,
      endColumn: endPos.column,
    });
  }
  return markers;
}

function findIdentifier(source: string, name: string): [number, number] | null {
  const re = new RegExp(`\\b${escapeRegExp(name)}\\b`);
  const m = re.exec(source);
  if (!m) return null;
  return [m.index, m.index + name.length];
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

emmetEditor.onDidChangeModelContent(() => refresh());

/* ---------- Pattern B: Tab to longest-common-prefix expansion ---------- */

emmetEditor.onKeyDown((e) => {
  if (e.keyCode !== monaco.KeyCode.Tab || e.shiftKey) return;
  const pos = emmetEditor.getPosition();
  const model = emmetEditor.getModel();
  if (!pos || !model) return;
  const offset = model.getOffsetAt(pos);
  const value = model.getValue();
  const result = getCandidates(value, offset, demoSchema);
  if (result.candidates.length === 0) return;
  const lcp = longestCommonPrefix(
    result.candidates.map((c) => c.insertText),
  );
  const target =
    result.candidates.length === 1
      ? result.candidates[0]!.insertText
      : lcp;
  if (target.length <= result.prefix.length) return;

  e.preventDefault();
  e.stopPropagation();
  const startPos = model.getPositionAt(result.range.start);
  const endPos = model.getPositionAt(result.range.end);
  emmetEditor.executeEdits("tab-expand", [
    {
      range: new monaco.Range(
        startPos.lineNumber,
        startPos.column,
        endPos.lineNumber,
        endPos.column,
      ),
      text: target,
      forceMoveMarkers: true,
    },
  ]);
});

/* ---------- Inline expand command (Ctrl+E unchanged) ---------- */

emmetEditor.addAction({
  id: "sql-emmet.expand-inline",
  label: "Expand sql-emmet inline",
  keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyE],
  run: (ed) => {
    const src = ed.getValue().trim();
    if (!src) return;
    try {
      ed.setValue(format(expand(src, { schema: demoSchema })));
    } catch {
      /* keep input intact on error */
    }
  },
});

/* ---------- Quick-load buttons ---------- */

for (const ex of EXAMPLES) {
  const btn = document.createElement("button");
  btn.textContent = ex.label;
  btn.title = ex.source;
  btn.addEventListener("click", () => {
    emmetEditor.setValue(ex.source);
    emmetEditor.focus();
  });
  examplesEl.appendChild(btn);
}

refresh();
