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
```

## Syntax at a glance

| Symbol | Role | Sample |
|---|---|---|
| `>` | SELECT columns | `users>name,email` |
| `?` | WHERE | `?id=1` |
| `+` | JOIN (or INSERT verb) | `+orders[u.id=o.user_id]` |
| `[ ]` | ON / IN | `?id[1,2,3]`, `?id[(subq)]` |
| `( )` | subquery / column list | `+users<(other>name?active=1)` |
| `{ }` | CTE / row block | `{src>id}@s` |
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

v0.0.1. The core covers SELECT/INSERT/UPDATE/DELETE, CTE, JOINs (INNER/
LEFT/RIGHT/FULL/CROSS), schema-driven JOIN inference, three-way IN, and
qualified-star. See [SYNTAX.md §10](SYNTAX.md#10-v0-limitations) for
unimplemented features.

## Development

```bash
npm install        # also runs the grammar build via the prepare hook
npm test           # runs vitest
```

## License

[MIT](LICENSE) © msd.shsk
