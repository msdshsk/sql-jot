# sql-jot syntax reference

> English | [日本語](SYNTAX.ja.md)

Last updated: 2026-05-05 (RETURNING / CASE / null+bool / count(\*) / DISTINCT / BETWEEN)

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
| `^( )` | EXISTS subquery (in WHERE / HAVING) | `?^(t?x=1)` |
| `!` | NOT marker — prefixes IN / LIKE / EXISTS | `?!id[1,2,3]`, `?!^(...)` |
| `?{ }` | CASE expression (PHP-style ternary inside) | `?{x>0?"pos":"neg"}` |
| `??` | null-coalesce (chains into `COALESCE(...)`) | `?{a??b??"x"}` |
| `\|>` | `SELECT DISTINCT` (replaces `>`) ／ `DISTINCT` inside func arg | `users\|>name`, `count(\|>uid)` |
| `~[ , ]` | BETWEEN (with `!` prefix → NOT BETWEEN) | `?age~[18,65]`, `?!age~[18,65]` |
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

#### `|>` — DISTINCT prefix

Replace the leading `>` of the SELECT clause with `|>` to emit
`SELECT DISTINCT`:

```
users|>dept                     → SELECT DISTINCT dept FROM users
users|>name,email               → SELECT DISTINCT name, email FROM users
users|>*                        → SELECT DISTINCT * FROM users
```

For DISTINCT **inside an aggregate**, use `|>` as a prefix on the
function argument instead:

```
orders>count(|>user_id)@uniq    → SELECT count(DISTINCT user_id) AS uniq FROM orders
```

### 4.4 WHERE — `?`

```
users?id=1                      # equality
users?age>=18                   # comparison
users?id<>0                     # inequality
users?name%"john"               # LIKE
users?id[1,2,3]                 # IN
users?age~[18,65]               # BETWEEN
users?^(orders?user_id=1)       # EXISTS
users?!id[1,2,3]                # NOT IN
users?!name%"john"              # NOT LIKE
users?!age~[18,65]              # NOT BETWEEN
users?!^(orders?user_id=1)      # NOT EXISTS
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

### 5.4 RETURNING — trailing `>cols`

Append `>cols` to any CUD statement to emit a `RETURNING` clause. The column
list shares its grammar with SELECT (aliases, `*`, qualified `t.*` all work):

```
+users<name="alice">id,created_at
→ INSERT INTO users (name) VALUES ('alice') RETURNING id, created_at

=products<price*=1.1?category="food">id,price
→ UPDATE products SET price = price * 1.1 WHERE category = 'food'
   RETURNING id, price

-sessions?expires_at<now()>user_id,token
→ DELETE FROM sessions WHERE expires_at < now()
   RETURNING user_id, token

+users<name="alice">*
→ INSERT INTO users (name) VALUES ('alice') RETURNING *
```

#### Dialect override — `CompileOptions.returning`

`RETURNING` is supported by PostgreSQL, SQLite 3.35+, and MariaDB. For
MySQL or SQL Server (which use `OUTPUT`), pass a hook to render the tail
yourself:

```ts
expand('+users<name="alice">id', {
  returning: ({ verb, table, cols }) => {
    if (verb === "insert") return "; SELECT LAST_INSERT_ID()";
    return "";  // suppress for other verbs
  },
});
```

Returning an empty string from the hook suppresses the trailing tail.

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
null         SQL NULL
true / false boolean
```

`null`, `true`, `false` are recognized as literals by word boundary, so
identifiers like `nullable` / `true_color` / `falsey` continue to parse as
ordinary identifiers.

#### `null` and the `IS NULL` rewrite

SQL treats `col = NULL` as always UNKNOWN — never TRUE — so it has to be
written as `col IS NULL` to actually filter rows. sql-jot rewrites
comparisons against `null` automatically:

| Source | Output |
|---|---|
| `?col=null` | `WHERE col IS NULL` |
| `?col<>null` | `WHERE col IS NOT NULL` |
| `?col!=null` | `WHERE col IS NOT NULL` |
| `?col<null` (and other ops) | passes through verbatim — UNKNOWN in SQL |

In **non-comparison** positions, `null` passes through as the SQL `NULL`
literal:

| Source | Output |
|---|---|
| `+t<x=null` (INSERT value) | `... VALUES (NULL)` |
| `=t<x=null?id=1` (SET RHS) | `... SET x = NULL ...` |
| `coalesce(a,null)` (function arg) | `coalesce(a, NULL)` |
| `?{x>0?"y":null}` (CASE branch) | `... ELSE NULL END` — the workaround for ELSE-less CASE |

