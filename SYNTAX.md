# sql-jot syntax reference

> English | [日本語](SYNTAX.ja.md)

Last updated: 2026-05-01

This document covers the full grammar and semantics of sql-jot as currently
implemented. If the implementation and this doc disagree, **the implementation
wins** — fix the doc.

---

## 1. Design philosophy

- **Verb prefix + operator sigils** to express SELECT/INSERT/UPDATE/DELETE in the fewest characters
- Each SQL clause gets a **unique sigil**, so top-level parsing has zero ambiguity
- Literals are double-quoted (`"x"`); identifiers are bare
- Schema-aware features (FK resolve, completion) delegate to a host-provided **Resolver**

---

## 2. Verb prefixes

| Prefix | Operation | Example |
|---|---|---|
| (none) | SELECT | `users>name?id=1` |
| `+` | INSERT | `+users<name="alice"` |
| `=` | UPDATE | `=users<name="bob"?id=1` |
| `-` | DELETE | `-users?id=1` |

**Position-dependent meaning**:
- Leading `+` `-` `=` are verbs
- Mid-statement `+` is JOIN
- Mid-statement `-` is the DESC marker inside ORDER BY
- Mid-statement `=` is a comparison operator

The grammar separates these contexts cleanly, so PEG parses them
unambiguously.

---

## 3. Operator map (within a SELECT)

| Symbol | Use | Example |
|---|---|---|
| `@` | alias | `users@u`, `sum(x)@total` |
| `>` | SELECT column list | `users>name,email` |
| `?` | WHERE | `users?id=1` |
| `+` | JOIN | `users+orders` |
| `[ ]` | ON ／ IN (list / ref / subquery) | `+t[a.id=b.id]`, `?id[1,2,3]`, `?id[cte]`, `?id[(subq)]` |
| `( )` | inline subquery ／ INSERT column list ／ expression grouping | `+t<(s>x)`, `+t(c1,c2)<(...)` |
| `{ }` | CTE (statement head) ／ INSERT row block (after `<`) | `{src>x}@s`, `+t<{a=1},{a=2}` |
| `#` | GROUP BY | `users#dept` |
| `:` | HAVING | `:count>5` |
| `$` | ORDER BY | `$-created_at,+id` |
| `~` | LIMIT/PAGE | `~20p3` |
| `,` | list separator / AND | |
| `\|` | OR | `?a=1\|b=2` |
| `%` | LIKE | `?name%"john"` |
| `"..."` | string literal | |
| `=` `<` `>` `<=` `>=` `<>` `!=` | comparison | |

---

## 4. SELECT syntax

### 4.1 Skeleton

```
[CTE block] table-ref [clauses...]
```

Clauses can appear in **any order**. The compiler reorders them into canonical
SQL order on output.

### 4.2 Table reference and alias

```
users               # no alias
users@u             # aliased as u
public.users        # schema-qualified (PostgreSQL etc.)
public.users@u      # schema-qualified with alias
db.public.users     # 3-part name (cross-database refs)
```

Dots in a table name are passed through unchanged to the SQL output, so
schema- and database-qualified references work for any dialect that
accepts that form.

### 4.3 SELECT column list — `>`

```
users>name,email                # 2 columns
users>*                         # all columns
users@u>u.*                     # qualified star (all columns of alias u)
users>name@n,email@e            # column aliases
users>sum(price)@total          # aggregate
users@u>u.name,u.email          # qualified columns
```

`t.*` and bare columns can be mixed in JOIN scope: `a@a+b@b[a.id=b.aid]>a.*,b.x`.

If omitted, defaults to `*`.

### 4.4 WHERE — `?`

```
users?id=1                      # equality
users?age>=18                   # comparison
users?id<>0                     # inequality
users?name%"john"               # LIKE
users?id[1,2,3]                 # IN
users?a=1,b=2                   # AND (comma)
users?a=1|b=2                   # OR (pipe)
users?a=1,b=2|c=3               # mixed → (a=1 AND b=2) OR c=3
users?(a=1|b=2),c=3             # explicit grouping
```

### 4.5 JOIN — `+`

| Form | JOIN type |
|---|---|
| `+tbl` | INNER (default) |
| `+<tbl` | LEFT |
| `+>tbl` | RIGHT |
| `+*tbl` | FULL |
| `+~tbl` | CROSS |

ON is given via `[ ]`:

```
users@u+orders@o[u.id=o.user_id]
```

If ON is omitted, the schema Resolver is queried for an FK (see §8).

### 4.6 GROUP BY — `#`

```
orders#user_id                  # single column
orders#user_id,status           # multiple
```

### 4.7 HAVING — `:`

```
orders#user_id>sum(total)@s:s>1000
```

