import { describe, expect, it } from "vitest";
import { expand, parse, staticResolver, validate } from "../src/index.js";

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

describe("IN with literal list (existing behavior)", () => {
  it("number literals", () => {
    expect(norm(expand("t?id[1,2,3]"))).toBe(
      "SELECT * FROM t WHERE id IN (1, 2, 3)",
    );
  });
  it("string literals", () => {
    expect(norm(expand('t?status["a","b"]'))).toBe(
      "SELECT * FROM t WHERE status IN ('a', 'b')",
    );
  });
});

describe("IN with bare identifier (table/CTE reference)", () => {
  it("CTE reference resolves to SELECT *", () => {
    const sql = expand(
      "{src>id?active=1}@selection+formats@f?f.id[selection]",
    );
    expect(norm(sql)).toContain(
      "WHERE f.id IN (SELECT * FROM selection)",
    );
  });

  it("bare table name reference", () => {
    expect(norm(expand("t?id[other_ids]"))).toBe(
      "SELECT * FROM t WHERE id IN (SELECT * FROM other_ids)",
    );
  });

  it("mixed literal and identifier rejected", () => {
    expect(() => expand("t?id[1,foo]")).toThrow();
  });
});

describe("IN with parenthesized subquery", () => {
  it("simple subquery", () => {
    const sql = expand("t?id[(other>id?active=1)]");
    expect(norm(sql)).toBe(
      "SELECT * FROM t WHERE id IN (SELECT id FROM other WHERE active = 1)",
    );
  });

  it("subquery with WHERE/ORDER/LIMIT", () => {
    const sql = expand("users?id[(audits>user_id?action=\"login\"$-id~5)]");
    expect(norm(sql)).toBe(
      "SELECT * FROM users WHERE id IN (SELECT user_id FROM audits WHERE action = 'login' ORDER BY id DESC LIMIT 5)",
    );
  });

  it("subquery with CTE inside", () => {
    const sql = expand(
      "users?id[({audits>user_id?action=\"x\"}@hot+hot)]",
    );
    expect(norm(sql)).toContain("WHERE id IN (");
    expect(norm(sql)).toContain("WITH hot AS");
  });
});

describe("IN extensions interplay with rest of grammar", () => {
  it("works alongside AND", () => {
    expect(norm(expand("t?status[1,2],age>=18"))).toBe(
      "SELECT * FROM t WHERE status IN (1, 2) AND age >= 18",
    );
  });

  it("works alongside OR with mixed forms", () => {
    expect(norm(expand("t?id[1,2]|name[lookup]"))).toBe(
      "SELECT * FROM t WHERE id IN (1, 2) OR name IN (SELECT * FROM lookup)",
    );
  });

  it("validates inner subquery via schema", () => {
    const schema = staticResolver({
      tables: [
        { name: "users", columns: ["id", "name"] },
        { name: "audits", columns: ["id", "user_id", "action"] },
      ],
    });
    const issues = validate(
      parse('users?id[(audits>user_id?wat="x")]'),
      schema,
    );
    expect(issues.some((i) => i.message.includes("wat"))).toBe(true);
  });
});
