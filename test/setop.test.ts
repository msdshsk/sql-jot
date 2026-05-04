import { describe, expect, it } from "vitest";
import { expand, parse, staticResolver, validate } from "../src/index.js";

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

describe("UNION — `||`", () => {
  it("basic UNION (DISTINCT default)", () => {
    expect(norm(expand("a>id || b>id"))).toBe(
      "SELECT id FROM a UNION SELECT id FROM b",
    );
  });

  it("UNION ALL with `||*`", () => {
    expect(norm(expand("a>id ||* b>id"))).toBe(
      "SELECT id FROM a UNION ALL SELECT id FROM b",
    );
  });

  it("with WHERE in operands", () => {
    expect(
      norm(expand('users>id?dept="A" || users>id?dept="B"')),
    ).toBe(
      "SELECT id FROM users WHERE dept = 'A' UNION SELECT id FROM users WHERE dept = 'B'",
    );
  });

  it("3-way chain", () => {
    expect(norm(expand("a>id || b>id || c>id"))).toBe(
      "SELECT id FROM a UNION SELECT id FROM b UNION SELECT id FROM c",
    );
  });

  it("no whitespace around `||` is also accepted", () => {
    expect(norm(expand("a>id||b>id"))).toBe(
      "SELECT id FROM a UNION SELECT id FROM b",
    );
  });
});

describe("INTERSECT — `&&`", () => {
  it("basic INTERSECT", () => {
    expect(
      norm(expand("orders>user_id && reviews>user_id")),
    ).toBe(
      "SELECT user_id FROM orders INTERSECT SELECT user_id FROM reviews",
    );
  });

  it("INTERSECT ALL with `&&*`", () => {
    expect(norm(expand("a>id &&* b>id"))).toBe(
      "SELECT id FROM a INTERSECT ALL SELECT id FROM b",
    );
  });
});

describe("EXCEPT — `\\\\`", () => {
  it("basic EXCEPT", () => {
    expect(
      norm(expand("products>id \\\\ order_items>product_id")),
    ).toBe(
      "SELECT id FROM products EXCEPT SELECT product_id FROM order_items",
    );
  });

  it("EXCEPT ALL with `\\\\*`", () => {
    expect(norm(expand("a>id \\\\* b>id"))).toBe(
      "SELECT id FROM a EXCEPT ALL SELECT id FROM b",
    );
  });
});

describe("Mixed set-ops (left-to-right)", () => {
  it("UNION then INTERSECT — left-to-right (no SQL precedence rewriting)", () => {
    expect(norm(expand("a>id || b>id && c>id"))).toBe(
      "SELECT id FROM a UNION SELECT id FROM b INTERSECT SELECT id FROM c",
    );
  });
});

describe("ORDER BY / LIMIT at end of chain", () => {
  it("ORDER BY at end attaches to whole chain in SQL semantics", () => {
    expect(norm(expand("a>id || b>id$id"))).toBe(
      "SELECT id FROM a UNION SELECT id FROM b ORDER BY id ASC",
    );
  });

  it("LIMIT at end", () => {
    expect(norm(expand("a>id || b>id~10"))).toBe(
      "SELECT id FROM a UNION SELECT id FROM b LIMIT 10",
    );
  });
});

describe("Set-ops with CTE", () => {
  it("CTE applied to the whole chain (top-level WITH)", () => {
    expect(
      norm(
        expand('{active>uid?status="ok"}@a, a>uid || external>uid'),
      ),
    ).toBe(
      "WITH a AS (SELECT uid FROM active WHERE status = 'ok') SELECT uid FROM a UNION SELECT uid FROM external",
    );
  });

  it("setop inside a CTE body", () => {
    expect(
      norm(expand("{a>id || b>id}@all_ids, all_ids>*")),
    ).toBe(
      "WITH all_ids AS (SELECT id FROM a UNION SELECT id FROM b) SELECT * FROM all_ids",
    );
  });

  it("EXCEPT inside CTE body", () => {
    expect(
      norm(expand("{products>id \\\\ ordered>product_id}@orphans, orphans>*")),
    ).toBe(
      "WITH orphans AS (SELECT id FROM products EXCEPT SELECT product_id FROM ordered) SELECT * FROM orphans",
    );
  });
});

describe("Set-ops nested in other constructs", () => {
  it("inside IN subquery", () => {
    expect(norm(expand("users?id[(a>uid || b>uid)]"))).toBe(
      "SELECT * FROM users WHERE id IN (SELECT uid FROM a UNION SELECT uid FROM b)",
    );
  });

  it("inside EXISTS", () => {
    const sql = norm(expand("users?^(a>1 || b>1)"));
    expect(sql).toContain("EXISTS (");
    expect(sql).toContain("UNION");
  });

  it("inside INSERT...SELECT", () => {
    expect(norm(expand("+target<(a>* || b>*)"))).toBe(
      "INSERT INTO target SELECT * FROM a UNION SELECT * FROM b",
    );
  });
});

describe("Restrictions", () => {
  it("CUD body cannot be composed with set-ops", () => {
    expect(() => expand("+t<a=1 || +t<b=2")).toThrow();
  });
});

describe("Set-op validation", () => {
  it("validates each operand independently", () => {
    const schema = staticResolver({
      tables: [
        { name: "a", columns: ["id"] },
        { name: "b", columns: ["id"] },
      ],
    });
    const issues = validate(parse("a>nope || b>id"), schema);
    expect(issues.some((i) => i.message.includes("nope"))).toBe(true);
  });

  it("CTEs are visible in all operands", () => {
    const schema = staticResolver({
      tables: [
        { name: "users", columns: ["id"] },
        { name: "external", columns: ["id"] },
      ],
    });
    const issues = validate(
      parse("{users>id}@u, u>id || external>id"),
      schema,
    );
    expect(issues).toEqual([]);
  });

  it("flags errors inside a CTE-body setop", () => {
    const schema = staticResolver({
      tables: [
        { name: "a", columns: ["id"] },
        { name: "b", columns: ["id"] },
      ],
    });
    const issues = validate(
      parse("{a>id || b>nope}@u, u>*"),
      schema,
    );
    expect(issues.some((i) => i.message.includes("nope"))).toBe(true);
  });
});

describe("Practical patterns", () => {
  it("INTERSECT — users who ordered AND reviewed", () => {
    expect(
      norm(
        expand(
          "orders>user_id?status=\"completed\" && reviews>user_id?published=true",
        ),
      ),
    ).toBe(
      "SELECT user_id FROM orders WHERE status = 'completed' INTERSECT SELECT user_id FROM reviews WHERE published = TRUE",
    );
  });

  it("EXCEPT — products with no orders (orphan check)", () => {
    expect(
      norm(expand("products>id \\\\ order_items>product_id")),
    ).toBe(
      "SELECT id FROM products EXCEPT SELECT product_id FROM order_items",
    );
  });

  it("UNION ALL — partition results without dedup (perf-friendly)", () => {
    expect(
      norm(expand("logs_2025>* ||* logs_2026>*")),
    ).toBe(
      "SELECT * FROM logs_2025 UNION ALL SELECT * FROM logs_2026",
    );
  });
});
