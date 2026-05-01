import type { JoinPathStep, SchemaResolver } from "./types.js";

export interface StaticForeignKey {
  fromTable: string;
  fromColumns: string[];
  toTable: string;
  toColumns: string[];
}

export interface StaticTable {
  name: string;
  columns: string[];
}

export interface StaticSchema {
  tables?: StaticTable[];
  foreignKeys?: StaticForeignKey[];
}

/**
 * Build a SchemaResolver from a plain in-memory schema description.
 * This is mainly useful for tests and quick demos; production hosts will
 * implement SchemaResolver directly against their own catalogue.
 */
export function staticResolver(schema: StaticSchema): SchemaResolver {
  const fks = schema.foreignKeys ?? [];
  const tables = schema.tables ?? [];

  // Adjacency list keyed by table; each entry remembers the FK and direction
  type Edge = { to: string; fromCols: string[]; toCols: string[] };
  const graph = new Map<string, Edge[]>();
  for (const fk of fks) {
    pushEdge(graph, fk.fromTable, {
      to: fk.toTable,
      fromCols: fk.fromColumns,
      toCols: fk.toColumns,
    });
    pushEdge(graph, fk.toTable, {
      to: fk.fromTable,
      fromCols: fk.toColumns,
      toCols: fk.fromColumns,
    });
  }

  const columnsByTable = new Map<string, string[]>();
  for (const t of tables) columnsByTable.set(t.name, t.columns);

  return {
    resolveJoin(from, to) {
      if (from === to) return null;
      // BFS
      const queue: string[] = [from];
      const cameFrom = new Map<string, { prev: string; edge: Edge }>();
      cameFrom.set(from, { prev: from, edge: null as unknown as Edge });
      while (queue.length > 0) {
        const node = queue.shift()!;
        if (node === to) break;
        const edges = graph.get(node) ?? [];
        for (const e of edges) {
          if (cameFrom.has(e.to)) continue;
          cameFrom.set(e.to, { prev: node, edge: e });
          queue.push(e.to);
        }
      }
      if (!cameFrom.has(to)) return null;
      // Reconstruct path
      const steps: JoinPathStep[] = [];
      let cur = to;
      while (cur !== from) {
        const { prev, edge } = cameFrom.get(cur)!;
        steps.unshift({
          table: edge.to,
          fromCols: edge.fromCols,
          toCols: edge.toCols,
        });
        cur = prev;
      }
      return steps;
    },

    listColumns(table) {
      return columnsByTable.get(table) ?? null;
    },

    listTables() {
      return tables.map((t) => t.name);
    },
  };
}

function pushEdge<T>(map: Map<string, T[]>, key: string, value: T) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}
