import { describe, expect, it } from "vitest";
import { expand } from "../src/index.js";

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

describe("CTE → main query separator", () => {
  it("comma separator: CTE then unrelated main FROM", () => {
    const sql = expand(
      "{formats>id?id[1,2,3,4]}@f,wholesalers>*?format_id[f]",
    );
    expect(norm(sql)).toBe(
      "WITH f AS (SELECT id FROM formats WHERE id IN (1, 2, 3, 4)) SELECT * FROM wholesalers WHERE format_id IN (SELECT * FROM f)",
    );
  });

  it("whitespace separator (existing) still works", () => {
    const sql = expand(
      "{formats>id?id[1,2,3,4]}@f wholesalers>*?format_id[f]",
    );
    expect(norm(sql)).toContain("WITH f AS");
    expect(norm(sql)).toContain("FROM wholesalers");
  });

  it("multiple CTEs then main", () => {
    const sql = expand(
      '{src>id}@a,{src>name}@b,users>*?id[a],name[b]',
    );
    expect(norm(sql)).toContain("WITH a AS");
    expect(norm(sql)).toContain(", b AS");
    expect(norm(sql)).toContain("FROM users");
    expect(norm(sql)).toContain("WHERE id IN (SELECT * FROM a) AND name IN (SELECT * FROM b)");
  });

  it("no separator (direct flow) — implicit FROM rule applies", () => {
    // single CTE, no main FROM → main FROM = CTE name
    const sql = expand("{src>*}@x?id=1");
    expect(norm(sql)).toBe(
      "WITH x AS (SELECT * FROM src) SELECT * FROM x WHERE id = 1",
    );
  });

  it("comma separator works even without main FROM", () => {
    const sql = expand("{src>*}@x,?id=1");
    expect(norm(sql)).toBe(
      "WITH x AS (SELECT * FROM src) SELECT * FROM x WHERE id = 1",
    );
  });
});
