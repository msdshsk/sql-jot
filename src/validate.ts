import type {
  Expr,
  Join,
  MainQuery,
  Query,
  SchemaResolver,
  SelectItem,
  TableRef,
  ValidationIssue,
} from "./types.js";

/**
 * Validate the AST against a schema. Returns warnings/errors for unknown
 * tables and unknown/ambiguous columns. Locations are not yet tracked —
 * messages reference identifiers by name.
 */
export function validate(
  query: Query,
  resolver: SchemaResolver,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const cte of query.ctes) {
    walkMain(cte.body, resolver, issues, /*ctes for impl FROM*/ []);
  }
  switch (query.body.kind) {
    case "select":
      walkMain(query.body.main, resolver, issues, query.ctes.map((c) => c.name));
      break;
    case "insert":
      walkTable(query.body.table, resolver, issues);
      // Validate column list against table catalog
      if (query.body.cols) {
        const cols = resolver.listColumns(query.body.table.name);
        if (cols) {
          for (const c of query.body.cols) {
            if (!cols.includes(c)) {
              issues.push({
                severity: "warning",
                message: `unknown column "${c}" on ${query.body.table.name}`,
                ref: { kind: "column", name: c },
              });
            }
          }
        }
      }
      // Validate row assignment columns
      if (query.body.values.kind === "rows") {
        const cols = resolver.listColumns(query.body.table.name);
        if (cols) {
          for (const row of query.body.values.rows) {
            for (const a of row) {
              if (!cols.includes(a.col)) {
                issues.push({
                  severity: "warning",
                  message: `unknown column "${a.col}" on ${query.body.table.name}`,
                  ref: { kind: "column", name: a.col },
                });
              }
            }
          }
        }
      } else {
        validate(query.body.values.query, resolver).forEach((i) => issues.push(i));
      }
      walkReturning(query.body.returning, query.body.table, resolver, issues);
      break;
    case "update": {
      walkTable(query.body.table, resolver, issues);
      const cols = resolver.listColumns(query.body.table.name);
      if (cols) {
        for (const a of query.body.assigns) {
          if (!cols.includes(a.col)) {
            issues.push({
              severity: "warning",
              message: `unknown column "${a.col}" on ${query.body.table.name}`,
              ref: { kind: "column", name: a.col },
            });
          }
        }
      }
      if (query.body.where) {
        walkExpr(query.body.where, [query.body.table], resolver, issues);
      }
      walkReturning(query.body.returning, query.body.table, resolver, issues);
      break;
    }
    case "delete":
      walkTable(query.body.table, resolver, issues);
      if (query.body.where) {
        walkExpr(query.body.where, [query.body.table], resolver, issues);
      }
      walkReturning(query.body.returning, query.body.table, resolver, issues);
      break;
  }
  return issues;
}

function walkReturning(
  cols: SelectItem[] | null,
  table: TableRef,
  resolver: SchemaResolver,
  issues: ValidationIssue[],
): void {
  if (!cols) return;
  for (const it of cols) {
    if (it.type === "col") walkExpr(it.expr, [table], resolver, issues);
  }
}

function walkMain(
  main: MainQuery,
  resolver: SchemaResolver,
  issues: ValidationIssue[],
  cteNames: string[],
): void {
  const tables: TableRef[] = [];
  if (main.from) {
    tables.push(main.from);
    if (!cteNames.includes(main.from.name)) {
      walkTable(main.from, resolver, issues);
    }
  }
  for (const j of main.joins) {
    tables.push(j.table);
    if (!cteNames.includes(j.table.name)) {
      walkTable(j.table, resolver, issues);
    }
    if (j.on) walkExpr(j.on, tables, resolver, issues);
  }
  if (main.select) {
    for (const it of main.select) {
      if (it.type === "col") walkExpr(it.expr, tables, resolver, issues);
    }
  }
  if (main.where) walkExpr(main.where, tables, resolver, issues);
  if (main.having) walkExpr(main.having, tables, resolver, issues);
  if (main.group) {
    for (const e of main.group) walkExpr(e, tables, resolver, issues);
  }
  if (main.order) {
    for (const it of main.order) walkExpr(it.col, tables, resolver, issues);
  }
}

