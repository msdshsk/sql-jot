import { describe, expect, it } from "vitest";
import { expand, parse, staticResolver, validate } from "../src/index.js";

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

describe("null literal — IS NULL / IS NOT NULL rewrite", () => {
  it("`=null` → IS NULL", () => {
    expect(norm(expand("users?deleted_at=null"))).toBe(
      "SELECT * FROM users WHERE deleted_at IS NULL",
    );
  });

  it("`!=null` → IS NOT NULL", () => {
    expect(norm(expand("users?deleted_at!=null"))).toBe(
      "SELECT * FROM users WHERE deleted_at IS NOT NULL",
    );
  });

  it("`<>null` → IS NOT NULL", () => {
    expect(norm(expand("users?deleted_at<>null"))).toBe(
      "SELECT * FROM users WHERE deleted_at IS NOT NULL",
    );
  });

  it("null on the LEFT of comparison also rewrites", () => {
    expect(norm(expand("users?null=deleted_at"))).toBe(
      "SELECT * FROM users WHERE deleted_at IS NULL",
    );
  });

  it("comparisons other than =/!=/<> with null pass through", () => {
    // `x < null` is technically UNKNOWN in SQL, but we don't second-guess;
    // emit verbatim so the user can see what they wrote.
    expect(norm(expand("users?score<null"))).toBe(
      "SELECT * FROM users WHERE score < NULL",
    );
  });

  it("composes with AND/OR", () => {
    expect(norm(expand("users?deleted_at=null,active=1"))).toBe(
      "SELECT * FROM users WHERE deleted_at IS NULL AND active = 1",
    );
    expect(norm(expand("users?deleted_at=null|expired=null"))).toBe(
      "SELECT * FROM users WHERE deleted_at IS NULL OR expired IS NULL",
    );
  });

  it("works on a function call expression", () => {
    expect(norm(expand("users?coalesce(a,b)=null"))).toBe(
      "SELECT * FROM users WHERE coalesce(a, b) IS NULL",
    );
  });
});

describe("null literal — non-comparison contexts pass NULL through", () => {
  it("INSERT row value", () => {
    expect(norm(expand("+users<name=\"alice\",deleted_at=null"))).toBe(
      "INSERT INTO users (name, deleted_at) VALUES ('alice', NULL)",
    );
  });

  it("UPDATE SET RHS", () => {
    expect(norm(expand("=users<deleted_at=null?id=5"))).toBe(
      "UPDATE users SET deleted_at = NULL WHERE id = 5",
    );
  });

  it("function argument", () => {
    expect(norm(expand("t>coalesce(a,null)@x"))).toBe(
      "SELECT coalesce(a, NULL) AS x FROM t",
    );
  });

  it("CASE else branch — ELSE-less CASE workaround", () => {
    expect(norm(expand('t>?{x>0?"y":null}@v'))).toBe(
      "SELECT CASE WHEN x > 0 THEN 'y' ELSE NULL END AS v FROM t",
    );
  });

  it("CASE then branch", () => {
    expect(norm(expand('t>?{x>0?null:"y"}@v'))).toBe(
      "SELECT CASE WHEN x > 0 THEN NULL ELSE 'y' END AS v FROM t",
    );
  });
});

describe("bool literals — true / false", () => {
  it("`=true` emits TRUE by default", () => {
    expect(norm(expand("users?active=true"))).toBe(
      "SELECT * FROM users WHERE active = TRUE",
    );
  });

  it("`=false` emits FALSE", () => {
    expect(norm(expand("users?active=false"))).toBe(
      "SELECT * FROM users WHERE active = FALSE",
    );
  });

  it("INSERT bool value", () => {
    expect(norm(expand("+users<name=\"x\",active=true"))).toBe(
      "INSERT INTO users (name, active) VALUES ('x', TRUE)",
    );
  });

  it("UPDATE bool value", () => {
    expect(norm(expand("=users<active=false?id=1"))).toBe(
      "UPDATE users SET active = FALSE WHERE id = 1",
    );
  });

  it("bool in CASE branches", () => {
    expect(norm(expand('t>?{x>0?true:false}@flag'))).toBe(
      "SELECT CASE WHEN x > 0 THEN TRUE ELSE FALSE END AS flag FROM t",
    );
  });
});

describe("bool dialect hook — CompileOptions.bool", () => {
  it("SQL Server style: 1 / 0", () => {
    const sql = expand("users?active=true,verified=false", {
      bool: (v) => (v ? "1" : "0"),
    });
    expect(norm(sql)).toBe(
      "SELECT * FROM users WHERE active = 1 AND verified = 0",
    );
  });

  it("hook does not affect null", () => {
    const sql = expand("users?deleted_at=null,active=true", {
      bool: (v) => (v ? "1" : "0"),
    });
    expect(norm(sql)).toBe(
      "SELECT * FROM users WHERE deleted_at IS NULL AND active = 1",
    );
  });
});

describe("identifier vs literal disambiguation", () => {
  it("`nullable` is still an identifier (word boundary)", () => {
    expect(norm(expand("users?nullable=1"))).toBe(
      "SELECT * FROM users WHERE nullable = 1",
    );
  });

  it("`true_color` is still an identifier", () => {
    expect(norm(expand("t?true_color=1"))).toBe(
      "SELECT * FROM t WHERE true_color = 1",
    );
  });

  it("`falsey` is still an identifier", () => {
    expect(norm(expand("t?falsey=1"))).toBe(
      "SELECT * FROM t WHERE falsey = 1",
    );
  });

  it("column name `truth` (starts with `tru`) — still identifier", () => {
    expect(norm(expand("t?truth=1"))).toBe(
      "SELECT * FROM t WHERE truth = 1",
    );
  });
});

describe("validation — null/bool literals do not trigger column lookup", () => {
  const schema = staticResolver({
    tables: [{ name: "users", columns: ["id", "name", "active", "deleted_at"] }],
  });

  it("no warnings for known column compared to null", () => {
    const issues = validate(parse("users?deleted_at=null"), schema);
    expect(issues).toEqual([]);
  });

  it("no warnings for known column compared to true/false", () => {
    const issues = validate(parse("users?active=true"), schema);
    expect(issues).toEqual([]);
  });

  it("still flags unknown column even when compared to null", () => {
    const issues = validate(parse("users?nope=null"), schema);
    expect(issues.some((i) => i.message.includes("nope"))).toBe(true);
  });
});
