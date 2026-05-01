import { describe, expect, it } from "vitest";
import { parse, staticResolver, validate } from "../src/index.js";

const schema = staticResolver({
  tables: [
    { name: "users", columns: ["id", "name", "email"] },
    { name: "orders", columns: ["id", "user_id", "total"] },
  ],
});

function issuesFor(src: string) {
  return validate(parse(src), schema);
}

describe("validate", () => {
  it("clean query has no issues", () => {
    expect(issuesFor("users>id,name?id=1")).toEqual([]);
  });

  it("unknown table is flagged", () => {
    const issues = issuesFor("widgets>id");
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain("widgets");
    expect(issues[0]!.ref).toEqual({ kind: "table", name: "widgets" });
  });

  it("unknown column on known table is flagged", () => {
    const issues = issuesFor("users>foobar");
    expect(issues.some((i) => i.message.includes("foobar"))).toBe(true);
  });

  it("ambiguous bare column across joined tables is flagged", () => {
    const issues = issuesFor("users+orders?id=1");
    expect(issues.some((i) => i.message.includes("ambiguous"))).toBe(true);
  });

  it("qualified column with unknown alias is flagged", () => {
    const issues = issuesFor("users@u?z.id=1");
    expect(issues.some((i) => i.message.includes("z"))).toBe(true);
  });

  it("INSERT with unknown column is flagged", () => {
    const issues = issuesFor('+users<wat="x"');
    expect(issues.some((i) => i.message.includes("wat"))).toBe(true);
  });

  it("UPDATE with unknown column is flagged", () => {
    const issues = issuesFor("=users<wat=1?id=1");
    expect(issues.some((i) => i.message.includes("wat"))).toBe(true);
  });
});