#### `true` / `false` and the dialect hook

`true` / `false` emit as `TRUE` / `FALSE` by default — works in PostgreSQL,
MySQL, MariaDB, SQLite. SQL Server doesn't have boolean literals (uses
`BIT` columns with `1` / `0`); pass a hook for that case:

```ts
expand("users?active=true", {
  bool: (v) => (v ? "1" : "0"),
});
// → "SELECT * FROM users WHERE active = 1"
```

The hook is consulted only for emitting the literal itself; the
`IS NULL` rewrite is independent and unaffected.

### 7.2 Identifiers

```
name         simple
u.name       qualified (one dot)
```

### 7.3 Function calls

```
sum(price)
count(*)              # bare * is allowed only as a function arg
coalesce(a,b,c)
lower(name)
```

`,` between arguments is strictly an arg separator. To pass an AND
expression as a single argument, wrap it in parens: `func((a,b),c)`.

`*` is permitted only as a function argument (the `count(*)` idiom). In
any other expression position (`?*`, `?col[*]`, etc.) it's a parse
error — `*` for "all columns" lives in the SELECT-item grammar, not in
expressions.

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

### 7.7 BETWEEN — `col~[low,high]`

The `~` prefix between a column and a 2-element bracket list emits
`BETWEEN low AND high` (inclusive, matching SQL):

```
?age~[18,65]                    → age BETWEEN 18 AND 65
?date~["2026-01-01","2026-12-31"]
                                → date BETWEEN '2026-01-01' AND '2026-12-31'
?total~[min_total,max_total]    → total BETWEEN min_total AND max_total
?date~[now(),end_date]          → date BETWEEN now() AND end_date
```

The bounds accept any Atom (literals, identifiers, function calls), but
not full expression-level `,`-AND or `|`-OR — wrap in parens if needed.

NOT BETWEEN reuses the existing `!` marker:

```
?!age~[18,65]                   → age NOT BETWEEN 18 AND 65
```

### 7.8 EXISTS — `^( ... )`

A bare predicate (not bound to any column) that tests whether the inner
query produces at least one row. The contents of `^( ... )` are an entire
sql-jot query — anything legal at top level is legal here.

```
?^(orders?user_id=1)
                                → EXISTS (SELECT * FROM orders WHERE user_id = 1)

?^(orders>id?status="open")
                                → EXISTS (SELECT id FROM orders WHERE status = 'open')
```

EXISTS is a predicate, so it composes with `,` (AND) and `|` (OR) like any
other predicate. It's also valid in HAVING.

### 7.9 NOT — `!` prefix

`!` placed before an IN / LIKE / EXISTS predicate negates it. The marker
applies to **the immediately following predicate only** — it doesn't propagate
through `,` or `|`.

```
?!id[1,2,3]                     → id NOT IN (1, 2, 3)
?!name%"john"                   → name NOT LIKE '%john%'
?!^(orders?user_id=1)           → NOT EXISTS (SELECT * FROM orders WHERE user_id = 1)
```

`!` is **not** a general boolean negation in v0 — it's only valid before
IN / LIKE / EXISTS. `?!a=1` is a parse error.

### 7.10 CASE — `?{ ... }` (PHP-style ternary inside)

Inside `?{ ... }` the parser treats the body as a single PHP/C/JS-style
ternary expression. Right-recursive `?:` chains compile to a flat
`CASE WHEN ... THEN ... ELSE ... END`.

```
?{x>0?"pos":"neg"}
                                → CASE WHEN x > 0 THEN 'pos' ELSE 'neg' END

?{score>=90?"A":score>=80?"B":score>=70?"C":"F"}
                                → CASE WHEN score >= 90 THEN 'A'
                                       WHEN score >= 80 THEN 'B'
                                       WHEN score >= 70 THEN 'C'
                                       ELSE 'F' END
```

The ternary cond accepts the full WHERE-style expression grammar, so `,`
(AND), `|` (OR), comparisons, IN, LIKE, EXISTS, etc. all work:

```
?{a=1,b=2?"both":"none"}        → CASE WHEN a = 1 AND b = 2 THEN 'both' ELSE 'none' END
```

`?{ ... }` is an Atom — it's valid anywhere an expression is (SELECT cols,
WHERE, HAVING, function args, INSERT row values, UPDATE SET RHS).

Whitespace inside the block is free, so a vertical layout reads like a
case-arm list:

```
?{
  score>=90?"A":
  score>=80?"B":
  score>=70?"C":
  "F"
}
```

