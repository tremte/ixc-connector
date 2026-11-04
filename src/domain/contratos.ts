import type { FieldFilter } from '../ixc/types.js';
import {
  assertRange,
  join,
  label,
  pageText,
  queryPage,
  resolvePage,
  str,
  type ToolDeps,
  type ToolText,
} from './support.js';

const STATUS: Record<string, string> = {
  P: 'pré-contrato',
  A: 'ativo',
  I: 'inativo',
  N: 'negativado',
  D: 'desistiu',
};

const INTERNET: Record<string, string> = {
  A: 'ativo',
  D: 'desativado',
  CM: 'bloqueio manual',
  CA: 'bloqueio automático',
  FA: 'financeiro em atraso',
  AA: 'aguardando assinatura',
};

const STATUS_ALIAS: Record<string, string> = {
  pre: 'P',
  'pré': 'P',
  'pre-contrato': 'P',
  p: 'P',
  ativo: 'A',
  a: 'A',
  inativo: 'I',
  i: 'I',
  negativado: 'N',
  n: 'N',
  desistiu: 'D',
  d: 'D',
};

const INTERNET_ALIAS: Record<string, string> = {
  ativo: 'A',
  a: 'A',
  desativado: 'D',
  d: 'D',
  bloqueio_manual: 'CM',
  cm: 'CM',
  bloqueio_automatico: 'CA',
  ca: 'CA',
  financeiro: 'FA',
  fa: 'FA',
  aguardando: 'AA',
  aa: 'AA',
};

export interface ListarContratosInput {
  cliente_id?: string;
  status?: string;
  status_internet?: string;
  pagina?: number;
  limite?: number;
}

export async function listarContratos(deps: ToolDeps, input: ListarContratosInput): Promise<ToolText> {
  const filters: FieldFilter[] = [];
  if (input.cliente_id) filters.push({ field: 'id_cliente', op: '=', value: input.cliente_id });
  if (input.status) filters.push({ field: 'status', op: '=', value: code(input.status, STATUS_ALIAS, 'status') });
  if (input.status_internet) {
    filters.push({ field: 'status_internet', op: '=', value: code(input.status_internet, INTERNET_ALIAS, 'status_internet') });
  }
  if (filters.length === 0) {
    throw new Error('Informe cliente_id, status ou status_internet.');
  }
  const { page, rp } = resolvePage(input.pagina, input.limite, deps);
  const result = await queryPage(deps, 'cliente_contrato', filters, page, rp, 'id', 'desc');
  return {
    count: result.rows.length,
    text: pageText('Contratos', result.rows.length, result.total, page, rp, result.rows.map(contractLine)),
  };
}

export async function obterContrato(deps: ToolDeps, id: string): Promise<ToolText> {
  const result = await queryPage(deps, 'cliente_contrato', [{ field: 'id', op: '=', value: id }], 1, 1, 'id', 'asc');
  const row = result.rows[0];
  if (!row) return { count: 0, text: `Contrato ${id} não encontrado.` };
  const lines = [
    `Contrato ${str(row, 'id')}`,
    `Cliente: ${str(row, 'id_cliente') ?? '-'}`,
    `Descrição: ${str(row, 'contrato') ?? '-'}`,
    `Plano (id_vd_contrato): ${str(row, 'id_vd_contrato') ?? '-'}`,
    `Status: ${label(STATUS, str(row, 'status')) ?? '-'}`,
    `Internet: ${label(INTERNET, str(row, 'status_internet')) ?? '-'}`,
    `Ativação: ${str(row, 'data_ativacao') ?? '-'}`,
    `Cadastro: ${str(row, 'data') ?? '-'}`,
    `Cancelamento: ${str(row, 'data_cancelamento') ?? '-'}`,
    `Pago até: ${str(row, 'pago_ate_data') ?? '-'}`,
    `Vendedor: ${str(row, 'id_vendedor') ?? '-'}`,
  ];
  return { count: 1, text: lines.join('\n') };
}

export interface MovimentacaoInput {
  tipo: 'novos' | 'cancelados';
  data_inicio: string;
  data_fim: string;
  cliente_id?: string;
  pagina?: number;
  limite?: number;
}

export async function listarMovimentacao(deps: ToolDeps, input: MovimentacaoInput): Promise<ToolText> {
  assertRange(input.data_inicio, input.data_fim);
  const field = input.tipo === 'novos' ? 'data_ativacao' : 'data_cancelamento';
  const filters: FieldFilter[] = [
    { field, op: '>=', value: input.data_inicio },
    { field, op: '<=', value: input.data_fim },
  ];
  if (input.cliente_id) filters.push({ field: 'id_cliente', op: '=', value: input.cliente_id });
  const { page, rp } = resolvePage(input.pagina, input.limite, deps);
  const result = await queryPage(deps, 'cliente_contrato', filters, page, rp, field, 'desc');
  const title = input.tipo === 'novos' ? 'Contratos ativados' : 'Contratos cancelados';
  return {
    count: result.rows.length,
    text: pageText(title, result.rows.length, result.total, page, rp, result.rows.map(contractLine)),
  };
}

function contractLine(row: Record<string, unknown>): string {
  return join([
    `id=${str(row, 'id')}`,
    `cliente=${str(row, 'id_cliente')}`,
    str(row, 'contrato'),
    `status=${label(STATUS, str(row, 'status'))}`,
    `internet=${label(INTERNET, str(row, 'status_internet'))}`,
    str(row, 'data_ativacao') ? `ativação=${str(row, 'data_ativacao')}` : undefined,
    str(row, 'data_cancelamento') ? `cancelamento=${str(row, 'data_cancelamento')}` : undefined,
    `plano=${str(row, 'id_vd_contrato') ?? '-'}`,
  ]);
}

function code(value: string, alias: Record<string, string>, field: string): string {
  const raw = value.trim();
  const mapped = alias[raw.toLowerCase()] ?? (Object.values(alias).includes(raw.toUpperCase()) ? raw.toUpperCase() : undefined);
  if (!mapped) {
    throw new Error(`Valor de ${field} não reconhecido. Use o código IXC ou: ${[...new Set(Object.keys(alias))].join(', ')}.`);
  }
  return mapped;
}
