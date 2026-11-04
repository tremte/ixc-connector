import { buildFixtures, type Row } from './fixtures.js';
import { finalizePage } from './sanitize.js';
import { assertAllowedTable, type AllowedTable, type IxcPage, type IxcReader, type ListBody, type Oper } from './types.js';

export class MockIxcClient implements IxcReader {
  private readonly tables: Record<AllowedTable, Row[]>;

  constructor(today: string) {
    this.tables = buildFixtures(today);
  }

  async list(table: AllowedTable, body: ListBody): Promise<IxcPage> {
    assertAllowedTable(table);
    const rows = (this.tables[table] ?? []).filter((row) => matches(row, body));
    const sorted = sortRows(rows, body.sortname, body.sortorder);
    const page = Math.max(1, Number(body.page) || 1);
    const rp = Math.max(1, Number(body.rp) || 20);
    const start = (page - 1) * rp;
    return finalizePage({
      page: String(page),
      total: String(sorted.length),
      registros: sorted.slice(start, start + rp),
    });
  }
}

function matches(row: Row, body: ListBody): boolean {
  if (!compare(row, body.qtype, body.oper, body.query)) return false;
  if (!body.grid_param) return true;
  const filters = JSON.parse(body.grid_param) as Array<{ TB: string; OP: Oper; P: string }>;
  return filters.every((filter) => compare(row, filter.TB, filter.OP, filter.P));
}

function compare(row: Row, qualified: string, oper: Oper, expected: string): boolean {
  const field = qualified.split('.').pop() ?? qualified;
  const raw = row[field];
  const left = raw == null ? '' : String(raw);
  const leftNumber = Number(left);
  const rightNumber = Number(expected);
  const numeric = left.trim() !== '' && expected.trim() !== '' && Number.isFinite(leftNumber) && Number.isFinite(rightNumber);
  switch (oper) {
    case '=':
      return left === expected;
    case '!=':
      return left !== expected;
    case '>':
      return numeric ? leftNumber > rightNumber : left > expected;
    case '<':
      return numeric ? leftNumber < rightNumber : left < expected;
    case '>=':
      return numeric ? leftNumber >= rightNumber : left >= expected;
    case '<=':
      return numeric ? leftNumber <= rightNumber : left <= expected;
    case 'L':
      return left.toLowerCase().includes(expected.toLowerCase());
    case 'NL':
      return !left.toLowerCase().includes(expected.toLowerCase());
    default:
      return false;
  }
}

function sortRows(rows: Row[], sortname: string, order: 'asc' | 'desc'): Row[] {
  const field = sortname.split('.').pop() ?? 'id';
  const copy = [...rows];
  copy.sort((a, b) => {
    const av = a[field] == null ? '' : String(a[field]);
    const bv = b[field] == null ? '' : String(b[field]);
    const an = Number(av);
    const bn = Number(bv);
    const cmp = Number.isFinite(an) && Number.isFinite(bn) && av !== '' && bv !== '' ? an - bn : av.localeCompare(bv, 'pt-BR');
    return order === 'asc' ? cmp : -cmp;
  });
  return copy;
}
