import type { AuditEvent, AuditWriter } from '../audit/log.js';
import { sanitizeAuditParams, writeAudit } from '../audit/log.js';
import { buildListBody } from '../ixc/query.js';
import type { AllowedTable, FieldFilter, IxcReader } from '../ixc/types.js';
import { maskValue } from '../privacy/mask.js';
import type { ProfileName } from '../profiles.js';

export type Row = Record<string, unknown>;

export interface ToolDeps {
  reader: IxcReader;
  profile: ProfileName;
  keyName: string;
  maskPii: boolean;
  pageSize: number;
  pageSizeMax: number;
  summaryMaxRecords: number;
  timeZone: string;
  audit?: AuditWriter;
}

export interface ToolText {
  text: string;
  count: number;
}

export function resolvePage(pagina: number | undefined, limite: number | undefined, deps: ToolDeps): { page: number; rp: number } {
  const page = pagina && pagina > 0 ? Math.floor(pagina) : 1;
  const requested = limite && limite > 0 ? Math.floor(limite) : deps.pageSize;
  return { page, rp: Math.min(deps.pageSizeMax, Math.max(1, requested)) };
}

export async function queryPage(
  deps: ToolDeps,
  table: AllowedTable,
  filters: FieldFilter[],
  page: number,
  rp: number,
  sortField: string,
  sortOrder: 'asc' | 'desc' = 'desc',
): Promise<{ rows: Row[]; total: number; page: number; rp: number }> {
  const body = buildListBody(table, { filters, page, rp, sortField, sortOrder });
  const result = await deps.reader.list(table, body);
  const rows = (result.registros ?? []).map((row) => maskValue(row, deps.maskPii));
  const totalNumber = Number(result.total);
  return {
    rows,
    total: Number.isFinite(totalNumber) ? totalNumber : rows.length,
    page,
    rp,
  };
}

export async function listCapped(
  deps: ToolDeps,
  table: AllowedTable,
  filters: FieldFilter[],
  sortField: string,
  sortOrder: 'asc' | 'desc',
): Promise<{ rows: Row[]; total: number; truncated: boolean }> {
  const rp = deps.pageSizeMax;
  const collected: Row[] = [];
  let total = 0;
  for (let page = 1; page <= 100; page += 1) {
    const result = await queryPage(deps, table, filters, page, rp, sortField, sortOrder);
    total = result.total;
    collected.push(...result.rows);
    if (result.rows.length === 0 || collected.length >= total || collected.length >= deps.summaryMaxRecords) break;
  }
  const rows = collected.slice(0, deps.summaryMaxRecords);
  return { rows, total, truncated: total > rows.length };
}

export async function resolveId(deps: ToolDeps, table: AllowedTable, field: string, name: string): Promise<string> {
  const result = await queryPage(
    deps,
    table,
    [{ field, op: 'L', value: name.trim() }],
    1,
    10,
    'id',
    'asc',
  );
  if (result.rows.length === 0) {
    throw new Error(`Nenhum registro em ${table} contendo "${name.trim()}". Informe o id.`);
  }
  if (result.rows.length > 1) {
    const options = result.rows.map((row) => `${String(row.id)}=${String(row[field] ?? '')}`).join(', ');
    throw new Error(`Mais de um resultado para "${name.trim()}": ${options}. Informe o id.`);
  }
  return String(result.rows[0]?.id ?? '');
}

export function runTool(deps: ToolDeps, tool: string, params: unknown, fn: () => Promise<ToolText>): Promise<{
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}> {
  const started = Date.now();
  const safeParams = sanitizeAuditParams(params);
  return fn()
    .then((output) => {
      emit(deps, tool, safeParams, output.count, Date.now() - started, true);
      return { content: [{ type: 'text' as const, text: output.text }] };
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'Erro ao consultar o IXC.';
      emit(deps, tool, safeParams, 0, Date.now() - started, false, message.slice(0, 200));
      return { isError: true, content: [{ type: 'text' as const, text: message }] };
    });
}

function emit(
  deps: ToolDeps,
  tool: string,
  params: unknown,
  resultCount: number,
  durationMs: number,
  ok: boolean,
  error?: string,
): void {
  const event: AuditEvent = {
    ts: new Date().toISOString(),
    level: 'audit',
    profile: deps.profile,
    keyName: deps.keyName,
    tool,
    params,
    resultCount,
    durationMs,
    ok,
    ...(error ? { error } : {}),
  };
  writeAudit(event, deps.audit);
}

export function pageText(title: string, shown: number, total: number, page: number, rp: number, lines: string[]): string {
  const more = page * rp < total ? ' Há mais páginas.' : '';
  const header = `${title}: ${shown} nesta página, total ${total}, página ${page}.${more}`;
  if (lines.length === 0) return `${header}\nNenhum registro.`;
  return [header, ...lines.map((line, index) => `${index + 1}. ${line}`)].join('\n');
}

export function str(row: Row, key: string): string | undefined {
  const value = row[key];
  if (value == null || value === '') return undefined;
  return String(value);
}

export function clip(value: string | undefined, max = 220): string | undefined {
  if (!value) return undefined;
  const text = value.replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

export function label(map: Record<string, string>, code: string | undefined): string | undefined {
  if (!code) return undefined;
  const name = map[code];
  return name ? `${name} (${code})` : code;
}

export function yn(code: string | undefined): string | undefined {
  if (code === 'S') return 'sim';
  if (code === 'N') return 'não';
  return code;
}

export function todayIso(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function assertRange(start: string, end: string, maxDays = 366): void {
  const begin = Date.parse(`${start}T00:00:00Z`);
  const finish = Date.parse(`${end}T00:00:00Z`);
  if (Number.isNaN(begin) || Number.isNaN(finish) || finish < begin) {
    throw new Error('Período inválido: data_inicio deve ser anterior ou igual a data_fim.');
  }
  if ((finish - begin) / 86_400_000 > maxDays) {
    throw new Error(`Período maior que ${maxDays} dias. Divida a consulta.`);
  }
}

export function parseMoney(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const text = value.trim();
  const normalized = text.includes(',') ? text.replace(/\./g, '').replace(',', '.') : text;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

export function money(value: unknown): string {
  const number = parseMoney(value);
  if (number == null) return '-';
  return number.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function join(parts: Array<string | undefined>): string {
  return parts.filter((part): part is string => Boolean(part)).join(' | ');
}

export function requireOne(values: unknown[], message: string): void {
  if (!values.some((value) => value !== undefined && value !== '')) throw new Error(message);
}

export function digits(value: string): string {
  return value.replace(/\D/g, '');
}

export function formatCpf(value: string): string {
  return `${value.slice(0, 3)}.${value.slice(3, 6)}.${value.slice(6, 9)}-${value.slice(9)}`;
}

export function formatCnpj(value: string): string {
  return `${value.slice(0, 2)}.${value.slice(2, 5)}.${value.slice(5, 8)}/${value.slice(8, 12)}-${value.slice(12)}`;
}