Same expression grammar as WHERE.

### 4.8 ORDER BY — `$`

```
users$created_at                # ASC (default)
users$-created_at               # DESC
users$+name                     # ASC (explicit)
users$-priority,+name           # multiple keys
```

### 4.9 LIMIT / PAGE — `~`

```
users~20                        # LIMIT 20
users~20p3                      # LIMIT 20 OFFSET 40 (page=3)
```

`page=1` is the default, so OFFSET=0 emits just `LIMIT n`.

Per-dialect rendering can be swapped via `CompileOptions.paginate`.

---

## 5. CUD syntax

### 5.1 INSERT — `+`

#### 5.1.1 Single row

```
+users<name="alice",age=30
→ INSERT INTO users (name, age) VALUES ('alice', 30)
```

#### 5.1.2 Multiple rows (using `{}` row blocks)

```
+users<{name="alice",age=30},{name="bob",age=25}
→ INSERT INTO users (name, age) VALUES ('alice', 30), ('bob', 25)
```

Every row block must declare the **same columns in the same order** —
violations are caught at compile time.

#### 5.1.3 INSERT...SELECT

```
+users<(other>name,age?active=1)
→ INSERT INTO users SELECT name, age FROM other WHERE active = 1

+users(name,age)<(other>name,age?active=1)
→ INSERT INTO users (name, age) SELECT name, age FROM other WHERE active = 1
```

The column list is given via `( )` after the verb+table. If omitted, no
target column list is emitted.

### 5.2 UPDATE — `=`

```
=users<active=0?id=5
→ UPDATE users SET active = 0 WHERE id = 5

=users<a=1,b="x"?id=5
→ UPDATE users SET a = 1, b = 'x' WHERE id = 5

=users@u<active=0?u.id=5
→ UPDATE users u SET active = 0 WHERE u.id = 5
```

#### 5.2.1 Compound assignment (SET right-hand side only)

| Operator | Expansion |
|---|---|
| `+=` | `col = col + v` |
| `-=` | `col = col - v` |
| `*=` | `col = col * v` |
| `/=` | `col = col / v` |

```
=users<count+=1?id=5
→ UPDATE users SET count = count + 1 WHERE id = 5
```

Compound assignment is valid **only** in SET right-hand sides. Other
expressions don't yet support arithmetic.

### 5.3 DELETE — `-`

```
-users?id=5
→ DELETE FROM users WHERE id = 5

-users
→ DELETE FROM users      # WHERE-less DELETE is permitted at the syntax level
```

> Mass-delete is intentionally not blocked at the syntax level. Safety guards
> belong in the host application.

---

## 6. CTE — `{ }` prefix

```
{src>name?active=1}@active_users + users@u[active_users.id=u.id]
→ WITH active_users AS (SELECT name FROM src WHERE active = 1)
   SELECT * FROM active_users
   INNER JOIN users u ON active_users.id = u.id
```

**Rules**:
- `{ ... }@name` defines one CTE
- Multiple CTEs: `{...}@a,{...}@b` (comma separated)
- An **optional `,`** is allowed between the CTE block and the main query
  (mirrors the SQL feel of `WITH a AS (...), b AS (...) SELECT...`):

```
{formats>id?id[1,2,3,4]}@f,wholesalers>*?format_id[f]
→ WITH f AS (SELECT id FROM formats WHERE id IN (1,2,3,4))
   SELECT * FROM wholesalers WHERE format_id IN (SELECT * FROM f)
```

- If the main query has no FROM and there's exactly **one** CTE, that CTE
  becomes the implicit FROM
- A CTE block can also precede a CUD verb: `{...}@s+target<(s>...)`

---

## 7. Expressions

### 7.1 Literals

```
1            integer
1.5          float
"hello"      string (escapes inside ": \" \\)
```

### 7.2 Identifiers

```
name         simple
u.name       qualified (one dot)
```

### 7.3 Function calls

```
sum(price)
count(*)              # NOTE: bare * argument is not yet supported in v0
coalesce(a,b,c)
lower(name)
```

**Note**: `count(*)` — using `*` as an argument — is unsupported in v0. Use
`count(id)` or any non-null column.

### 7.4 Comparison

```
=  <>  !=  <  <=  >  >=
```

### 7.5 LIKE — `%"pattern"`

```
?name%"john"            → name LIKE '%john%'   # auto two-sided wildcards
?name%"j%"              → name LIKE 'j%'
?name%"%n"              → name LIKE '%n'
?name%"%john%"          → name LIKE '%john%'   # already has %, passes through
```

Rule: if the quoted pattern contains **no `%`**, sql-jot wraps it on both
sides. If it already contains `%`, it's passed through unchanged.

### 7.6 IN — `column[...]`