function walkTable(
  t: TableRef,
  resolver: SchemaResolver,
  issues: ValidationIssue[],
): void {
  if (resolver.listTables) {
    const known = resolver.listTables();
    if (known && !known.includes(t.name)) {
      issues.push({
        severity: "warning",
        message: `unknown table "${t.name}"`,
        ref: { kind: "table", name: t.name },
      });
    }
  }
}

function walkExpr(
  e: Expr,
  scope: TableRef[],
  resolver: SchemaResolver,
  issues: ValidationIssue[],
): void {
  switch (e.type) {
    case "id":
      checkBareColumn(e.name, scope, resolver, issues);
      break;
    case "qid":
      checkQualifiedColumn(e.parts, scope, resolver, issues);
      break;
    case "func":
      for (const a of e.args) walkExpr(a, scope, resolver, issues);
      break;
    case "group":
      walkExpr(e.expr, scope, resolver, issues);
      break;
    case "compare":
      walkExpr(e.left, scope, resolver, issues);
      walkExpr(e.right, scope, resolver, issues);
      break;
    case "like":
      walkExpr(e.col, scope, resolver, issues);
      break;
    case "in":
      walkExpr(e.col, scope, resolver, issues);
      if (e.source.kind === "subquery") {
        for (const i of validate(e.source.query, resolver)) issues.push(i);
      }
      // ref form: skip validation — the named entity could be a CTE
      // not visible to walkExpr's scope. Future: thread CTE names down.
      break;
    case "exists":
      // Subquery is validated independently; correlated outer references
      // will warn for now (same limitation as IN-with-subquery).
      for (const i of validate(e.query, resolver)) issues.push(i);
      break;
    case "not":
      walkExpr(e.expr, scope, resolver, issues);
      break;
    case "case":
      for (const w of e.whens) {
        walkExpr(w.when, scope, resolver, issues);
        walkExpr(w.then, scope, resolver, issues);
      }
      if (e.else) walkExpr(e.else, scope, resolver, issues);
      break;
    case "coalesce":
      for (const it of e.items) walkExpr(it, scope, resolver, issues);
      break;
    case "and":
    case "or":
      for (const it of e.items) walkExpr(it, scope, resolver, issues);
      break;
    case "num":
    case "str":
    case "null":
    case "bool":
      break;
  }
}

function checkBareColumn(
  name: string,
  scope: TableRef[],
  resolver: SchemaResolver,
  issues: ValidationIssue[],
): void {
  let owners = 0;
  let anyKnown = false;
  for (const t of scope) {
    const cols = resolver.listColumns(t.name);
    if (!cols) continue;
    anyKnown = true;
    if (cols.includes(name)) owners++;
  }
  if (!anyKnown) return;
  if (owners === 0) {
    issues.push({
      severity: "warning",
      message: `unknown column "${name}"`,
      ref: { kind: "column", name },
    });
  } else if (owners > 1) {
    issues.push({
      severity: "warning",
      message: `ambiguous column "${name}" — qualify with table alias`,
      ref: { kind: "column", name },
    });
  }
}

function checkQualifiedColumn(
  parts: string[],
  scope: TableRef[],
  resolver: SchemaResolver,
  issues: ValidationIssue[],
): void {
  if (parts.length < 2) return;
  const handle = parts[0]!;
  const col = parts[parts.length - 1]!;
  const table = scope.find((t) => (t.alias ?? t.name) === handle);
  if (!table) {
    issues.push({
      severity: "warning",
      message: `unknown table or alias "${handle}"`,
      ref: { kind: "table", name: handle },
    });
    return;
  }
  const cols = resolver.listColumns(table.name);
  if (cols && !cols.includes(col)) {
    issues.push({
      severity: "warning",
      message: `unknown column "${col}" on ${table.name}`,
      ref: { kind: "column", name: col },
    });
  }
}

// Stop unused-_ import warning when we only re-export Join/SelectItem types.
type _Unused = Join | undefined;
