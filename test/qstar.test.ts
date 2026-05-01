import { describe, expect, it } from "vitest";
import { expand } from "../src/index.js";

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

describe("qualified star (t.*)", () => {
  it("simple alias star", () => {
    expect(norm(expand("wholesalers@w>w.*"))).toBe(
      "SELECT w.* FROM wholesalers w",
    );
  });

  it("user's full LEFT-JOIN-for-WHERE pattern", () => {
    const sql = expand(
      'wholesalers@w>w.*?f.child_code["a","b","c"]+<formats@f[f.id=w.format_id]',
    );
    expect(norm(sql)).toBe(
      "SELECT w.* FROM wholesalers w LEFT JOIN formats f ON f.id = w.format_id WHERE f.child_code IN ('a', 'b', 'c')",
    );
  });

  it("mixing qualified-star with other columns", () => {
    expect(
      norm(expand("a@a+b@b[a.id=b.aid]>a.*,b.x")),
    ).toBe("SELECT a.*, b.x FROM a a INNER JOIN b b ON a.id = b.aid");
  });

  it("bare star still works alongside qualified star", () => {
    expect(norm(expand("t>*"))).toBe("SELECT * FROM t");
    expect(norm(expand("t@t>t.*"))).toBe("SELECT t.* FROM t t");
  });

  it("qualified star using table name (no alias)", () => {
    expect(norm(expand("users>users.*"))).toBe(
      "SELECT users.* FROM users",
    );
  });
});
