import { parse } from "./parser.js";
import { compile } from "./compile.js";
import type { CompileOptions, Query } from "./types.js";

export function expand(input: string, options: CompileOptions = {}): string {
  const ast: Query = parse(input);
  return compile(ast, options);
}

export { parse, compile };
export { staticResolver } from "./schema.js";
export { getCandidates, longestCommonPrefix } from "./candidates.js";
export { validate } from "./validate.js";
export type * from "./types.js";
export type {
  StaticForeignKey,
  StaticSchema,
  StaticTable,
} from "./schema.js";
