import { describe, expect, it } from "vitest";
import { expand } from "../src/index.js";

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

describe("INSERT", () => {
  it("single row from k=v list", () => {
    expect(norm(expand('+users<name="alice",age=30'))).toBe(
      `INSERT INTO users (name, age) VALUES ('alice', 30)`,
    );
  });

  it("multi-row using brace blocks", () => {
    expect(
      norm(expand('+users<{name="alice",age=30},{name="bob",age=25}')),
    ).toBe(
      `INSERT INTO users (name, age) VALUES ('alice', 30), ('bob', 25)`,
    );
  });

  it("INSERT...SELECT with no explicit cols", () => {
    expect(norm(expand("+users<(other>name,age?active=1)"))).toBe(
      `INSERT INTO users SELECT name, age FROM other WHERE active = 1`,
    );
  });

  it("INSERT...SELECT with explicit cols", () => {
    expect(
      norm(expand("+users(name,age)<(other>name,age?active=1)")),
    ).toBe(
      `INSERT INTO users (name, age) SELECT name, age FROM other WHERE active = 1`,
    );
  });

  it("rejects multi-row with mismatched cols", () => {
    expect(() =>
      expand('+users<{name="a",age=1},{name="b",email="x"}'),
    ).toThrow(/same columns/);
  });

  it("rejects multi-row with different col counts", () => {
    expect(() =>
      expand('+users(name,age)<{name="a",age=1},{name="b"}'),
    ).toThrow(/column count/);
  });
});

describe("UPDATE", () => {
  it("single set with WHERE", () => {
    expect(norm(expand("=users<active=0?id=5"))).toBe(
      `UPDATE users SET active = 0 WHERE id = 5`,
    );
  });

  it("multiple sets", () => {
    expect(norm(expand('=users<active=0,name="bob"?id=5'))).toBe(
      `UPDATE users SET active = 0, name = 'bob' WHERE id = 5`,
    );
  });

  it("compound assign +=", () => {
    expect(norm(expand("=users<count+=1?id=5"))).toBe(
      `UPDATE users SET count = count + 1 WHERE id = 5`,
    );
  });

  it("all four compound assigns", () => {
    expect(norm(expand("=t<a+=1,b-=2,c*=3,d/=4"))).toBe(
      `UPDATE t SET a = a + 1, b = b - 2, c = c * 3, d = d / 4`,
    );
  });

  it("update with alias and qualified WHERE", () => {
    expect(norm(expand('=users@u<name="bob"?u.id=5'))).toBe(
      `UPDATE users u SET name = 'bob' WHERE u.id = 5`,
    );
  });

  it("update without WHERE (mass update)", () => {
    expect(norm(expand("=users<active=0"))).toBe(
      `UPDATE users SET active = 0`,
    );
  });
});

describe("DELETE", () => {
  it("with WHERE", () => {
    expect(norm(expand("-users?id=5"))).toBe(
      `DELETE FROM users WHERE id = 5`,
    );
  });

  it("with compound WHERE", () => {
    expect(norm(expand('-users?status="banned",login_count=0'))).toBe(
      `DELETE FROM users WHERE status = 'banned' AND login_count = 0`,
    );
  });

  it("without WHERE — allowed at syntax level", () => {
    expect(norm(expand("-users"))).toBe(`DELETE FROM users`);
  });

  it("delete with alias", () => {
    expect(norm(expand("-users@u?u.id=5"))).toBe(
      `DELETE FROM users u WHERE u.id = 5`,
    );
  });
});

describe("CTE prefix on CUD", () => {
  it("WITH ... INSERT ... SELECT", () => {
    expect(
      norm(
        expand(
          "{src>id,name?active=1}@s+users(id,name)<(s>id,name)",
        ),
      ),
    ).toBe(
      `WITH s AS (SELECT id, name FROM src WHERE active = 1) INSERT INTO users (id, name) SELECT id, name FROM s`,
    );
  });
});
