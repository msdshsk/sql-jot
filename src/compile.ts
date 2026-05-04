import type {
  CompileOptions,
  CTE,
  DeleteBody,
  Expr,
  InsertBody,
  Join,
  JoinPathStep,
  LimitInfo,
  MainQuery,
  OrderItem,
  Query,
  SchemaResolver,
  SelectItem,
  TableRef,
  UpdateBody,
} from "./types.js";

/* ---------- Public entry ---------- */

// emitExpr is called from many places without an explicit options arg; the
// only expression that needs options is `in`-with-subquery. Tracking options
// in a module-scope ambient is simpler than threading it through every
// expression emit. compile() is non-reentrant per call so this is safe.
let currentOptions: CompileOptions = {};

export function compile(query: Query, options: CompileOptions = {}): string {
  const previous = currentOptions;
  currentOptions = options;
  try {
    return compileInner(query, options);
  } finally {
    currentOptions = previous;
  }
}

function compileInner(query: Query, options: CompileOptions): string {
  const parts: string[] = [];

  if (query.ctes.length > 0) {
    parts.push(emitCTEs(query.ctes, options));
  }

  switch (query.body.kind) {
    case "select":
      parts.push(emitMain(query.body.main, query.ctes, options));
      break;
    case "insert":
      parts.push(emitInsert(query.body, options));
      break;
    case "update":
      parts.push(emitUpdate(query.body, options));
      break;
    case "delete":
      parts.push(emitDelete(query.body, options));
      break;
  }

  return parts.join(" ");
}

/* ---------- CTE ---------- */

function emitCTEs(ctes: CTE[], options: CompileOptions): string {
  const defs = ctes.map(
    (c) => `${c.name} AS (${emitMain(c.body, [], options)})`,
  );
  return `WITH ${defs.join(", ")}`;
}

/* ---------- SELECT / main query ---------- */

function emitMain(
  main: MainQuery,
  ctes: CTE[],
  options: CompileOptions,
): string {
  const segments: string[] = [];
  const from = resolveFrom(main, ctes);

  // Pre-process JOINs: expand multi-hop and synthesise ON via FK
  const expandedJoins = expandJoins(main.joins, from, options.schema);

  // Build column-home map for implicit qualification
  const tablesInScope = collectScope(from, expandedJoins);
  const columnHome = buildColumnHome(tablesInScope, options.schema);

  segments.push(emitSelect(main.select, columnHome));

  if (from) {
    segments.push(`FROM ${emitTableRef(from)}`);
  }

  for (const j of expandedJoins) {
    segments.push(emitJoin(j, columnHome));
  }

  if (main.where) {
    segments.push(`WHERE ${emitExpr(main.where, columnHome)}`);
  }
  if (main.group && main.group.length > 0) {
    segments.push(
      `GROUP BY ${main.group.map((e) => emitExpr(e, columnHome)).join(", ")}`,
    );
  }
  if (main.having) {
    segments.push(`HAVING ${emitExpr(main.having, columnHome)}`);
  }
  if (main.order && main.order.length > 0) {
    segments.push(
      `ORDER BY ${main.order.map((it) => emitOrderItem(it, columnHome)).join(", ")}`,
    );
  }
  if (main.limit) {
    segments.push(emitLimit(main.limit, options));
  }

  return segments.join(" ");
}

function resolveFrom(main: MainQuery, ctes: CTE[]): TableRef | null {
  if (main.from) return main.from;
  if (ctes.length === 1) {
    return { name: ctes[0]!.name, alias: null };
  }
  return null;
}

function emitTableRef(t: TableRef): string {
  return t.alias ? `${t.name} ${t.alias}` : t.name;
}

/* ---------- JOIN expansion ---------- */

/**
 * Walk the user's JOIN list. For any JOIN missing an explicit ON, ask the
 * resolver for a path. If the path has more than one step, splice the
 * intermediate joins in. The user-specified alias (if any) is attached only
 * to the FINAL step; intermediate tables get no alias.
 */
function expandJoins(
  joins: Join[],
  from: TableRef | null,
  resolver?: SchemaResolver,
): Join[] {
  if (!resolver || !from) return joins;
  const out: Join[] = [];
  let prev: TableRef = from;
  for (const j of joins) {
    if (j.on || j.joinType === "cross") {
      out.push(j);
      prev = j.table;
      continue;
    }
    const path = resolver.resolveJoin(prev.name, j.table.name);
    if (!path || path.length === 0) {
      out.push(j); // leave for placeholder emission
      prev = j.table;
      continue;
    }
    for (let i = 0; i < path.length; i++) {
      const step = path[i]!;
      const isFinal = i === path.length - 1;
      const targetTable: TableRef = isFinal
        ? j.table
        : { name: step.table, alias: null };
      out.push({
        joinType: isFinal ? j.joinType : "inner",
        table: targetTable,
        on: makeFKOnExpr(prev, targetTable, step),
      });
      prev = targetTable;
    }
  }
  return out;
}

