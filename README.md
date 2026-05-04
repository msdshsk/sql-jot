# sql-jot

> English | [日本語](README.ja.md)

Emmet-style shorthand that compiles into SQL. Designed for the Monaco editor
but the core is pure TypeScript with no editor dependency.

```
tbl@a>name,sum(price)@x#name:x<5000$-x
↓
SELECT name, sum(price) AS x
FROM tbl a
GROUP BY name
HAVING x < 5000
ORDER BY x DESC
```

## Why

SQL clients tend to grow heavy with features. sql-jot is the opposite —
a one-line shorthand for the keystroke-bound minority who'd rather type
sigils than walk through wizards.

It is *not* a SQL replacement. It compiles to standard SQL that any database
or tool can run.

## Quick start

```bash
npm install sql-jot
```

```ts
import { expand } from "sql-jot";

expand("users@u>u.name?u.id=1");
// → "SELECT u.name FROM users u WHERE u.id = 1"

expand("+users<name=\"alice\",age=30");
// → "INSERT INTO users (name, age) VALUES ('alice', 30)"

expand("=users<count+=1?id=5");
// → "UPDATE users SET count = count + 1 WHERE id = 5"

expand("users?^(orders?user_id=1)");
// → "SELECT * FROM users WHERE EXISTS (SELECT * FROM orders WHERE user_id = 1)"

expand("users?!status[\"deleted\",\"banned\"]");
// → "SELECT * FROM users WHERE status NOT IN ('deleted', 'banned')"

expand("+users<name=\"alice\">id,created_at");
// → "INSERT INTO users (name) VALUES ('alice') RETURNING id, created_at"

expand('users>?{score>=80?"pass":"fail"}@result');
// → "SELECT CASE WHEN score >= 80 THEN 'pass' ELSE 'fail' END AS result FROM users"

expand('users>?{nickname??"anon"}@display');
// → "SELECT COALESCE(nickname, 'anon') AS display FROM users"

expand("users?deleted_at=null,active=true");
// → "SELECT * FROM users WHERE deleted_at IS NULL AND active = TRUE"
//   ( =null is auto-rewritten to IS NULL; !=null / <>null give IS NOT NULL )

expand("users|>dept");
// → "SELECT DISTINCT dept FROM users"

expand("orders>count(|>user_id)@uniq");
// → "SELECT count(DISTINCT user_id) AS uniq FROM orders"

expand("users?age~[18,65]");
// → "SELECT * FROM users WHERE age BETWEEN 18 AND 65"

expand('orders>user_id?status="paid" && reviews>user_id?published=true');
// → "SELECT user_id FROM orders WHERE status = 'paid'
//    INTERSECT
//    SELECT user_id FROM reviews WHERE published = TRUE"

expand("products>id \\\\ order_items>product_id");
// → "SELECT id FROM products EXCEPT SELECT product_id FROM order_items"
```

## Syntax at a glance

| Symbol | Role | Sample |
|---|---|---|
| `>` | SELECT columns / RETURNING (trailing CUD) | `users>name`, `+users<...>id` |
| `?` | WHERE | `?id=1` |
| `+` | JOIN (or INSERT verb) | `+orders[u.id=o.user_id]` |
| `[ ]` | ON / IN | `?id[1,2,3]`, `?id[(subq)]` |
| `( )` | subquery / column list | `+users<(other>name?active=1)` |
| `{ }` | CTE / row block | `{src>id}@s` |
| `^( )` | EXISTS subquery | `?^(orders?user_id=1)` |
| `!` | NOT marker (IN / LIKE / EXISTS) | `?!id[1,2,3]`, `?!^(...)` |
| `?{ }` | CASE block (PHP-style ternary inside) | `?{x>0?"pos":"neg"}` |
| `??` | null-coalesce (chains into COALESCE) | `?{a??b??"x"}` |
| `\|>` | SELECT DISTINCT / DISTINCT inside aggregate | `users\|>dept`, `count(\|>uid)` |
| `~[ , ]` | BETWEEN (with `!` prefix → NOT BETWEEN) | `?age~[18,65]` |
| `\|\|` `\|\|*` | UNION / UNION ALL between two SELECTs | `a>id \|\| b>id` |
| `&&` `&&*` | INTERSECT / INTERSECT ALL | `a>id && b>id` |
| `\\` `\\*` | EXCEPT / EXCEPT ALL | `a>id \\ b>id` |
| `#` | GROUP BY | `#user_id` |
| `:` | HAVING | `:count>5` |
| `$` | ORDER BY | `$-created_at` |
| `~` | LIMIT/PAGE | `~20p3` |
| `%` | LIKE | `?name%"john"` |
| `@` | alias | `users@u` |
| `+` `=` `-` (leading) | INSERT / UPDATE / DELETE verbs | `+users<...`, `=users<...?...`, `-users?...` |