ELSE cannot be omitted (ternary always has both branches). If you want a
NULL fallback, wait until `null` literals are added in a future round, or
use a sentinel value.

### 7.11 COALESCE — `??` chain

`??` inside `?{ ... }` is the null-coalescing operator. Chains flatten into
a single `COALESCE(...)` call:

```
?{nickname??"anon"}             → COALESCE(nickname, 'anon')
?{a??b??c??"d"}                 → COALESCE(a, b, c, 'd')
```

`??` binds tighter than `?:`, so it can appear in ternary cond/then/else:

```
?{score>=80?"pass":fallback??"unknown"}
→ CASE WHEN score >= 80 THEN 'pass'
       ELSE COALESCE(fallback, 'unknown') END
```

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
| `!` | transparent — context is taken from the char before `!` |

`longestCommonPrefix(candidates)` is provided as a helper for
Tab-style prefix expansion.

---

## 9. SQL output dialect

The compiler emits SQL flavored after **PostgreSQL / MySQL / SQLite**. Most
clauses are SQL-92/99 standard; one piece is dialect-specific.

### 9.1 What's standard

| Feature | Standard |
|---|---|
| `SELECT ... FROM ... WHERE ...` | SQL-92 |
| `INNER / LEFT / RIGHT / FULL / CROSS JOIN` | SQL-92 |
| `WITH ... AS (...)` (CTE) | SQL:1999 |
| `IN (subquery)` | SQL-92 |
| `LIKE '%...%'` | SQL-92 |
| Multi-row `VALUES (a),(b)` | SQL:2003 (Oracle pre-23 doesn't support it) |
| `INSERT ... SELECT ...` | SQL-92 |

### 9.2 What's dialect-specific

**`LIMIT n OFFSET m`** is the main divergence:

| Database | Native syntax |
|---|---|
| PostgreSQL / MySQL / SQLite | `LIMIT 20 OFFSET 40` ← default sql-jot output |
| SQL Server (2012+) | `OFFSET 40 ROWS FETCH NEXT 20 ROWS ONLY` |
| Oracle (12c+) | `OFFSET 40 ROWS FETCH NEXT 20 ROWS ONLY` |
| SQL:2008 standard | `OFFSET 40 ROWS FETCH FIRST 20 ROWS ONLY` |

### 9.3 Overriding via `paginate`

`CompileOptions.paginate` swaps the LIMIT emission per dialect:

```ts
expand("users~20p3", {
  paginate: ({ limit, page }) => {
    const offset = (page - 1) * limit;
    return `OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`;
  },
});
// → "... OFFSET 40 ROWS FETCH NEXT 20 ROWS ONLY"
```

### 9.4 Other potential differences (not currently handled)

- Boolean literals — `TRUE` / `FALSE` in PG / MySQL / MariaDB / SQLite is the default. SQL Server has no boolean literal (uses `BIT` columns with `1` / `0`); use the `CompileOptions.bool` hook (see §7.1) to swap the rendering
- String concatenation (`||` standard, `+` in SQL Server, `CONCAT()` in MySQL legacy) — not yet supported
- Identifier quoting (`"x"` PG, `` `x` `` MySQL, `[x]` SQL Server) — sql-jot emits identifiers bare, so reserved-word column names won't survive cross-dialect porting unmodified

### 9.5 Future plan

A `dialect: "postgres" | "mysql" | "sqlserver" | "oracle"` switch on
`CompileOptions` could centralize variations once the divergence list grows
beyond LIMIT. Not yet implemented — the `paginate` hook is sufficient for
the current scope.

---

## 10. Parse-time context rules (impl notes)

### 10.1 Symbol multi-use

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
| `*` | as a function argument | the `count(*)` idiom |
| `\|>` | leading the SELECT clause | `SELECT DISTINCT` |
| `\|>` | leading a function arg | `DISTINCT` inside the aggregate |
| `~[ , ]` | after a column in a predicate | BETWEEN |
| `^(` | inside WHERE/HAVING | EXISTS subquery |
| `!` | leading a predicate (IN / LIKE / EXISTS) | NOT marker |
| `!=` | between two atoms | not-equal comparison |
| `>` | trailing a CUD body | RETURNING column list |
| `?{` | at expression position | CASE block |
| `?` | inside `?{...}`, between cond and then | ternary marker |
| `:` | inside `?{...}`, between then and else | ternary separator |
| `??` | inside `?{...}`, between operands | null-coalesce |

### 10.2 Literals

- Strings: `"..."` (mandatory)
- Numbers: integer or float

Boolean and null literals: `true` / `false` / `null` are recognized by
word boundary. See §7.1 for the comparison-rewrite rules.

---

## 11. v0 limitations

| Item | Status | Notes |
|---|---|---|
| Arithmetic in expressions (`a+b`, `a*2`) | Not supported | Only `+= -= *= /=` on the SET right-hand side |
| JOINs in UPDATE / DELETE | Not supported | |
| Correlated subqueries outside IN / EXISTS | Not supported | IN: `[(subq)]`, EXISTS: `^(subq)` |
| `!` before non-IN/LIKE/EXISTS predicates | Not supported | e.g. `?!a=1` — parse error |
| CASE / function-call expressions in ORDER BY / GROUP BY | Not supported | Both clauses only accept `QualifiedId` |
| ELSE-less CASE | Workaround | `?{cond?value:null}` — the `null` literal serves as the explicit "no else" value |
| Multi-CTE test coverage | Thin | Grammar supports it |
| Source positions in `validate` | Not supported | Names only |
| Shorthand for `BETWEEN` / `IS NULL` | Not designed | |
| UNION / UNION ALL | Not supported | |
| Window functions | Not supported | |

---

## 12. Design rationale archive

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
- **EXISTS via `^( ... )`**: a previously-unused symbol, picked for the
  "stands above the row" mnemonic. Other forms considered: bare `?(subq)`
  collided with expression grouping; text keywords (`?ex(...)`) clashed
  with the symbol-first style
- **`!` only negates IN / LIKE / EXISTS**: those three are where SQL has
  a dedicated `NOT IN` / `NOT LIKE` / `NOT EXISTS` form. General boolean
  negation (`?!a=1`) was deferred to avoid colliding with `!=` and to
  keep the predicate grammar narrow until we have a concrete need
- **RETURNING reuses `>`**: `>` already means "data flowing out" (SELECT
  column list). Reusing it for "outflow of mutation" is semantically
  consistent. Conflict-free because no CUD body currently ends with `>`
  having any other meaning
- **CASE uses PHP-style ternary inside `?{ ... }`**: every PHP/JS/C/TS
  developer knows `?:` and `??`. Right-recursive ternary chains collapse
  into a flat multi-arm `CASE WHEN` at compile time, so the source-level
  "nesting" doesn't survive into SQL. Alternative arm-list designs
  (`?{a:b,c:d,default}`) were rejected as more novel and offering no
  readability win at the same character count
- **ELSE is mandatory in `?{...}`**: with the `null` literal now in,
  `?{cond?value:null}` is the explicit "no else" form. A separate
  ELSE-less syntax would only save 4 chars and add another rule
- **`null` rewrites to `IS NULL`**: SQL semantically rejects `col = NULL`
  (always UNKNOWN), so passing it through verbatim would silently produce
  zero-row results. The compile-time rewrite makes the natural-looking
  `?col=null` actually work. Other comparison operators (`<` / `>` etc.)
  with `null` are left verbatim — those are user errors, not idioms
- **`,` inside function args is strictly an arg separator**: matches SQL
  convention. AND inside an arg requires explicit parens
  (`func((a,b),c)`). Earlier the grammar greedily consumed `,` as AND
  even inside `()`, which made multi-arg `coalesce(a,b)` impossible
- **`|>` for DISTINCT, both at SELECT level and inside function args**:
  same prefix, same semantics ("filter out duplicates from this stream
  of values"), so reusing the marker keeps the surface small. Visually,
  `|>` reads as a narrowed pipe — the data still flows out, but
  thinned. The optional `|` is consumed only at clause-boundary, so
  in-expression `|`-OR is unaffected
- **`~[low,high]` for BETWEEN**: tilde is the natural "from-to" symbol
  in Japanese typography (`月〜金`) and isn't strongly bound to any
  other meaning in English programming. The bracketed pair signals
  "two values" without ambiguity vs the IN list (which has no `~`
  prefix). NOT BETWEEN piggybacks on the existing `!` marker, keeping
  the negation surface uniform across IN / LIKE / EXISTS / BETWEEN

### 12.1 Operator mnemonics

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
| `^( )` | "stands above" the inner row → EXISTS |
| `!` | borrowed from C-family logical NOT |
| `?{ }` | "which? block" — ternary case in a block |
| `??` | PHP/C# null-coalesce, reused literally |
| `\|>` | narrowed pipe → DISTINCT (filtered outflow) |
| `~[ , ]` | tilde reads as "from-to" in JP typography → BETWEEN |

---

## 13. Public API

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
