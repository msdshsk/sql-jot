import { describe, expect, it } from "vitest";
import { expand } from "../src/index.js";

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

describe("schema-qualified table names", () => {
  it("user's reported case: public.article@art>*$-id~30", () => {
    expect(norm(expand("public.article@art>*$-id~30"))).toBe(
      "SELECT * FROM public.article art ORDER BY id DESC LIMIT 30",
    );
  });

  it("schema-qualified without alias", () => {
    expect(norm(expand("public.users>name?id=1"))).toBe(
      "SELECT name FROM public.users WHERE id = 1",
    );
  });

  it("3-part name (db.schema.table)", () => {
    expect(norm(expand("mydb.public.users>*"))).toBe(
      "SELECT * FROM mydb.public.users",
    );
  });

  it("schema-qualified in INSERT", () => {
    expect(norm(expand('+public.users<name="alice"'))).toBe(
      "INSERT INTO public.users (name) VALUES ('alice')",
    );
  });

  it("schema-qualified in UPDATE", () => {
    expect(norm(expand("=public.users<active=0?id=5"))).toBe(
      "UPDATE public.users SET active = 0 WHERE id = 5",
    );
  });

  it("schema-qualified in DELETE", () => {
    expect(norm(expand("-public.users?id=5"))).toBe(
      "DELETE FROM public.users WHERE id = 5",
    );
  });

  it("schema-qualified in JOIN", () => {
    expect(
      norm(
        expand(
          "public.users@u+public.orders@o[u.id=o.user_id]",
        ),
      ),
    ).toBe(
      "SELECT * FROM public.users u INNER JOIN public.orders o ON u.id = o.user_id",
    );
  });
});
