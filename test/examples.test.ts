import { describe, expect, it } from "vitest";
import { expand } from "../src/index.js";
import { staticResolver } from "../src/schema.js";

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

describe("3 canonical examples", () => {
  it("ex1: select+where+join (FK auto-resolve via schema)", () => {
    const schema = staticResolver({
      foreignKeys: [
        {
          fromTable: "tbl",
          fromColumns: ["tbl2_id"],
          toTable: "tbl2",
          toColumns: ["id"],
        },
      ],
    });
    const sql = expand("tbl@a>c1,c2,c3?c2=x,c3=1+tbl2@b", { schema });
    expect(norm(sql)).toBe(
      "SELECT c1, c2, c3 FROM tbl a INNER JOIN tbl2 b ON a.tbl2_id = b.id WHERE c2 = x AND c3 = 1",
    );
  });

  it("ex2: CTE + implicit FROM + join with explicit ON", () => {
    const sql = expand("{tbl>*?c1=2}@sub+users@u[sub.id=u.outer_id]");
    expect(norm(sql)).toBe(
      "WITH sub AS (SELECT * FROM tbl WHERE c1 = 2) SELECT * FROM sub INNER JOIN users u ON sub.id = u.outer_id",
    );
  });

  it("ex3: aggregate + group + having + order desc", () => {
    const sql = expand("tbl@a>name,sum(price)@x#name:x<5000$-x");
    expect(norm(sql)).toBe(
      "SELECT name, sum(price) AS x FROM tbl a GROUP BY name HAVING x < 5000 ORDER BY x DESC",
    );
  });
});

describe("edge cases", () => {
  it("LIKE with bare quoted string auto-wraps with %", () => {
    const sql = expand('tbl?name%"john"');
    expect(norm(sql)).toBe("SELECT * FROM tbl WHERE name LIKE '%john%'");
  });

  it("LIKE with explicit % keeps it as-is (prefix match)", () => {
    const sql = expand('tbl?name%"j%"');
    expect(norm(sql)).toBe("SELECT * FROM tbl WHERE name LIKE 'j%'");
  });

  it("LIKE with leading % keeps it (suffix match)", () => {
    const sql = expand('tbl?name%"%n"');
    expect(norm(sql)).toBe("SELECT * FROM tbl WHERE name LIKE '%n'");
  });

  it("IN list with strings", () => {
    const sql = expand('tbl?status["a","b","c"]');
    expect(norm(sql)).toBe(
      "SELECT * FROM tbl WHERE status IN ('a', 'b', 'c')",
    );
  });

  it("IN list with numbers", () => {
    const sql = expand("tbl?id[1,2,3]");
    expect(norm(sql)).toBe("SELECT * FROM tbl WHERE id IN (1, 2, 3)");
  });

  it("OR with pipe", () => {
    const sql = expand("tbl?c1=1|c2=2");
    expect(norm(sql)).toBe("SELECT * FROM tbl WHERE c1 = 1 OR c2 = 2");
  });

  it("AND nested under OR", () => {
    const sql = expand("tbl?c1=1,c2=2|c3=3");
    expect(norm(sql)).toBe(
      "SELECT * FROM tbl WHERE (c1 = 1 AND c2 = 2) OR c3 = 3",
    );
  });

  it("LEFT JOIN", () => {
    const sql = expand("tbl@a+<users@u[a.id=u.tbl_id]");
    expect(norm(sql)).toBe(
      "SELECT * FROM tbl a LEFT JOIN users u ON a.id = u.tbl_id",
    );
  });

  it("comparison ops", () => {
    expect(norm(expand("t?a>=1"))).toBe("SELECT * FROM t WHERE a >= 1");
    expect(norm(expand("t?a<>1"))).toBe("SELECT * FROM t WHERE a <> 1");
    expect(norm(expand("t?a!=1"))).toBe("SELECT * FROM t WHERE a != 1");
  });

  it("LIMIT with default page", () => {
    const sql = expand("tbl~20");
    expect(norm(sql)).toBe("SELECT * FROM tbl LIMIT 20");
  });

  it("LIMIT with page > 1 emits OFFSET", () => {
    const sql = expand("tbl~20p3");
    expect(norm(sql)).toBe("SELECT * FROM tbl LIMIT 20 OFFSET 40");
  });

  it("ascending order with no prefix", () => {
    const sql = expand("tbl$created_at");
    expect(norm(sql)).toBe("SELECT * FROM tbl ORDER BY created_at ASC");
  });

  it("multi-column order with mixed dir", () => {
    const sql = expand("tbl$-x,+y");
    expect(norm(sql)).toBe("SELECT * FROM tbl ORDER BY x DESC, y ASC");
  });

  it("function call in WHERE", () => {
    const sql = expand('t?lower(name)="john"');
    expect(norm(sql)).toBe("SELECT * FROM t WHERE lower(name) = 'john'");
  });

  it("qualified columns in select", () => {
    const sql = expand("u@u>u.id,u.name");
    expect(norm(sql)).toBe("SELECT u.id, u.name FROM u u");
  });
});
