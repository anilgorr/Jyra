// Test-only replacement for `@workspace/db`. It re-exports the real schema
// (table identities are what the code under test passes around) and a `db`
// whose query builders are recorded and answered by a test-installed
// resolver. No connection is ever opened.
export * from "../../../lib/db/src/schema";

export type FakeQuery = {
  op: "select" | "update" | "insert" | "delete";
  table: unknown;
  values: Record<string, unknown> | null;
  fields: unknown;
  calls: Array<[string, unknown[]]>;
};

export type FakeResolver = (query: FakeQuery) => unknown[] | Promise<unknown[]>;

let resolver: FakeResolver = () => {
  throw new Error("fake db resolver not installed");
};
export const fakeQueryLog: FakeQuery[] = [];

export function installFakeDb(next: FakeResolver) {
  resolver = next;
  fakeQueryLog.length = 0;
}

function chain(op: FakeQuery["op"], table: unknown, fields: unknown) {
  const query: FakeQuery = { op, table, values: null, fields, calls: [] };
  fakeQueryLog.push(query);
  const run = () => Promise.resolve().then(() => resolver(query));
  const proxy: Record<string | symbol, unknown> = new Proxy({} as Record<string | symbol, unknown>, {
    get(_target, prop) {
      if (prop === "then") return (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) => run().then(onFulfilled, onRejected);
      if (prop === "catch") return (onRejected: (reason: unknown) => unknown) => run().catch(onRejected);
      if (prop === "finally") return (onFinally: () => void) => run().finally(onFinally);
      return (...args: unknown[]) => {
        if (prop === "set" || prop === "values") query.values = args[0] as Record<string, unknown>;
        if (prop === "from") query.table = args[0];
        query.calls.push([String(prop), args]);
        return proxy;
      };
    },
  });
  return proxy;
}

export const db = {
  select: (fields?: unknown) => chain("select", null, fields ?? null),
  update: (table: unknown) => chain("update", table, null),
  insert: (table: unknown) => chain("insert", table, null),
  delete: (table: unknown) => chain("delete", table, null),
  execute: async () => [],
  transaction: async <T>(callback: (tx: typeof db) => Promise<T>): Promise<T> => callback(db),
};

export const pool = { end: async () => {} };
export function assertApprovedDevelopmentDatabase(): void {}
