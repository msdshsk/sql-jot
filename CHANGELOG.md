# Changelog

All notable changes to sql-jot are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Pre-1.0 minor bumps signal feature batches; patch bumps are bug-fix only.

## [0.1.0] — 2026-05-05

First feature-rich release. The shorthand now covers most of the SQL
surface a Web/data engineer reaches for daily.

### Added

- **EXISTS / NOT EXISTS** — `?^(subq)` and `?!^(subq)` in WHERE/HAVING
- **NOT marker** — `!` prefix negates IN / LIKE / EXISTS predicates
  (`?!id[1,2,3]`, `?!name%"x"`, `?!^(...)`)
- **RETURNING** — trailing `>cols` on INSERT / UPDATE / DELETE.
  `CompileOptions.returning` hook for MySQL / SQL Server tail rendering
- **CASE WHEN** — `?{cond?then:else}` PHP-style ternary inside a block;
  right-recursive chains collapse to a flat multi-arm `CASE`
- **COALESCE** — `??` chain inside `?{...}` flattens to `COALESCE(...)`
- **Literals** — `null`, `true`, `false`. `=null` / `<>null` / `!=null`
  rewrite to `IS NULL` / `IS NOT NULL`. `CompileOptions.bool` hook for
  SQL Server-style `1` / `0` boolean rendering
- **`count(*)`** — `*` is now a valid function argument (only in that
  position; rejected as a general expression)
- **DISTINCT** — `|>` replaces `>` at the SELECT clause head for
  `SELECT DISTINCT`. The same prefix on a function arg
  (`count(|>user_id)`) emits `DISTINCT` inside the aggregate
- **BETWEEN / NOT BETWEEN** — `?col~[low,high]` and `?!col~[low,high]`.
  Bounds accept any Atom (literals, identifiers, function calls)
- **Set operations** — `||` UNION, `&&` INTERSECT, `\\` EXCEPT, with
  `*`-suffix (`||*` / `&&*` / `\\*`) for the `ALL` variants. Bare op
  follows SQL's `DISTINCT`-default. Composable in CTE bodies and any
  subquery context (IN, EXISTS, INSERT-SELECT)
- Demo's quick-load list expanded with samples for the new constructs

### Fixed

- **Function-arg `,` is strictly an arg separator**. Earlier the
  grammar fed `FuncArg` through `OrExpr → AndExpr`, so `coalesce(a, b)`
  parsed as `coalesce(a AND b)`. AND inside a single arg now requires
  explicit parens: `func((a,b), c)`

## [0.0.2] — 2026-04 (initial public preview)

- Core SELECT / INSERT / UPDATE / DELETE
- CTE blocks, multi-CTE, optional FROM
- JOIN: INNER / LEFT / RIGHT / FULL / CROSS, FK auto-resolve, multi-hop
- IN with literal list / table-or-CTE reference / parenthesized subquery
- Implicit column qualification, schema-aware validation, completion
- Schema-qualified table names (`public.users`)
- `LIMIT / OFFSET` with `CompileOptions.paginate` hook for dialect
  variations
