import { describe, expect, it } from "vitest";
import { expand, parse, staticResolver, validate } from "../src/index.js";

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

describe("SELECT DISTINCT — `|>` prefix", () => {
  it("single column", () => {
    expect(norm(expand("users|>name"))).toBe(
      "SELECT DISTINCT name FROM users",
    );
  });

  it("multiple columns", () => {
    expect(norm(expand("users|>name,email"))).toBe(
      "SELECT DISTINCT name, email FROM users",
    );
  });

  it("|>* — DISTINCT *", () => {
    expect(norm(expand("users|>*"))).toBe("SELECT DISTINCT * FROM users");
  });

  it("with WHERE / ORDER BY", () => {
    expect(norm(expand("users|>dept?active=true$dept"))).toBe(
      "SELECT DISTINCT dept FROM users WHERE active = TRUE ORDER BY dept ASC",
    );
  });

  it("with JOIN", () => {
    expect(
      norm(
        expand(
          "users@u+orders@o[u.id=o.user_id]|>u.id,u.name?o.total>100",
        ),
      ),
    ).toBe(
      "SELECT DISTINCT u.id, u.name FROM users u INNER JOIN orders o ON u.id = o.user_id WHERE o.total > 100",
    );
  });

  it("plain `>` is unchanged (no DISTINCT)", () => {
    expect(norm(expand("users>name"))).toBe(
      "SELECT name FROM users",
    );
  });

  it("with column alias", () => {
    expect(norm(expand("users|>dept@d"))).toBe(
      "SELECT DISTINCT dept AS d FROM users",
    );
  });
});

describe("DISTINCT inside aggregate — `count(|>col)`", () => {
  it("count(DISTINCT col)", () => {
    expect(norm(expand("orders>count(|>user_id)@uniq"))).toBe(
      "SELECT count(DISTINCT user_id) AS uniq FROM orders",
    );
  });

  it("multiple aggregates with DISTINCT", () => {
    expect(
      norm(expand("orders>count(|>user_id)@u,sum(amount)@s")),
    ).toBe(
      "SELECT count(DISTINCT user_id) AS u, sum(amount) AS s FROM orders",
    );
  });

  it("with GROUP BY", () => {
    expect(
      norm(
        expand("orders#region>region,count(|>user_id)@uniq_users"),
      ),
    ).toBe(
      "SELECT region, count(DISTINCT user_id) AS uniq_users FROM orders GROUP BY region",
    );
  });

  it("DISTINCT can take qualified id", () => {
    expect(
      norm(expand("a@a+b@b[a.id=b.aid]>count(|>b.x)@n")),
    ).toBe(
      "SELECT count(DISTINCT b.x) AS n FROM a a INNER JOIN b b ON a.id = b.aid",
    );
  });
});

describe("DISTINCT — validation", () => {
  const schema = staticResolver({
    tables: [{ name: "orders", columns: ["id", "user_id", "amount"] }],
  });

  it("flags unknown column inside count(DISTINCT ...)", () => {
    const issues = validate(parse("orders>count(|>nope)@n"), schema);
    expect(issues.some((i) => i.message.includes("nope"))).toBe(true);
  });

  it("does not flag known column", () => {
    const issues = validate(
      parse("orders>count(|>user_id)@n"),
      schema,
    );
    expect(issues).toEqual([]);
  });
});
