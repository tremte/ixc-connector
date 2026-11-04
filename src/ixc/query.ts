import { ReadOnlyViolation } from './errors.js';
import { OPERATORS, type AllowedTable, type FieldFilter, type ListBody, type Oper } from './types.js';

const FIELD = /^[A-Za-z][A-Za-z0-9_]*$/;

export interface BuildListInput {
  filters?: FieldFilter[];
  page: number;
  rp: number;
  sortField?: string;
  sortOrder?: 'asc' | 'desc';
}

export function buildListBody(table: AllowedTable, input: BuildListInput): ListBody {
  const filters = input.filters ?? [];
  for (const filter of filters) {
    assertField(filter.field);
    assertOper(filter.op);
  }
  const sortField = input.sortField ?? 'id';
  assertField(sortField);
  const sortOrder = input.sortOrder ?? 'desc';
  if (sortOrder !== 'asc' && sortOrder !== 'desc') {
    throw new ReadOnlyViolation('Ordenação inválida.');
  }

  let qtype = `${table}.id`;
  let query = '0';
  let oper: Oper = '>';
  let extra = filters;
  const first = filters[0];
  if (filters.length > 0 && first && first.op === '=') {
    qtype = `${table}.${first.field}`;
    query = first.value;
    oper = first.op;
    extra = filters.slice(1);
  }

  const body: ListBody = {
    qtype,
    query,
    oper,
    page: String(Math.max(1, Math.floor(input.page))),
    rp: String(Math.max(1, Math.floor(input.rp))),
    sortname: `${table}.${sortField}`,
    sortorder: sortOrder,
  };
  if (extra.length > 0) {
    body.grid_param = JSON.stringify(
      extra.map((filter) => ({
        TB: `${table}.${filter.field}`,
        OP: filter.op,
        P: filter.value,
      })),
    );
  }
  assertListBody(table, body);
  return body;
}

export function assertListBody(table: AllowedTable, body: ListBody): void {
  assertQualified(table, body.qtype);
  assertOper(body.oper);
  if (body.sortorder !== 'asc' && body.sortorder !== 'desc') {
    throw new ReadOnlyViolation('Ordenação inválida.');
  }
  assertQualified(table, body.sortname);
  if (body.grid_param !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body.grid_param);
    } catch {
      throw new ReadOnlyViolation('grid_param inválido.');
    }
    if (!Array.isArray(parsed)) throw new ReadOnlyViolation('grid_param inválido.');
    for (const item of parsed) {
      if (!item || typeof item !== 'object') throw new ReadOnlyViolation('Filtro inválido.');
      const row = item as { TB?: unknown; OP?: unknown; P?: unknown };
      if (typeof row.TB !== 'string' || typeof row.OP !== 'string' || typeof row.P !== 'string') {
        throw new ReadOnlyViolation('Filtro inválido.');
      }
      assertQualified(table, row.TB);
      assertOper(row.OP);
    }
  }
}

function assertQualified(table: string, qualified: string): void {
  const prefix = `${table}.`;
  if (!qualified.startsWith(prefix)) {
    throw new ReadOnlyViolation(`Campo fora da tabela ${table}.`);
  }
  assertField(qualified.slice(prefix.length));
}

function assertField(field: string): void {
  if (!FIELD.test(field)) throw new ReadOnlyViolation(`Campo inválido: ${field}`);
}

function assertOper(oper: string): asserts oper is Oper {
  if (!(OPERATORS as readonly string[]).includes(oper)) {
    throw new ReadOnlyViolation(`Operador não permitido: ${oper}`);
  }
}