The complete reference is in [SYNTAX.md](SYNTAX.md).

## Schema integration

sql-jot doesn't own your schema. The host application provides a small
resolver and sql-jot uses it for FK auto-resolution, multi-hop JOIN
inference, implicit column qualification, validation and completion.

```ts
import { expand, staticResolver } from "sql-jot";

const schema = staticResolver({
  tables: [
    { name: "users", columns: ["id", "name"] },
    { name: "orders", columns: ["id", "user_id", "total"] },
  ],
  foreignKeys: [
    {
      fromTable: "orders",
      fromColumns: ["user_id"],
      toTable: "users",
      toColumns: ["id"],
    },
  ],
});

expand("users@u+orders@o", { schema });
// → "SELECT * FROM users u INNER JOIN orders o ON u.id = o.user_id"
```

For real applications, implement `SchemaResolver` directly against your
catalogue. See `src/types.ts`.

## APIs

```ts
import {
  expand,                 // shorthand → SQL string
  parse, compile,         // separate parse / compile steps
  validate,               // schema-aware validation issues
  getCandidates,          // cursor-position completion candidates
  longestCommonPrefix,    // helper for Tab-style prefix expansion
  staticResolver,         // build a SchemaResolver from a static schema
} from "sql-jot";
```

The completion API is **UX-agnostic**: it returns candidates and the host
decides how to present them (popup, inline ghost text, Tab-only,
Ctrl+Space). The Emmet ethos is "no popup interrupts" — the included
example uses Tab prefix-expansion plus inline validation squiggles, with
no autocomplete dropdown.

## Example app

A Vite + Monaco demo lives in [`example/`](example/):

```bash
cd example
npm install
npm run dev
# → http://localhost:5173
```

You get a two-pane editor with live SQL preview, syntax highlighting,
quick-load samples, validation markers and `Tab` prefix expansion.

## Status

The core covers:

- SELECT / INSERT / UPDATE / DELETE, with **`RETURNING`** as trailing `>cols`
  (PostgreSQL-style; `CompileOptions.returning` hook for MySQL/SQL Server)
- CTE blocks (`{...}@name`), multiple CTEs, optional FROM
- JOINs: INNER / LEFT / RIGHT / FULL / CROSS, with FK auto-resolve and
  multi-hop inference
- IN with literal list / table-or-CTE reference / parenthesized subquery
- **EXISTS / NOT EXISTS** via `^(...)` and `!^(...)`
- **NOT IN / NOT LIKE** via `!` prefix
- **CASE WHEN** via `?{cond?then:else}` (PHP-style ternary; right-recursive
  chains collapse to flat multi-arm CASE)
- **COALESCE** via `??` chains inside `?{...}`
- **`null` / `true` / `false` literals**, with auto `IS NULL` / `IS NOT NULL`
  rewrite for `=null` / `!=null` / `<>null`. `CompileOptions.bool` hook for
  SQL Server's `1` / `0` boolean rendering
- **`count(*)` and other `*`-arg function calls**
- **DISTINCT** at SELECT level (`|>cols`) and inside aggregates (`count(|>col)`)
- **BETWEEN** / **NOT BETWEEN** — `?col~[low,high]` / `?!col~[low,high]`
- **Set operations** — `||` UNION, `&&` INTERSECT, `\\` EXCEPT (with `*`-suffix
  for `ALL` variants); composable in CTE bodies and subqueries
- Implicit column qualification, schema-aware validation, completion
  candidates, qualified-star (`t.*`)

See [SYNTAX.md §11](SYNTAX.md#11-v0-limitations) for the current limitation
list. Notably absent: arithmetic in expressions, window functions,
recursive CTE.

## Development

```bash
npm install        # also runs the grammar build via the prepare hook
npm test           # runs vitest
```

## License

[MIT](LICENSE) © msd.shsk
