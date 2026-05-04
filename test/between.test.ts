import { describe, expect, it } from "vitest";
import { expand, parse, staticResolver, validate } from "../src/index.js";

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

describe("BETWEEN — `?col~[low,high]`", () => {
  it("number range", () => {
    expect(norm(expand("users?age~[18,65]"))).toBe(
      "SELECT * FROM users WHERE age BETWEEN 18 AND 65",
    );
  });

  it("string range (date literals)", () => {
    expect(
      norm(expand('events?date~["2026-01-01","2026-12-31"]')),
    ).toBe(
      "SELECT * FROM events WHERE date BETWEEN '2026-01-01' AND '2026-12-31'",
    );
  });

  it("identifier bounds", () => {
    expect(norm(expand("orders?total~[min_total,max_total]"))).toBe(
      "SELECT * FROM orders WHERE total BETWEEN min_total AND max_total",
    );
  });

  it("function-call bounds", () => {
    expect(
      norm(expand("events?date~[now(),end_date]")),
    ).toBe(
      "SELECT * FROM events WHERE date BETWEEN now() AND end_date",
    );
  });

  it("qualified column", () => {
    expect(
      norm(expand("users@u+orders@o?u.age~[18,65]")),
    ).toContain("WHERE u.age BETWEEN 18 AND 65");
  });
});

describe("NOT BETWEEN — `?!col~[low,high]`", () => {
  it("basic NOT BETWEEN", () => {
    expect(norm(expand("users?!age~[18,65]"))).toBe(
      "SELECT * FROM users WHERE age NOT BETWEEN 18 AND 65",
    );
  });
});

describe("BETWEEN — interplay", () => {
  it("with AND (`,`)", () => {
    expect(norm(expand("users?age~[18,65],active=true"))).toBe(
      "SELECT * FROM users WHERE age BETWEEN 18 AND 65 AND active = TRUE",
    );
  });

  it("with OR (`|`)", () => {
    expect(norm(expand("users?age~[18,65]|priority=1"))).toBe(
      "SELECT * FROM users WHERE age BETWEEN 18 AND 65 OR priority = 1",
    );
  });

  it("BETWEEN in HAVING", () => {
    expect(
      norm(
        expand("orders#user_id>user_id,sum(total)@s:s~[100,1000]"),
      ),
    ).toBe(
      "SELECT user_id, sum(total) AS s FROM orders GROUP BY user_id HAVING s BETWEEN 100 AND 1000",
    );
  });

  it("multiple BETWEENs", () => {
    expect(
      norm(expand("events?date~[1,10],time~[100,200]")),
    ).toBe(
      "SELECT * FROM events WHERE date BETWEEN 1 AND 10 AND time BETWEEN 100 AND 200",
    );
  });

  it("BETWEEN combined with NOT IN", () => {
    expect(
      norm(expand("users?age~[18,65],!status[1,2]")),
    ).toBe(
      "SELECT * FROM users WHERE age BETWEEN 18 AND 65 AND status NOT IN (1, 2)",
    );
  });
});

describe("BETWEEN — validation", () => {
  const schema = staticResolver({
    tables: [{ name: "users", columns: ["id", "age", "name"] }],
  });

  it("flags unknown column on the BETWEEN col", () => {
    const issues = validate(parse("users?nope~[1,10]"), schema);
    expect(issues.some((i) => i.message.includes("nope"))).toBe(true);
  });

  it("flags unknown identifiers inside the bounds", () => {
    const issues = validate(parse("users?age~[lo,hi]"), schema);
    expect(issues.some((i) => i.message.includes("lo"))).toBe(true);
    expect(issues.some((i) => i.message.includes("hi"))).toBe(true);
  });

  it("does not flag known column with literal bounds", () => {
    const issues = validate(parse("users?age~[18,65]"), schema);
    expect(issues).toEqual([]);
  });
});