function makeFKOnExpr(
  prev: TableRef,
  next: TableRef,
  step: JoinPathStep,
): Expr {
  const prevHandle = prev.alias ?? prev.name;
  const nextHandle = next.alias ?? next.name;
  const pairs: Expr[] = step.fromCols.map((fc, i) => ({
    type: "compare",
    op: "=",
    left: { type: "qid", parts: [prevHandle, fc] },
    right: { type: "qid", parts: [nextHandle, step.toCols[i]!] },
  }));
  return pairs.length === 1 ? pairs[0]! : { type: "and", items: pairs };
}

/* ---------- Implicit column qualification ---------- */

interface ColumnHome {
  /** column name → unique handle (alias or table name); null = ambiguous; absent = unknown */
  unique: Map<string, string>;
}

function collectScope(
  from: TableRef | null,
  joins: Join[],
): TableRef[] {
  const out: TableRef[] = [];
  if (from) out.push(from);
  for (const j of joins) out.push(j.table);
  return out;
}

function buildColumnHome(
  tables: TableRef[],
  resolver?: SchemaResolver,
): ColumnHome {
  const home: ColumnHome = { unique: new Map() };
  if (!resolver || tables.length < 2) return home;
  const owners = new Map<string, string[]>();
  for (const t of tables) {
    const cols = resolver.listColumns(t.name);
    if (!cols) continue;
    const handle = t.alias ?? t.name;
    for (const c of cols) {
      const list = owners.get(c) ?? [];
      list.push(handle);
      owners.set(c, list);
    }
  }
  for (const [col, list] of owners) {
    if (list.length === 1) home.unique.set(col, list[0]!);
  }
  return home;
}

/* ---------- SELECT items / ORDER ---------- */

function emitSelect(items: SelectItem[] | null, home: ColumnHome): string {
  if (!items || items.length === 0) return "SELECT *";
  const cols = items.map((it) => {
    if (it.type === "star") return "*";
    if (it.type === "qstar") return `${it.table}.*`;
    const expr = emitExpr(it.expr, home);
    return it.alias ? `${expr} AS ${it.alias}` : expr;
  });
  return `SELECT ${cols.join(", ")}`;
}

function emitOrderItem(it: OrderItem, home: ColumnHome): string {
  return `${emitExpr(it.col, home)} ${it.dir.toUpperCase()}`;
}

/* ---------- JOINs ---------- */

function emitJoin(j: Join, home: ColumnHome): string {
  const kw =
    j.joinType === "inner"
      ? "INNER JOIN"
      : j.joinType === "left"
        ? "LEFT JOIN"
        : j.joinType === "right"
          ? "RIGHT JOIN"
          : j.joinType === "full"
            ? "FULL JOIN"
            : "CROSS JOIN";
  const tableSql = emitTableRef(j.table);
  if (j.joinType === "cross") return `${kw} ${tableSql}`;
  const onSql = j.on ? emitExpr(j.on, home) : "/* TODO: ON */";
  return `${kw} ${tableSql} ON ${onSql}`;
}

/* ---------- INSERT / UPDATE / DELETE ---------- */

function emitInsert(body: InsertBody, options: CompileOptions): string {
  const tableSql = emitTableRef(body.table);

  let head: string;
  if (body.values.kind === "subquery") {
    const colsSql = body.cols ? ` (${body.cols.join(", ")})` : "";
    const subqSql = compileInner(body.values.query, options);
    head = `INSERT INTO ${tableSql}${colsSql} ${subqSql}`;
  } else {
    const rows = body.values.rows;
    if (rows.length === 0) {
      throw new Error("INSERT requires at least one row");
    }
    const cols = body.cols ?? rows[0]!.map((a) => a.col);

    for (const row of rows) {
      if (row.length !== cols.length) {
        throw new Error(
          `Row column count (${row.length}) does not match expected (${cols.length})`,
        );
      }
      if (!body.cols) {
        const rowCols = row.map((a) => a.col);
        for (let i = 0; i < cols.length; i++) {
          if (rowCols[i] !== cols[i]) {
            throw new Error(
              `Multi-row INSERT must declare same columns in same order: expected ${cols[i]}, got ${rowCols[i]}`,
            );
          }
        }
      }
    }

    const empty: ColumnHome = { unique: new Map() };
    const valuesSql = rows
      .map((row) => `(${row.map((a) => emitExpr(a.value, empty)).join(", ")})`)
      .join(", ");

    head = `INSERT INTO ${tableSql} (${cols.join(", ")}) VALUES ${valuesSql}`;
  }

  return appendReturning(head, body.returning, "insert", body.table.name, options);
}

