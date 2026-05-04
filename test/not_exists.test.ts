import { describe, expect, it } from "vitest";
import { expand, parse, staticResolver, validate } from "../src/index.js";

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

describe("EXISTS — `^( ... )`", () => {
  it("basic EXISTS subquery", () => {
    expect(norm(expand("users?^(orders?user_id=1)"))).toBe(
      "SELECT * FROM users WHERE EXISTS (SELECT * FROM orders WHERE user_id = 1)",
    );
  });

  it("EXISTS with projected columns inside", () => {
    expect(norm(expand("users?^(orders>id?status=\"open\")"))).toBe(
      "SELECT * FROM users WHERE EXISTS (SELECT id FROM orders WHERE status = 'open')",
    );
  });

  it("EXISTS combined with AND/OR", () => {
    expect(norm(expand("users?active=1,^(orders?user_id=1)"))).toBe(
      "SELECT * FROM users WHERE active = 1 AND EXISTS (SELECT * FROM orders WHERE user_id = 1)",
    );
    expect(norm(expand("users?active=1|^(orders?user_id=1)"))).toBe(
      "SELECT * FROM users WHERE active = 1 OR EXISTS (SELECT * FROM orders WHERE user_id = 1)",
    );
  });

  it("EXISTS in HAVING", () => {
    expect(
      norm(expand("orders#user_id>sum(total)@s:^(audits?action=\"x\")")),
    ).toBe(
      "SELECT sum(total) AS s FROM orders GROUP BY user_id HAVING EXISTS (SELECT * FROM audits WHERE action = 'x')",
    );
  });

  it("EXISTS subquery may contain a CTE", () => {
    const sql = expand(
      "users?^({audits>user_id?action=\"login\"}@hot+hot)",
    );
    expect(norm(sql)).toContain("WHERE EXISTS (");
    expect(norm(sql)).toContain("WITH hot AS");
  });
});

describe("NOT EXISTS — `!^( ... )`", () => {
  it("basic NOT EXISTS", () => {
    expect(norm(expand("users?!^(orders?user_id=1)"))).toBe(
      "SELECT * FROM users WHERE NOT EXISTS (SELECT * FROM orders WHERE user_id = 1)",
    );
  });
});

describe("NOT IN — `!col[...]`", () => {
  it("literal list", () => {
    expect(norm(expand("t?!id[1,2,3]"))).toBe(
      "SELECT * FROM t WHERE id NOT IN (1, 2, 3)",
    );
  });
  it("table/CTE reference", () => {
    expect(norm(expand("t?!id[other_ids]"))).toBe(
      "SELECT * FROM t WHERE id NOT IN (SELECT * FROM other_ids)",
    );
  });
  it("subquery", () => {
    expect(norm(expand("t?!id[(other>id?active=1)]"))).toBe(
      "SELECT * FROM t WHERE id NOT IN (SELECT id FROM other WHERE active = 1)",
    );
  });
});

describe("NOT LIKE — `!col%\"...\"`", () => {
  it("auto-wildcard", () => {
    expect(norm(expand("t?!name%\"john\""))).toBe(
      "SELECT * FROM t WHERE name NOT LIKE '%john%'",
    );
  });
  it("explicit wildcard preserved", () => {
    expect(norm(expand("t?!name%\"j%\""))).toBe(
      "SELECT * FROM t WHERE name NOT LIKE 'j%'",
    );
  });
});

describe("NOT marker — interplay", () => {
  it("mixed NOT and positive predicates with AND", () => {
    expect(norm(expand("t?!id[1,2],active=1"))).toBe(
      "SELECT * FROM t WHERE id NOT IN (1, 2) AND active = 1",
    );
  });

  it("NOT marker only attaches to following predicate", () => {
    expect(norm(expand("t?!id[1,2]|name=\"x\""))).toBe(
      "SELECT * FROM t WHERE id NOT IN (1, 2) OR name = 'x'",
    );
  });

  it("NOT cannot wrap a comparison (rejected by parser)", () => {
    expect(() => expand("t?!a=1")).toThrow();
  });
});

describe("validation walks into EXISTS / NOT", () => {
  it("flags unknown column inside EXISTS subquery", () => {
    const schema = staticResolver({
      tables: [
        { name: "users", columns: ["id", "name"] },
        { name: "orders", columns: ["id", "user_id"] },
      ],
    });
    const issues = validate(
      parse("users?^(orders?wat=1)"),
      schema,
    );
    expect(issues.some((i) => i.message.includes("wat"))).toBe(true);
  });

  it("flags unknown column inside NOT IN", () => {
    const schema = staticResolver({
      tables: [{ name: "t", columns: ["id"] }],
    });
    const issues = validate(parse("t?!nope[1,2]"), schema);
    expect(issues.some((i) => i.message.includes("nope"))).toBe(true);
  });
});
