import { describe, expect, it } from "vitest";
import {
  getCandidates,
  longestCommonPrefix,
  staticResolver,
} from "../src/index.js";

const schema = staticResolver({
  tables: [
    { name: "users", columns: ["id", "name", "email", "created_at"] },
    { name: "orders", columns: ["id", "user_id", "total"] },
  ],
});

function namesAt(input: string, cursor: number): string[] {
  return getCandidates(input, cursor, schema).candidates.map(
    (c) => c.insertText,
  );
}

describe("getCandidates: column context", () => {
  it("after > suggests columns of FROM table", () => {
    const input = "users>";
    const names = namesAt(input, input.length);
    expect(names).toEqual(
      expect.arrayContaining(["id", "name", "email", "created_at"]),
    );
  });

  it("after ? prefix-filters columns", () => {
    const input = "users?cre";
    const names = namesAt(input, input.length);
    expect(names).toEqual(["created_at"]);
  });

  it("after table alias dot suggests columns of that table", () => {
    const input = "users@u+orders@o?u.";
    const names = namesAt(input, input.length);
    expect(names).toEqual(
      expect.arrayContaining(["id", "name", "email", "created_at"]),
    );
    expect(names).not.toContain("total"); // belongs to orders, not users
  });

  it("after `o.tot` suggests total via alias resolution", () => {
    const input = "users@u+orders@o?o.tot";
    const names = namesAt(input, input.length);
    expect(names).toEqual(["total"]);
  });
});

describe("getCandidates: table context", () => {
  it("at start of empty input suggests tables", () => {
    const names = namesAt("", 0);
    expect(names).toEqual(expect.arrayContaining(["users", "orders"]));
  });

  it("after `+` suggests tables", () => {
    const input = "users+";
    const names = namesAt(input, input.length);
    expect(names).toEqual(expect.arrayContaining(["users", "orders"]));
  });

  it("after CUD verb `+` at start suggests tables", () => {
    const names = namesAt("+", 1);
    expect(names).toEqual(expect.arrayContaining(["users", "orders"]));
  });

  it("inside EXISTS subquery `^(` suggests tables", () => {
    const input = "users?^(";
    const names = namesAt(input, input.length);
    expect(names).toEqual(expect.arrayContaining(["users", "orders"]));
  });
});

describe("getCandidates: NOT marker is transparent", () => {
  it("after `?!` suggests columns (like after `?`)", () => {
    const input = "users?!cre";
    const names = namesAt(input, input.length);
    expect(names).toEqual(["created_at"]);
  });
});

describe("longestCommonPrefix", () => {
  it("empty input → empty", () => {
    expect(longestCommonPrefix([])).toBe("");
  });
  it("single string → itself", () => {
    expect(longestCommonPrefix(["created_at"])).toBe("created_at");
  });
  it("shared prefix", () => {
    expect(longestCommonPrefix(["created_at", "created_by"])).toBe("created_");
  });
  it("no shared prefix", () => {
    expect(longestCommonPrefix(["foo", "bar"])).toBe("");
  });
});
