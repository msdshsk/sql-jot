import { describe, expect, it } from "vitest";
import { expand, parse, staticResolver, validate } from "../src/index.js";

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

describe("CASE — `?{ cond ? then : else }`", () => {
  it("simple two-branch CASE", () => {
    expect(norm(expand('users>?{x>0?"pos":"neg"}@sign'))).toBe(
      "SELECT CASE WHEN x > 0 THEN 'pos' ELSE 'neg' END AS sign FROM users",
    );
  });

  it("flat multi-arm CASE via right-recursive ternary", () => {
    expect(
      norm(
        expand(
          'users>?{score>=90?"A":score>=80?"B":score>=70?"C":"F"}@grade',
        ),
      ),
    ).toBe(
      "SELECT CASE WHEN score >= 90 THEN 'A' WHEN score >= 80 THEN 'B' WHEN score >= 70 THEN 'C' ELSE 'F' END AS grade FROM users",
    );
  });

  it("CASE inside an aggregate function", () => {
    expect(
      norm(expand('orders>user_id,sum(?{status="paid"?amount:0})@paid')),
    ).toBe(
      "SELECT user_id, sum(CASE WHEN status = 'paid' THEN amount ELSE 0 END) AS paid FROM orders",
    );
  });

  it("CASE in WHERE", () => {
    expect(
      norm(expand('orders?total>?{tier="gold"?100:10}')),
    ).toBe(
      "SELECT * FROM orders WHERE total > CASE WHEN tier = 'gold' THEN 100 ELSE 10 END",
    );
  });

  it("CASE in UPDATE SET RHS", () => {
    expect(
      norm(expand('=orders<status=?{paid=1?"done":"pending"}?id=5')),
    ).toBe(
      "UPDATE orders SET status = CASE WHEN paid = 1 THEN 'done' ELSE 'pending' END WHERE id = 5",
    );
  });

  it("CASE with AND in cond", () => {
    expect(
      norm(expand('t>?{a=1,b=2?"both":"none"}@flag')),
    ).toBe(
      "SELECT CASE WHEN a = 1 AND b = 2 THEN 'both' ELSE 'none' END AS flag FROM t",
    );
  });

  it("CASE with OR in cond", () => {
    expect(
      norm(expand('t>?{a=1|b=2?"either":"none"}@flag')),
    ).toBe(
      "SELECT CASE WHEN a = 1 OR b = 2 THEN 'either' ELSE 'none' END AS flag FROM t",
    );
  });

  it("vertical (whitespace) form parses identically", () => {
    const inline = expand('t>?{a>0?"p":a<0?"n":"z"}@s');
    const vertical = expand(`t>?{
      a>0?"p":
      a<0?"n":
      "z"
    }@s`);
    expect(norm(vertical)).toBe(norm(inline));
  });
});

describe("COALESCE — `??` chain", () => {
  it("two-arg COALESCE", () => {
    expect(norm(expand('users>?{nickname??"anon"}@display'))).toBe(
      "SELECT COALESCE(nickname, 'anon') AS display FROM users",
    );
  });

  it("multi-arg COALESCE flattens", () => {
    expect(norm(expand('users>?{a??b??c??"d"}@v'))).toBe(
      "SELECT COALESCE(a, b, c, 'd') AS v FROM users",
    );
  });

  it("?? mixed with ternary — ?? binds tighter than ?:", () => {
    expect(norm(expand('users>?{a??b?"yes":"no"}@x'))).toBe(
      "SELECT CASE WHEN COALESCE(a, b) THEN 'yes' ELSE 'no' END AS x FROM users",
    );
  });

  it("?? in else branch of ternary", () => {
    expect(
      norm(expand('users>?{score>=80?"pass":fallback??"unknown"}@result')),
    ).toBe(
      "SELECT CASE WHEN score >= 80 THEN 'pass' ELSE COALESCE(fallback, 'unknown') END AS result FROM users",
    );
  });
});

describe("CASE / COALESCE validation", () => {
  const schema = staticResolver({
    tables: [{ name: "t", columns: ["a", "b", "c"] }],
  });

  it("flags unknown column in case cond", () => {
    const issues = validate(
      parse('t>?{nope>0?"p":"n"}@s'),
      schema,
    );
    expect(issues.some((i) => i.message.includes("nope"))).toBe(true);
  });

  it("flags unknown column in case then", () => {
    const issues = validate(
      parse('t>?{a>0?nope:"n"}@s'),
      schema,
    );
    expect(issues.some((i) => i.message.includes("nope"))).toBe(true);
  });

  it("flags unknown column in coalesce", () => {
    const issues = validate(parse('t>?{a??nope??"x"}@s'), schema);
    expect(issues.some((i) => i.message.includes("nope"))).toBe(true);
  });
});