The contents of `[ ]` take one of three forms:

| Form | Syntax | Expansion |
|---|---|---|
| **Literal list** | `?col[1,2,3]` | `col IN (1, 2, 3)` |
| **Table / CTE reference** | `?col[name]` | `col IN (SELECT * FROM name)` |
| **Subquery** | `?col[(subq)]` | `col IN (subq compiled to SQL)` |

```
?status[1,2,3]                  → status IN (1, 2, 3)
?status["a","b","c"]            → status IN ('a', 'b', 'c')
?id[selection]                  → id IN (SELECT * FROM selection)
?id[(audits>user_id?action="login")]
                                → id IN (SELECT user_id FROM audits WHERE action = 'login')
```

**Rules**:
- Literal-list elements must be number or string. Mixing literals with
  identifiers fails the parse
- The reference form takes a single bare identifier. `[t.col]` is not allowed
  — use `[(t>col)]` instead
- The subquery form uses `( ... )` to delimit the inner query. Nested CTEs
  are allowed inside

---

## 8. Schema integration

`expand(src, { schema })` accepts a `SchemaResolver` for `schema`.

### 8.1 Resolver interface

```ts
interface JoinPathStep {
  table: string;
  fromCols: string[];
  toCols: string[];
}

interface SchemaResolver {
  // Path of JOINs from `from` to `to`. length=1 for a direct FK,
  // larger for multi-hop.
  resolveJoin(from: string, to: string): JoinPathStep[] | null;

  // Column names of the named table.
  listColumns(table: string): string[] | null;

  // Optional: enumerate all known tables (used for completion).
  listTables?(): string[] | null;
}
```

The host implements this directly, or builds one from a static description
via `staticResolver(schema)`.

### 8.2 FK auto-resolve

When ON is omitted, the Resolver supplies it:

```
users@u+orders@o
→ ... INNER JOIN orders o ON u.id = o.user_id
```

### 8.3 Multi-hop JOIN inference

If no direct FK exists but `resolveJoin` returns a multi-step path,
intermediate JOINs are spliced in:

```
users+items
→ ... INNER JOIN orders ON users.id = orders.user_id
      INNER JOIN items ON orders.id = items.order_id
```

- Intermediate JOINs are always **INNER**
- The user-specified JOIN type (`+<` etc.) applies **only to the final step**
- The user-specified alias (if any) is attached **only to the final step**

### 8.4 Implicit column qualification

When multiple tables are in scope and a bare column exists in **exactly one**
of them, the compiler qualifies it automatically:

```
users+orders?total>1000
→ ... WHERE orders.total > 1000     # `total` exists only on orders
```

Columns that exist on multiple tables are **left bare** (e.g.
`created_at`); `validate()` flags them as ambiguous.

### 8.5 Validation — `validate(ast, schema)`

Returns `ValidationIssue[]`. Source-position info is not yet tracked
(name-based references only).

Detected problems:
- Unknown table
- Unknown column on a known table
- Ambiguous bare column across tables in scope
- Reference to an unknown table or alias (head of a qualified id)

### 8.6 Candidates — `getCandidates(input, cursor, schema)`

Returns the relevant candidates for the cursor position. **UX is not
prescribed** — that's the host's responsibility.

| Token before cursor | Candidate kind |
|---|---|
| Start / `+` / `-` / `(` | tables |
| `>` `?` `:` `#` `$` `,` `<` `\|` `=` `[` | columns (in-scope tables) |
| `<ident>.` | columns of that table or alias |
| `@` | (no candidates — naming an alias) |

`longestCommonPrefix(candidates)` is provided as a helper for
Tab-style prefix expansion.

---

## 9. Parse-time context rules (impl notes)

### 9.1 Symbol multi-use

| Symbol | Context | Meaning |
|---|---|---|
| `+` | start of statement | INSERT verb |
| `+` | after table-ref / between clauses | JOIN |
| `+` | inside an OrderItem | ASC marker |
| `-` | start of statement | DELETE verb |
| `-` | inside an OrderItem | DESC marker |
| `-` | leading a number literal | unary minus |
| `=` | start of statement | UPDATE verb |
| `=` | inside an expression | comparison operator |
| `=` | inside a SET clause | assignment |
| `<` | after a verb | introduces VALUES/SET |
| `<` | inside a JoinType | LEFT |
| `<` | inside an expression | comparison |
| `>` | after a table-ref | SELECT column list |
| `>` | inside a JoinType | RIGHT |
| `>` | inside an expression | comparison |
| `[ ]` | after a JOIN | ON clause |
| `[ ]` | after a column | IN |
| `( )` | between a verb-table and `<` | INSERT column list |
| `( )` | after `<` | subquery |
| `( )` | inside an expression | grouping |
| `{ }` | start of statement | CTE |
| `{ }` | after `<` | INSERT row block |
| `,` | inside a WHERE/HAVING expression | AND |
| `,` | inside a list (SELECT/GROUP/ORDER/etc.) | separator |
| `,` | between the CTE block and main query | optional separator |
| `*` | as a single SELECT item | all columns |
| `*` | as `<ident>.*` | qualified star |
| `*` | inside a JoinType | FULL JOIN |

