import { describe, expect, it } from "vitest";
import { expand } from "../src/index.js";
import { EXAMPLES } from "../example/src/examples.ts";

// Smoke test: every quick-load sample in the demo must parse and compile.
// Catches stale samples after grammar changes.
describe("demo examples", () => {
  for (const ex of EXAMPLES) {
    it(`compiles "${ex.label}"`, () => {
      expect(() => expand(ex.source)).not.toThrow();
    });
  }
});
