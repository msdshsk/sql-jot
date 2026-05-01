import { staticResolver } from "../../src/index.js";

/** Demo schema used by the example to show FK auto-resolve, multi-hop and validation. */
export const demoSchema = staticResolver({
  tables: [
    { name: "users", columns: ["id", "name", "email", "created_at"] },
    { name: "orders", columns: ["id", "user_id", "total", "created_at"] },
    { name: "items", columns: ["id", "order_id", "sku", "qty", "price"] },
    { name: "audits", columns: ["id", "user_id", "action", "at"] },
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
