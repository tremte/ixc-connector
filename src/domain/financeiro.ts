import type { FieldFilter } from '../ixc/types.js';
import {
  assertRange,
  join,
  label,
  listCapped,
  money,
  pageText,
  parseMoney,
  queryPage,
  requireOne,
  resolvePage,
  str,
  todayIso,
  type Row,
  type ToolDeps,
  type ToolText,
} from './support.js';

const STATUS: Record<string, string> = {
  A: 'a receber',
  R: 'recebido',
  P: 'parcial',
  C: 'cancelado',
};

export interface ListarContasInput {
  cliente_id?: string;
  contrato_id?: string;
  situacao?: 'abertas' | 'vencidas' | 'recebidas' | 'todas';
  incluir_parciais?: boolean;
  data_inicio?: string;
  data_fim?: string;
  pagina?: number;
  limite?: number;
}

export async function listarContas(deps: ToolDeps, input: ListarContasInput): Promise<ToolText> {
  requireOne(
    [input.cliente_id, input.contrato_id, input.data_inicio],
    'Informe cliente_id, contrato_id ou o intervalo data_inicio/data_fim.',
  );
  if (input.data_inicio || input.data_fim) {
    if (!input.data_inicio || !input.data_fim) throw new Error('Informe data_inicio e data_fim juntas (AAAA-MM-DD).');
    assertRange(input.data_inicio, input.data_fim);
  }
  const situacao = input.situacao ?? 'abertas';
  const today = todayIso(deps.timeZone);
  const filters = contaFilters(input, situacao, today, 'A');
  const { page, rp } = resolvePage(input.pagina, input.limite, deps);
  const primary = await queryPage(deps, 'fn_areceber', filters, page, rp, 'data_vencimento', 'asc');
  let rows = primary.rows;
  let total = primary.total;
  if (input.incluir_parciais && (situacao === 'abertas' || situacao === 'vencidas')) {
    const partial = await queryPage(deps, 'fn_areceber', contaFilters(input, situacao, today, 'P'), page, rp, 'data_vencimento', 'asc');
    const seen = new Set(rows.map((row) => str(row, 'id')));
    rows = [...rows, ...partial.rows.filter((row) => !seen.has(str(row, 'id')))].slice(0, rp);
    total += partial.total;
  }
  return {
    count: rows.length,
    text: pageText('Contas a receber', rows.length, total, page, rp, rows.map(contaLine)),
  };
}

export async function resumoInadimplencia(deps: ToolDeps, clienteId?: string): Promise<ToolText> {
  const today = todayIso(deps.timeZone);
  const base: FieldFilter[] = [{ field: 'data_vencimento', op: '<', value: today }];
  if (clienteId) base.push({ field: 'id_cliente', op: '=', value: clienteId });
  const open = await listCapped(deps, 'fn_areceber', [...base, { field: 'status', op: '=', value: 'A' }], 'data_vencimento', 'asc');
  const partial = await listCapped(deps, 'fn_areceber', [...base, { field: 'status', op: '=', value: 'P' }], 'data_vencimento', 'asc');
  const rows = dedupe([...open.rows, ...partial.rows]);
  const total = open.total + partial.total;
  const truncated = open.truncated || partial.truncated;
  let amount = 0;
  const clients = new Set<string>();
  for (const row of rows) {
    amount += parseMoney(row.valor_aberto) ?? parseMoney(row.valor) ?? 0;
    const client = str(row, 'id_cliente');
    if (client) clients.add(client);
  }
  const lines = [
    `Inadimplência com vencimento anterior a ${today} (${deps.timeZone}).`,
    'Considera títulos a receber (A) e parciais (P).',
    `Títulos no IXC: ${total}. Somados nesta resposta: ${rows.length}.`,
    `Valor em aberto somado: ${money(amount)}.`,
    `Clientes distintos na soma: ${clients.size}.`,
    truncated ? 'A soma está incompleta: o teto IXC_SUMMARY_MAX_RECORDS foi atingido. Estreite por cliente_id.' : 'Soma completa dentro do teto configurado.',
  ];
  return { count: rows.length, text: lines.join('\n') };
}

function contaFilters(input: ListarContasInput, situacao: string, today: string, status: 'A' | 'P'): FieldFilter[] {
  const filters: FieldFilter[] = [];
  if (input.cliente_id) filters.push({ field: 'id_cliente', op: '=', value: input.cliente_id });
  if (input.contrato_id) filters.push({ field: 'id_contrato', op: '=', value: input.contrato_id });
  if (situacao === 'abertas' || situacao === 'vencidas') filters.push({ field: 'status', op: '=', value: status });
  if (situacao === 'recebidas') filters.push({ field: 'status', op: '=', value: 'R' });
  if (situacao === 'vencidas') filters.push({ field: 'data_vencimento', op: '<', value: today });
  if (input.data_inicio && input.data_fim) {
    filters.push({ field: 'data_vencimento', op: '>=', value: input.data_inicio });
    filters.push({ field: 'data_vencimento', op: '<=', value: input.data_fim });
  }
  return filters;
}

function contaLine(row: Row): string {
  return join([
    `id=${str(row, 'id')}`,
    `cliente=${str(row, 'id_cliente')}`,
    `contrato=${str(row, 'id_contrato') ?? '-'}`,
    str(row, 'documento'),
    `status=${label(STATUS, str(row, 'status'))}`,
    `vencimento=${str(row, 'data_vencimento') ?? '-'}`,
    `valor=${money(row.valor)}`,
    `aberto=${money(row.valor_aberto)}`,
    str(row, 'pagamento_data') ? `pagamento=${str(row, 'pagamento_data')}` : undefined,
  ]);
}

function dedupe(rows: Row[]): Row[] {
  const seen = new Set<string>();
  const out: Row[] = [];
  for (const row of rows) {
    const id = str(row, 'id') ?? '';
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(row);
  }
  return out;
}