function emitUpdate(body: UpdateBody, options: CompileOptions): string {
  const tableSql = emitTableRef(body.table);
  const empty: ColumnHome = { unique: new Map() };
  const setClauses = body.assigns.map((a) => {
    const valSql = emitExpr(a.value, empty);
    if (a.op === "=") return `${a.col} = ${valSql}`;
    const arithOp = a.op[0]!;
    return `${a.col} = ${a.col} ${arithOp} ${valSql}`;
  });
  let sql = `UPDATE ${tableSql} SET ${setClauses.join(", ")}`;
  if (body.where) sql += ` WHERE ${emitExpr(body.where, empty)}`;
  return appendReturning(sql, body.returning, "update", body.table.name, options);
}

function emitDelete(body: DeleteBody, options: CompileOptions): string {
  const tableSql = emitTableRef(body.table);
  const empty: ColumnHome = { unique: new Map() };
  let sql = `DELETE FROM ${tableSql}`;
  if (body.where) sql += ` WHERE ${emitExpr(body.where, empty)}`;
  return appendReturning(sql, body.returning, "delete", body.table.name, options);
}

function appendReturning(
  head: string,
  cols: SelectItem[] | null,
  verb: "insert" | "update" | "delete",
  table: string,
  options: CompileOptions,
): string {
  if (!cols || cols.length === 0) return head;
  const empty: ColumnHome = { unique: new Map() };
  const rendered = cols.map((it) => {
    if (it.type === "star") return "*";
    if (it.type === "qstar") return `${it.table}.*`;
    const expr = emitExpr(it.expr, empty);
    return it.alias ? `${expr} AS ${it.alias}` : expr;
  });
  const tail = options.returning
    ? options.returning({ verb, table, cols: rendered })
    : `RETURNING ${rendered.join(", ")}`;
  return tail ? `${head} ${tail}` : head;
}

/* ---------- Expressions ---------- */

function emitExpr(e: Expr, home: ColumnHome): string {
  switch (e.type) {
    case "id": {
      const handle = home.unique.get(e.name);
      return handle ? `${handle}.${e.name}` : e.name;
    }
    case "qid":
      return e.parts.join(".");
    case "num":
      return String(e.value);
    case "str":
      return sqlString(e.value);
    case "func":
      return `${e.name}(${e.args.map((a) => emitExpr(a, home)).join(", ")})`;
    case "group":
      return `(${emitExpr(e.expr, home)})`;
    case "compare":
      return `${emitExpr(e.left, home)} ${e.op} ${emitExpr(e.right, home)}`;
    case "like":
      return emitLike(e, home, "LIKE");
    case "in":
      return emitIn(e, home, "IN");
    case "exists":
      return `EXISTS (${compile(e.query, currentOptions)})`;
    case "case": {
      const whens = e.whens
        .map(
          (w) =>
            `WHEN ${emitExpr(w.when, home)} THEN ${emitExpr(w.then, home)}`,
        )
        .join(" ");
      const elseSql =
        e.else != null ? ` ELSE ${emitExpr(e.else, home)}` : "";
      return `CASE ${whens}${elseSql} END`;
    }
    case "coalesce":
      return `COALESCE(${e.items.map((x) => emitExpr(x, home)).join(", ")})`;
    case "not": {
      const inner = e.expr;
      switch (inner.type) {
        case "in":
          return emitIn(inner, home, "NOT IN");
        case "like":
          return emitLike(inner, home, "NOT LIKE");
        case "exists":
          return `NOT EXISTS (${compile(inner.query, currentOptions)})`;
        default:
          return `NOT (${emitExpr(inner, home)})`;
      }
    }
    case "and":
      return e.items.map((x) => wrapBool(x, home)).join(" AND ");
    case "or":
      return e.items.map((x) => wrapBool(x, home)).join(" OR ");
  }
}

function emitIn(
  e: Extract<Expr, { type: "in" }>,
  home: ColumnHome,
  op: string,
): string {
  const left = emitExpr(e.col, home);
  switch (e.source.kind) {
    case "list": {
      const list = e.source.items.map((lit) =>
        lit.type === "num" ? String(lit.value) : sqlString(lit.value),
      );
      return `${left} ${op} (${list.join(", ")})`;
    }
    case "ref":
      return `${left} ${op} (SELECT * FROM ${e.source.name})`;
    case "subquery":
      return `${left} ${op} (${compile(e.source.query, currentOptions)})`;
  }
}

function emitLike(
  e: Extract<Expr, { type: "like" }>,
  home: ColumnHome,
  op: string,
): string {
  const v = e.pattern.value;
  const pattern = v.includes("%") ? v : `%${v}%`;
  return `${emitExpr(e.col, home)} ${op} ${sqlString(pattern)}`;
}

function wrapBool(e: Expr, home: ColumnHome): string {
  if (e.type === "and" || e.type === "or") return `(${emitExpr(e, home)})`;
  return emitExpr(e, home);
}

function emitLimit(info: LimitInfo, options: CompileOptions): string {
  if (options.paginate) return options.paginate(info);
  const offset = (info.page - 1) * info.limit;
  return offset > 0
    ? `LIMIT ${info.limit} OFFSET ${offset}`
    : `LIMIT ${info.limit}`;
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export type { Query, CompileOptions } from "./types.js";
