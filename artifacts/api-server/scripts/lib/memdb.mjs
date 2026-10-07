/**
 * An in-memory answer to `fake-db-stub.ts`: rows per table, drizzle `where`
 * clauses evaluated well enough for single-tenant test scenarios.
 *
 * It understands `=`, `<>`, `in`, `is null`, `is not null`, `>=`, `>`, `<=`,
 * `<`, and `and`; an `or` clause makes the whole predicate pass (a scenario
 * that depends on `or` must assert differently). Joins evaluate their `on`
 * clause against both rows. Aggregates: `count(*)`, `sum(col)`, `max(col)`.
 *
 * It is not a database. It is enough to run a state machine end to end
 * without one, and it fails loudly on shapes it does not know.
 */
import { randomUUID } from "node:crypto";

const NAME = Symbol.for("drizzle:Name");
const COLUMNS = Symbol.for("drizzle:Columns");

const isSql = (value) => value !== null && typeof value === "object" && Array.isArray(value.queryChunks);
const isColumn = (value) => value !== null && typeof value === "object" && typeof value.name === "string" && value.table && value.table[NAME];
const isParam = (value) => value !== null && typeof value === "object" && value.constructor?.name === "Param";
const isChunk = (value) => value !== null && typeof value === "object" && value.constructor?.name === "StringChunk";

export function tableName(table) { return table?.[NAME]; }
export function jsKey(column) {
  for (const [key, candidate] of Object.entries(column.table[COLUMNS])) if (candidate === column) return key;
  throw new Error(`column ${column.name} not found on ${column.table[NAME]}`);
}

/** Flattens a drizzle SQL tree into tokens: {str}, {col}, {val}, {list}. */
function tokens(node, out = []) {
  if (isSql(node)) { for (const chunk of node.queryChunks) tokens(chunk, out); return out; }
  if (isChunk(node)) { out.push({ str: node.value.join("") }); return out; }
  if (isColumn(node)) { out.push({ col: node }); return out; }
  if (isParam(node)) { out.push({ val: node.value }); return out; }
  if (Array.isArray(node)) { out.push({ list: node.map((item) => (isParam(item) ? item.value : isSql(item) ? sqlValue(item) : item)) }); return out; }
  out.push({ val: node });
  return out;
}
function sqlValue(node) {
  const flat = tokens(node);
  const vals = flat.filter((token) => "val" in token);
  if (vals.length === 1) return vals[0].val;
  return flat.map((token) => token.str ?? "").join("");
}

const normalize = (value) => (value instanceof Date ? value.getTime() : value);
const compare = (left, op, right) => {
  const a = normalize(left); const b = normalize(right);
  switch (op) {
    case "=": return a === b;
    case "<>": case "!=": return a !== b;
    case ">=": return a >= b;
    case ">": return a > b;
    case "<=": return a <= b;
    case "<": return a < b;
    default: throw new Error(`memdb: operator ${op}`);
  }
};

const OPERATORS = new Set(["=", "<>", "!=", ">=", "<=", ">", "<"]);

/**
 * Evaluates a where/on clause against `env`: a Map from table name to row.
 * Returns true when every recognised condition holds.
 */
export function evaluate(node, env) {
  if (!node) return true;
  const flat = tokens(node);
  const text = flat.map((token) => token.str ?? "").join(" ");
  if (/\bor\b/.test(text)) return true;
  const rowValue = (column) => {
    const row = env.get(column.table[NAME]);
    if (row === undefined) throw new Error(`memdb: no row for ${column.table[NAME]} in env`);
    return row === null ? null : row[jsKey(column)];
  };
  let index = 0;
  while (index < flat.length) {
    const token = flat[index];
    if (!("col" in token)) { index += 1; continue; }
    const left = rowValue(token.col);
    const next = flat[index + 1];
    const opText = (next?.str ?? "").trim();
    if (opText === "is null") { if (left !== null && left !== undefined) return false; index += 2; continue; }
    if (opText === "is not null") { if (left === null || left === undefined) return false; index += 2; continue; }
    if (opText === "in" || opText === "not in") {
      const list = flat[index + 2]?.list ?? [];
      const hit = list.some((item) => normalize(item) === normalize(left));
      if ((opText === "in") !== hit) return false;
      index += 3; continue;
    }
    if (OPERATORS.has(opText)) {
      const other = flat[index + 2];
      const right = other && "col" in other ? rowValue(other.col) : other?.val;
      if (!compare(left, opText, right)) return false;
      index += 3; continue;
    }
    // A column we cannot interpret (json ->> etc.): skip it.
    index += 1;
  }
  return true;
}

