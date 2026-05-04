import { describe, expect, it } from "vitest";
import { expand, parse, staticResolver, validate } from "../src/index.js";

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

describe("INSERT RETURNING", () => {
  it("single column", () => {
    expect(norm(expand('+users<name="alice">id'))).toBe(
      "INSERT INTO users (name) VALUES ('alice') RETURNING id",
    );
  });

  it("multiple columns", () => {
    expect(norm(expand('+users<name="alice",age=30>id,created_at'))).toBe(
      "INSERT INTO users (name, age) VALUES ('alice', 30) RETURNING id, created_at",
    );
  });

  it("with column alias", () => {
    expect(norm(expand('+users<name="alice">id@new_id'))).toBe(
      "INSERT INTO users (name) VALUES ('alice') RETURNING id AS new_id",
    );
  });

  it("multi-row INSERT with RETURNING", () => {
    expect(
      norm(expand('+users<{name="alice"},{name="bob"}>id,name')),
    ).toBe(
      "INSERT INTO users (name) VALUES ('alice'), ('bob') RETURNING id, name",
    );
  });

  it("INSERT...SELECT with RETURNING", () => {
    expect(
      norm(expand("+users<(other>name?active=1)>id")),
    ).toBe(
      "INSERT INTO users SELECT name FROM other WHERE active = 1 RETURNING id",
    );
  });

  it("RETURNING * (star)", () => {
    expect(norm(expand('+users<name="alice">*'))).toBe(
      "INSERT INTO users (name) VALUES ('alice') RETURNING *",
    );
  });
});

describe("UPDATE RETURNING", () => {
  it("with WHERE", () => {
    expect(norm(expand("=users<active=0?id=5>id,active"))).toBe(
      "UPDATE users SET active = 0 WHERE id = 5 RETURNING id, active",
    );
  });

  it("without WHERE", () => {
    expect(norm(expand("=users<active=0>id"))).toBe(
      "UPDATE users SET active = 0 RETURNING id",
    );
  });

  it("with compound assignment", () => {
    expect(norm(expand("=products<price*=1.1?category=\"food\">id,price"))).toBe(
      "UPDATE products SET price = price * 1.1 WHERE category = 'food' RETURNING id, price",
    );
  });
});

describe("DELETE RETURNING", () => {
  it("with WHERE", () => {
    expect(norm(expand("-sessions?expires_at<0>user_id,token"))).toBe(
      "DELETE FROM sessions WHERE expires_at < 0 RETURNING user_id, token",
    );
  });

  it("without WHERE", () => {
    expect(norm(expand("-tmp_log>id"))).toBe(
      "DELETE FROM tmp_log RETURNING id",
    );
  });
});

describe("RETURNING hook", () => {
  it("hook is called with verb / table / cols", () => {
    const calls: unknown[] = [];
    const sql = expand('+users<name="alice">id', {
      returning: (info) => {
        calls.push(info);
        return `; SELECT LAST_INSERT_ID()`;
      },
    });
    expect(calls).toEqual([
      { verb: "insert", table: "users", cols: ["id"] },
    ]);
    expect(norm(sql)).toBe(
      "INSERT INTO users (name) VALUES ('alice') ; SELECT LAST_INSERT_ID()",
    );
  });

  it("hook returning empty string suppresses RETURNING tail", () => {
    const sql = expand("=users<active=0?id=5>id", {
      returning: () => "",
    });
    expect(norm(sql)).toBe("UPDATE users SET active = 0 WHERE id = 5");
  });

  it("hook fires for delete too", () => {
    const sql = expand("-x?id=1>id,name", {
      returning: ({ verb, cols }) => `OUTPUT ${cols.join(", ")} /* ${verb} */`,
    });
    expect(norm(sql)).toBe(
      "DELETE FROM x WHERE id = 1 OUTPUT id, name /* delete */",
    );
  });
});

describe("RETURNING validation", () => {
  const schema = staticResolver({
    tables: [{ name: "users", columns: ["id", "name"] }],
  });

  it("flags unknown RETURNING column", () => {
    const issues = validate(parse('+users<name="x">nope'), schema);
    expect(issues.some((i) => i.message.includes("nope"))).toBe(true);
  });

  it("does not flag known RETURNING column", () => {
    const issues = validate(parse('+users<name="x">id'), schema);
    expect(issues.length).toBe(0);
  });
});
