export type Literal =
  | { type: "num"; value: number }
  | { type: "str"; value: string };

export type InSource =
  | { kind: "list"; items: Literal[] }
  | { kind: "ref"; name: string }
  | { kind: "subquery"; query: Query };

export type Expr =
  | { type: "id"; name: string }
  | { type: "qid"; parts: string[] }
  | { type: "num"; value: number }
  | { type: "str"; value: string }
  | { type: "func"; name: string; args: Expr[] }
  | { type: "group"; expr: Expr }
  | { type: "compare"; left: Expr; op: string; right: Expr }
  | { type: "like"; col: Expr; pattern: { type: "str"; value: string } }
  | { type: "in"; col: Expr; source: InSource }
  | { type: "exists"; query: Query }
  | { type: "not"; expr: Expr }
  | { type: "case"; whens: { when: Expr; then: Expr }[]; else: Expr | null }
  | { type: "coalesce"; items: Expr[] }
  | { type: "and"; items: Expr[] }
  | { type: "or"; items: Expr[] };

export interface TableRef {
  name: string;
  alias: string | null;
}

export type JoinType = "inner" | "left" | "right" | "full" | "cross";

export interface Join {
  joinType: JoinType;
  table: TableRef;
  on: Expr | null;
}

export type SelectItem =
  | { type: "star" }
  | { type: "qstar"; table: string }
  | { type: "col"; expr: Expr; alias: string | null };

export interface OrderItem {
  col: Expr;
  dir: "asc" | "desc";
}

export interface LimitInfo {
  limit: number;
  page: number;
}

export interface MainQuery {
  from: TableRef | null;
  select: SelectItem[] | null;
  joins: Join[];
  where: Expr | null;
  group: Expr[] | null;
  having: Expr | null;
  order: OrderItem[] | null;
  limit: LimitInfo | null;
}

export interface CTE {
  name: string;
  body: MainQuery;
}

export interface SimpleAssign {
  col: string;
  value: Expr;
}

export type AssignOp = "=" | "+=" | "-=" | "*=" | "/=";

export interface UpdateAssign {
  col: string;
  op: AssignOp;
  value: Expr;
}

export type InsertValues =
  | { kind: "rows"; rows: SimpleAssign[][] }
  | { kind: "subquery"; query: Query };

export interface SelectBody {
  kind: "select";
  main: MainQuery;
}

export interface InsertBody {
  kind: "insert";
  table: TableRef;
  cols: string[] | null;
  values: InsertValues;
  returning: SelectItem[] | null;
}

export interface UpdateBody {
  kind: "update";
  table: TableRef;
  assigns: UpdateAssign[];
  where: Expr | null;
  returning: SelectItem[] | null;
}

export interface DeleteBody {
  kind: "delete";
  table: TableRef;
  where: Expr | null;
  returning: SelectItem[] | null;
}

export type QueryBody = SelectBody | InsertBody | UpdateBody | DeleteBody;

export interface Query {
  type: "query";
  ctes: CTE[];
  body: QueryBody;
}

/* ---------- Schema integration ---------- */

/**
 * One step in a JOIN chain. The compiler walks the array left-to-right,
 * emitting one JOIN per step. `fromCols` belongs to the previous table in
 * the chain; `toCols` belongs to `table`.
 */
export interface JoinPathStep {
  table: string;
  fromCols: string[];
  toCols: string[];
}

/**
 * Pluggable schema lookup interface. The host (e.g. an SQL client) implements
 * this to expose its schema knowledge to sql-jot without giving up ownership
 * of how the schema is stored or fetched.
 *
 * All methods return `null` when the resolver has no answer; the compiler
 * degrades gracefully (emits placeholders, skips qualification, etc.).
 */
export interface SchemaResolver {
  /**
   * Returns the chain of JOINs needed to connect `from` to `to`.
   * For a direct FK relationship, returns a single-step array.
   * For multi-hop, returns the intermediate path.
   */
  resolveJoin(from: string, to: string): JoinPathStep[] | null;

  /** Columns of the named table, or `null` if unknown. */
  listColumns(table: string): string[] | null;

  /** Optional: enumerate all known tables (used for completion candidates). */
  listTables?(): string[] | null;
}

export interface ReturningInfo {
  verb: "insert" | "update" | "delete";
  table: string;
  /** column expressions already rendered to SQL (with aliases) */
  cols: string[];
}

export interface CompileOptions {
  schema?: SchemaResolver;
  /** how to render LIMIT/PAGE — default emits "LIMIT n OFFSET m" */
  paginate?: (info: LimitInfo) => string;
  /** how to render RETURNING — default emits "RETURNING ${cols.join(", ")}" */
  returning?: (info: ReturningInfo) => string;
}

/* ---------- Completion / validation ---------- */

export interface Candidate {
  insertText: string;
  kind: "table" | "column" | "alias" | "function" | "keyword";
  detail?: string;
}

export interface CandidatesResult {
  prefix: string;
  candidates: Candidate[];
  /** Range in the input that the candidate replaces. */
  range: { start: number; end: number };
}

export interface ValidationIssue {
  severity: "warning" | "error";
  message: string;
  /** Reference to the offending name; locations are TODO. */
  ref?: { kind: "table" | "column"; name: string };
}