function defaults(table, values, now) {
  const row = {};
  for (const [key, column] of Object.entries(table[COLUMNS])) {
    if (values[key] !== undefined) { row[key] = values[key]; continue; }
    if (typeof column.defaultFn === "function") { row[key] = column.defaultFn(); continue; }
    if (isSql(column.default)) {
      const text = column.default.queryChunks.map((chunk) => (isChunk(chunk) ? chunk.value.join("") : "")).join("");
      row[key] = /uuid/.test(text) ? randomUUID() : /now/.test(text) ? now() : null;
      continue;
    }
    if (column.default !== undefined) { row[key] = structuredClone(column.default); continue; }
    row[key] = null;
  }
  return row;
}

export function createMemDb({ now = () => new Date() } = {}) {
  const rows = new Map();
  const uniques = new Map();
  const of = (table) => {
    const name = tableName(table);
    if (!name) throw new Error("memdb: not a table");
    if (!rows.has(name)) rows.set(name, []);
    return rows.get(name);
  };
  const seed = (table, list) => { for (const values of list) of(table).push(defaults(table, values, now)); return of(table); };
  const all = (table) => of(table);
  const declareUnique = (table, keys) => { uniques.set(tableName(table), [...(uniques.get(tableName(table)) ?? []), keys]); };
  const calls = (query, name) => query.calls.filter(([method]) => method === name).map(([, args]) => args);

  function project(fields, env, fromTable) {
    if (!fields) return { ...env.get(tableName(fromTable)) };
    const out = {};
    for (const [key, value] of Object.entries(fields)) {
      if (isColumn(value)) { const row = env.get(value.table[NAME]); out[key] = row ? row[jsKey(value)] ?? null : null; }
      else if (value && value[NAME]) { const row = env.get(value[NAME]); out[key] = row ? { ...row } : null; }
      else throw new Error(`memdb: field ${key} of unknown shape`);
    }
    return out;
  }

  function aggregate(fields, matched) {
    const out = {};
    let any = false;
    for (const [key, value] of Object.entries(fields ?? {})) {
      if (!isSql(value)) continue;
      any = true;
      const flat = tokens(value);
      const text = flat.map((token) => token.str ?? "").join("");
      const column = flat.find((token) => "col" in token)?.col;
      const read = (env) => env.get(column.table[NAME])?.[jsKey(column)];
      if (/count\(/.test(text)) out[key] = matched.length;
      else if (/sum\(/.test(text)) out[key] = matched.reduce((sum, env) => sum + Number(read(env) ?? 0), 0);
      else if (/max\(/.test(text)) out[key] = matched.reduce((max, env) => { const v = read(env); return v != null && (max == null || v > max) ? v : max; }, null);
      else throw new Error(`memdb: aggregate ${text}`);
    }
    return any ? [out] : null;
  }

  function select(query) {
    const fromTable = calls(query, "from")[0]?.[0] ?? query.table;
    const joins = [
      ...calls(query, "innerJoin").map((args) => ({ kind: "inner", table: args[0], on: args[1] })),
      ...calls(query, "leftJoin").map((args) => ({ kind: "left", table: args[0], on: args[1] })),
    ];
    const where = calls(query, "where")[0]?.[0];
    let envs = of(fromTable).map((row) => new Map([[tableName(fromTable), row]]));
    for (const join of joins) {
      const next = [];
      for (const env of envs) {
        const matches = of(join.table).filter((row) => evaluate(join.on, new Map([...env, [tableName(join.table), row]])));
        if (matches.length) for (const row of matches) next.push(new Map([...env, [tableName(join.table), row]]));
        else if (join.kind === "left") next.push(new Map([...env, [tableName(join.table), null]]));
      }
      envs = next;
    }
    const matched = envs.filter((env) => evaluate(where, env));
    const agg = aggregate(query.fields, matched);
    if (agg) return agg;
    let out = matched.map((env, index) => ({ row: project(query.fields, env, fromTable), env, index }));
    const orderBy = calls(query, "orderBy")[0];
    if (orderBy?.length) {
      const [first] = orderBy;
      const descending = isSql(first) && tokens(first).some((token) => /desc/.test(token.str ?? ""));
      const column = isColumn(first) ? first : tokens(first).find((token) => "col" in token)?.col;
      if (column) {
        const key = jsKey(column); const name = column.table[NAME];
        out = out.map((entry) => ({ ...entry, sort: normalize(entry.env.get(name)?.[key]) ?? 0 }))
          .sort((a, b) => (a.sort === b.sort ? a.index - b.index : descending ? (a.sort < b.sort ? 1 : -1) : (a.sort < b.sort ? -1 : 1)));
      }
    }
    const limit = calls(query, "limit")[0]?.[0];
    let result = out.map((entry) => entry.row);
    if (typeof limit === "number") result = result.slice(0, limit);
    return result;
  }

  function insert(query) {
    const table = query.table;
    const list = Array.isArray(query.values) ? query.values : [query.values];
    const conflictNothing = calls(query, "onConflictDoNothing")[0]?.[0];
    const conflictUpdate = calls(query, "onConflictDoUpdate")[0]?.[0];
    const out = [];
    for (const values of list) {
      const row = defaults(table, values, now);
      const targets = [conflictNothing?.target, conflictUpdate?.target].filter(Boolean).map((cols) => (Array.isArray(cols) ? cols : [cols]).map(jsKey)).concat(uniques.get(tableName(table)) ?? []);
      const clash = targets.length ? of(table).find((existing) => targets.some((keys) => keys.every((key) => normalize(existing[key]) === normalize(row[key])))) : null;
      if (clash && conflictUpdate) { Object.assign(clash, conflictUpdate.set ?? {}); out.push(clash); continue; }
      if (clash && conflictNothing) continue;
      if (clash) throw Object.assign(new Error(`memdb: unique violation on ${tableName(table)}`), { code: "23505" });
      of(table).push(row);
      out.push(row);
    }
    return out;
  }

  function update(query) {
    const table = query.table;
    const where = calls(query, "where")[0]?.[0];
    const out = [];
    for (const row of of(table)) {
      if (!evaluate(where, new Map([[tableName(table), row]]))) continue;
      Object.assign(row, query.values ?? {});
      for (const [key, column] of Object.entries(table[COLUMNS])) if (typeof column.onUpdateFn === "function" && query.values?.[key] === undefined) row[key] = column.onUpdateFn();
      out.push(row);
    }
    return out;
  }

  function remove(query) {
    const table = query.table;
    const where = calls(query, "where")[0]?.[0];
    const keep = []; const gone = [];
    for (const row of of(table)) (evaluate(where, new Map([[tableName(table), row]])) ? gone : keep).push(row);
    rows.set(tableName(table), keep);
    return gone;
  }

  const resolver = (query) => {
    switch (query.op) {
      case "select": return select(query);
      case "insert": return insert(query);
      case "update": return update(query);
      case "delete": return remove(query);
      default: throw new Error(`memdb: op ${query.op}`);
    }
  };

  return { resolver, seed, all, declareUnique, rows };
}
