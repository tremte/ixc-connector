import type { FieldFilter } from '../ixc/types.js';
import {
  assertRange,
  clip,
  join,
  label,
  pageText,
  queryPage,
  resolveId,
  resolvePage,
  str,
  type ToolDeps,
  type ToolText,
} from './support.js';

const STATUS: Record<string, string> = {
  A: 'aberta',
  AN: 'análise',
  EN: 'encaminhada',
  AS: 'assumida',
  AG: 'agendada',
  DS: 'deslocamento',
  EX: 'execução',
  F: 'finalizada',
  RAG: 'aguardando agendamento',
};

const PRIORIDADE: Record<string, string> = { B: 'baixa', N: 'normal', A: 'alta', M: 'média', U: 'urgente' };

export interface ListarOsInput {
  status?: string;
  tecnico_id?: string;
  tecnico?: string;
  assunto_id?: string;
  assunto?: string;
  cidade_id?: string;
  cidade?: string;
  bairro?: string;
  regiao?: string;
  cliente_id?: string;
  data_inicio?: string;
  data_fim?: string;
  pagina?: number;
  limite?: number;
}

export async function listarOrdens(deps: ToolDeps, input: ListarOsInput): Promise<ToolText> {
  const filters: FieldFilter[] = [];
  const status = (input.status ?? 'abertas').trim().toLowerCase();
  if (status === 'abertas') filters.push({ field: 'status', op: '!=', value: 'F' });
  else if (status === 'finalizadas') filters.push({ field: 'status', op: '=', value: 'F' });
  else if (status !== 'todas') {
    const code = input.status?.trim().toUpperCase() ?? '';
    if (!STATUS[code]) throw new Error(`Status de OS inválido. Use abertas, finalizadas, todas ou ${Object.keys(STATUS).join(', ')}.`);
    filters.push({ field: 'status', op: '=', value: code });
  }
  if (input.tecnico_id) filters.push({ field: 'id_tecnico', op: '=', value: input.tecnico_id });
  else if (input.tecnico) {
    filters.push({ field: 'id_tecnico', op: '=', value: await resolveId(deps, 'funcionarios', 'funcionario', input.tecnico) });
  }
  if (input.assunto_id) filters.push({ field: 'id_assunto', op: '=', value: input.assunto_id });
  else if (input.assunto) {
    filters.push({ field: 'id_assunto', op: '=', value: await resolveId(deps, 'su_oss_assunto', 'assunto', input.assunto) });
  }
  if (input.cidade_id) filters.push({ field: 'id_cidade', op: '=', value: input.cidade_id });
  else if (input.cidade) {
    filters.push({ field: 'id_cidade', op: '=', value: await resolveId(deps, 'cidade', 'nome', input.cidade) });
  }
  if (input.bairro) filters.push({ field: 'bairro', op: 'L', value: input.bairro.trim() });
  if (input.regiao) filters.push({ field: 'regiao_manutencao', op: 'L', value: input.regiao.trim() });
  if (input.cliente_id) filters.push({ field: 'id_cliente', op: '=', value: input.cliente_id });
  if (input.data_inicio || input.data_fim) {
    if (!input.data_inicio || !input.data_fim) throw new Error('Informe data_inicio e data_fim juntas (AAAA-MM-DD).');
    assertRange(input.data_inicio, input.data_fim);
    filters.push({ field: 'data_abertura', op: '>=', value: input.data_inicio });
    filters.push({ field: 'data_abertura', op: '<=', value: input.data_fim });
  }
  if (status === 'todas' && filters.length === 0) {
    throw new Error('Para status=todas informe outro filtro (cliente, técnico, cidade ou período).');
  }
  const { page, rp } = resolvePage(input.pagina, input.limite, deps);
  const result = await queryPage(deps, 'su_oss_chamado', filters, page, rp, 'id', 'desc');
  return {
    count: result.rows.length,
    text: pageText('Ordens de serviço', result.rows.length, result.total, page, rp, result.rows.map(osLine)),
  };
}

export async function obterOrdem(deps: ToolDeps, id: string): Promise<ToolText> {
  const result = await queryPage(deps, 'su_oss_chamado', [{ field: 'id', op: '=', value: id }], 1, 1, 'id', 'asc');
  const row = result.rows[0];
  if (!row) return { count: 0, text: `Ordem de serviço ${id} não encontrada.` };
  const lines = [
    `OS ${str(row, 'id')} protocolo ${str(row, 'protocolo') ?? '-'}`,
    `Status: ${label(STATUS, str(row, 'status')) ?? '-'}`,
    `Cliente: ${str(row, 'id_cliente') ?? '-'}`,
    `Login: ${str(row, 'id_login') ?? '-'}`,
    `Assunto (id): ${str(row, 'id_assunto') ?? '-'}`,
    `Técnico (id): ${str(row, 'id_tecnico') ?? '-'}`,
    `Prioridade: ${label(PRIORIDADE, str(row, 'prioridade')) ?? str(row, 'prioridade') ?? '-'}`,
    `Cidade (id): ${str(row, 'id_cidade') ?? '-'}`,
    `Bairro: ${str(row, 'bairro') ?? '-'}`,
    `Endereço: ${str(row, 'endereco') ?? '-'}`,
    `Região: ${str(row, 'regiao_manutencao') ?? '-'}`,
    `Abertura: ${str(row, 'data_abertura') ?? '-'}`,
    `Agenda: ${str(row, 'data_agenda') ?? '-'}`,
    `Fechamento: ${str(row, 'data_fechamento') ?? '-'}`,
    `Mensagem: ${clip(str(row, 'mensagem')) ?? '-'}`,
  ];
  return { count: 1, text: lines.join('\n') };
}

function osLine(row: Record<string, unknown>): string {
  return join([
    `id=${str(row, 'id')}`,
    str(row, 'protocolo'),
    `status=${label(STATUS, str(row, 'status'))}`,
    `cliente=${str(row, 'id_cliente') ?? '-'}`,
    `técnico=${str(row, 'id_tecnico') ?? '-'}`,
    `assunto=${str(row, 'id_assunto') ?? '-'}`,
    `cidade=${str(row, 'id_cidade') ?? '-'}`,
    str(row, 'bairro'),
    str(row, 'data_abertura') ? `abertura=${str(row, 'data_abertura')}` : undefined,
    clip(str(row, 'mensagem'), 80),
  ]);
}
