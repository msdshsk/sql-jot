import { parse as rawParse } from "./parser.generated.js";
import type { Query } from "./types.js";

export function parse(input: string): Query {
  return rawParse(input) as Query;
}