### 9.2 Literals

- Strings: `"..."` (mandatory)
- Numbers: integer or float

Boolean / null literals (`true`, `false`, `null`) are not yet first-class.

---

## 10. v0 limitations

| Item | Status | Notes |
|---|---|---|
| Arithmetic in expressions (`a+b`, `a*2`) | Not supported | Only `+= -= *= /=` on the SET right-hand side |
| `count(*)` `*` argument | Not supported | Use `count(id)` |
| `IS NULL` / `IS NOT NULL` | Not supported | |
| `BETWEEN` | Not supported | Use `?x>=a,x<=b` |
| `true` / `false` / `null` literals | Not supported | |
| JOINs in UPDATE / DELETE | Not supported | |
| Correlated subqueries outside IN | Not supported | IN supports `[(subq)]` |
| Multi-CTE test coverage | Thin | Grammar supports it |
| Source positions in `validate` | Not supported | Names only |
| Shorthand for `BETWEEN` / `IS NULL` | Not designed | |
| UNION / UNION ALL | Not supported | |
| Window functions | Not supported | |
| DISTINCT | Not supported | |

---

## 11. Design rationale archive

Notes on "why this way" that came out of the design discussions, kept here
to prevent re-litigation later.

- **`+` as INSERT verb**: visual symmetry with `-` (DELETE). SQL has no
  leading `+`, so there's no clash
- **`{}` for row blocks, `()` for column lists**: `()` matches SQL native
  syntax. `{}` is left meaning purely "block"
- **Compound assignment limited to SET RHS**: avoids opening up arithmetic
  in all expressions while still covering the common counter case
- **DELETE doesn't require WHERE at the syntax level**: that's a runtime
  policy, not a grammar concern
- **LIKE uses `%` inside quotes**: keeps literal handling consistent. The
  bare-`%` form had an inverted relationship to the SQL `%` position, which
  was confusing
- **`~20p3` with the `p` suffix**: `/` was confusing because `1/20` reads
  like a fraction
- **`,` for AND, `|` for OR**: AND is overwhelmingly more common, so it
  gets the shorter symbol
- **Schema is not owned by sql-jot**: the package is pure shorthand
  expansion. Schema fetching, caching, type tracking are all the host's job
- **No autocomplete popup**: popups break the typing rhythm Emmet exists
  for. Tab prefix-expansion and Ctrl+Space are exposed as inputs to the
  host; UI choices stay with the host

### 11.1 Operator mnemonics

A cheat sheet for "why this character?" so future-self doesn't have to
re-derive it.

| Symbol | Origin |
|---|---|
| `$` | The shape of `$` is **S** with a stroke → **s**ort (ORDER BY) |
| `?` | "what?" → query condition (WHERE) |
| `%` | The SQL `%` wildcard, reused literally (LIKE) |
| `#` | hash / tag → clustering (GROUP BY) |
| `:` | "with this property" — labels (HAVING) |
| `@` | "at" → an alias address |
| `+` / `-` | add/remove → row insert/delete |
| `=` | assignment → row update |
| `>` | data flowing out (SELECT columns) |
| `<` | data flowing in (INSERT/UPDATE VALUES/SET intro) |
| `~` | "approximately N" feel (LIMIT) |
| `\|` | pipe → logical OR |
| `,` | enumeration → AND / list separator |
| `{}` | block of grouped items (CTE / row block) |
| `[]` | subscript-like → IN list / ON mapping |
| `()` | regular grouping / subquery / INSERT column list |

---

## 12. Public API

```ts
import {
  expand,                  // (src, options?) => SQL string
  parse,                   // (src) => Query AST
  compile,                 // (ast, options?) => SQL string
  validate,                // (ast, schema) => ValidationIssue[]
  getCandidates,           // (input, cursor, schema) => CandidatesResult
  longestCommonPrefix,     // (string[]) => string
  staticResolver,          // (StaticSchema) => SchemaResolver
} from "sql-jot";

import type {
  Query, MainQuery, Expr, Join, TableRef,
  CompileOptions, SchemaResolver, JoinPathStep,
  Candidate, CandidatesResult, ValidationIssue,
  StaticSchema, StaticTable, StaticForeignKey,
} from "sql-jot";
```
