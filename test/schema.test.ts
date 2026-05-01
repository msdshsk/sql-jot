import { describe, expect, it } from "vitest";
import { expand, staticResolver } from "../src/index.js";

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

const blogSchema = staticResolver({
  tables: [
    { name: "users", columns: ["id", "name", "email", "created_at"] },
    { name: "orders", columns: ["id", "user_id", "total", "created_at"] },
    { name: "items", columns: ["id", "order_id", "sku", "qty"] },
    { name: "audits", columns: ["id", "user_id", "action"] },
  ],
  foreignKeys: [
    {
      fromTable: "orders",
      fromColumns: ["user_id"],
      toTable: "users",
      toColumns: ["id"],
    },
    {
      fromTable: "items",
      fromColumns: ["order_id"],
      toTable: "orders",
      toColumns: ["id"],
    },
    {
      fromTable: "audits",
      fromColumns: ["user_id"],
      toTable: "users",
      toColumns: ["id"],
    },
  ],
});

describe("FK direct resolution", () => {
  it("users + orders auto ON via FK (forward direction)", () => {
    const sql = expand("users@u+orders@o", { schema: blogSchema });
    expect(norm(sql)).toContain(
      "INNER JOIN orders o ON u.id = o.user_id",
    );
  });

  it("orders + users auto ON (reverse direction)", () => {
    const sql = expand("orders@o+users@u", { schema: blogSchema });
    expect(norm(sql)).toContain(
      "INNER JOIN users u ON o.user_id = u.id",
    );
  });
});

describe("Multi-hop JOIN inference", () => {
  it("users + items → through orders", () => {
    const sql = expand("users+items", { schema: blogSchema });
    expect(norm(sql)).toBe(
      "SELECT * FROM users INNER JOIN orders ON users.id = orders.user_id INNER JOIN items ON orders.id = items.order_id",
    );
  });

  it("multi-hop preserves user-specified alias on final table", () => {
    const sql = expand("users@u+items@i", { schema: blogSchema });
    expect(norm(sql)).toContain("INNER JOIN items i ON");
    expect(norm(sql)).toContain("ON u.id = orders.user_id");
  });

  it("LEFT JOIN type applies only to final step in multi-hop", () => {
    const sql = expand("users@u+<items@i", { schema: blogSchema });
    // intermediate step is INNER, final is LEFT
    expect(norm(sql)).toContain("INNER JOIN orders");
    expect(norm(sql)).toContain("LEFT JOIN items i");
  });

  it("explicit ON disables auto-resolution", () => {
    const sql = expand("users@u+items@i[u.id=i.x]", { schema: blogSchema });
    expect(norm(sql)).toBe(
      "SELECT * FROM users u INNER JOIN items i ON u.id = i.x",
    );
  });
});

describe("Implicit column qualification", () => {
  it("bare column unique to one table is qualified", () => {
    const sql = expand("users+orders?total>1000", { schema: blogSchema });
    // total only exists on orders
    expect(norm(sql)).toContain("WHERE orders.total > 1000");
  });

  it("ambiguous bare column is left unqualified", () => {
    // both users and orders have created_at
    const sql = expand("users+orders?created_at>1", { schema: blogSchema });
    expect(norm(sql)).toContain("WHERE created_at > 1");
  });

  it("single-table query does not over-qualify", () => {
    const sql = expand("users>name?id=1", { schema: blogSchema });
    expect(norm(sql)).toBe("SELECT name FROM users WHERE id = 1");
  });

  it("explicitly qualified columns pass through unchanged", () => {
    const sql = expand("users@u+orders@o?o.created_at>1", {
      schema: blogSchema,
    });
    expect(norm(sql)).toContain("WHERE o.created_at > 1");
  });
});
