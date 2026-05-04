import { describe, expect, it } from "vitest";
import { expand, parse, staticResolver, validate } from "../src/index.js";

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

describe("count(*) — `*` as function argument", () => {
  it("count(*) in SELECT columns with alias", () => {
    expect(norm(expand("users>count(*)@total"))).toBe(
      "SELECT count(*) AS total FROM users",
    );
  });

  it("count(*) without alias", () => {
    expect(norm(expand("users>count(*)"))).toBe(
      "SELECT count(*) FROM users",
    );
  });

  it("count(*) with GROUP BY and HAVING via alias", () => {
    expect(
      norm(expand("orders#user_id>user_id,count(*)@n:n>5")),
    ).toBe(
      "SELECT user_id, count(*) AS n FROM orders GROUP BY user_id HAVING n > 5",
    );
  });

  it("count(*) directly in HAVING expression", () => {
    expect(norm(expand("orders#user_id:count(*)>5"))).toBe(
      "SELECT * FROM orders GROUP BY user_id HAVING count(*) > 5",
    );
  });

  it("count(*) inside CASE cond", () => {
    expect(
      norm(expand('users>?{count(*)>0?"some":"none"}@status')),
    ).toBe(
      "SELECT CASE WHEN count(*) > 0 THEN 'some' ELSE 'none' END AS status FROM users",
    );
  });

  it("count(*) nested in another function", () => {
    expect(norm(expand("t>coalesce(count(*),0)@n"))).toBe(
      "SELECT coalesce(count(*), 0) AS n FROM t",
    );
  });

  it("whitespace inside count( * ) is tolerated", () => {
    expect(norm(expand("users>count( * )@n"))).toBe(
      "SELECT count(*) AS n FROM users",
    );
  });

  it("count(*) with WHERE clause (typical aggregate query)", () => {
    expect(norm(expand('users>count(*)@n?active=true'))).toBe(
      "SELECT count(*) AS n FROM users WHERE active = TRUE",
    );
  });

  it("count(*) compared against null collapses to IS NULL — but it never is", () => {
    // edge case — the rewrite still triggers if the user writes it; SQL is fine
    expect(norm(expand("orders#user_id:count(*)=null"))).toBe(
      "SELECT * FROM orders GROUP BY user_id HAVING count(*) IS NULL",
    );
  });
});

describe("count(*) — validation", () => {
  it("validation does not flag * in count()", () => {
    const schema = staticResolver({
      tables: [{ name: "users", columns: ["id"] }],
    });
    const issues = validate(parse("users>count(*)@n"), schema);
    expect(issues).toEqual([]);
  });

  it("validation walks into nested args around count(*)", () => {
    const schema = staticResolver({
      tables: [{ name: "t", columns: ["x"] }],
    });
    const issues = validate(parse("t>coalesce(count(*),nope)@n"), schema);
    expect(issues.some((i) => i.message.includes("nope"))).toBe(true);
  });
});

describe("`*` is restricted to function-arg position", () => {
  it("bare * in WHERE is rejected", () => {
    expect(() => expand("users?*")).toThrow();
  });

  it("* inside IN list is rejected", () => {
    expect(() => expand("users?id[*]")).toThrow();
  });

  it("* on left of comparison is rejected", () => {
    expect(() => expand("users?*=1")).toThrow();
  });

  it("SELECT * still works (separate code path)", () => {
    expect(norm(expand("users>*"))).toBe("SELECT * FROM users");
  });

  it("qualified t.* still works (separate code path)", () => {
    expect(norm(expand("users@u>u.*"))).toBe("SELECT u.* FROM users u");
  });

  it("FULL JOIN +* still works (separate code path)", () => {
    expect(
      norm(expand("a+*b[a.id=b.id]")).startsWith("SELECT * FROM a FULL JOIN b"),
    ).toBe(true);
  });
});
