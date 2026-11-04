import type { FieldFilter } from '../ixc/types.js';
import { clip, join, label, pageText, queryPage, resolvePage, str, type ToolDeps, type ToolText } from './support.js';

const STATUS: Record<string, string> = {
  N: 'novo',
  P: 'pendente',
  EP: 'em progresso',
  S: 'solucionado',
  C: 'cancelado',
};

export interface ListarTicketsInput {
  status?: string;
  cliente_id?: string;
  assunto_id?: string;
  setor_id?: string;
  pagina?: number;
  limite?: number;
}

export async function listarTickets(deps: ToolDeps, input: ListarTicketsInput): Promise<ToolText> {
  const filters: FieldFilter[] = [];
  const status = (input.status ?? 'abertos').trim().toLowerCase();
  if (status === 'abertos') {
    filters.push({ field: 'su_status', op: '!=', value: 'S' });
    filters.push({ field: 'su_status', op: '!=', value: 'C' });
  } else if (status === 'solucionados') filters.push({ field: 'su_status', op: '=', value: 'S' });
  else if (status === 'cancelados') filters.push({ field: 'su_status', op: '=', value: 'C' });
  else if (status !== 'todos') {
    const code = input.status?.trim().toUpperCase() ?? '';
    if (!STATUS[code]) throw new Error(`Status de atendimento inválido. Use abertos, solucionados, cancelados, todos ou ${Object.keys(STATUS).join(', ')}.`);
    filters.push({ field: 'su_status', op: '=', value: code });
  }
  if (input.cliente_id) filters.push({ field: 'id_cliente', op: '=', value: input.cliente_id });
  if (input.assunto_id) filters.push({ field: 'id_assunto', op: '=', value: input.assunto_id });
  if (input.setor_id) filters.push({ field: 'id_ticket_setor', op: '=', value: input.setor_id });
  if (status === 'todos' && filters.length === 0) {
    throw new Error('Para status=todos informe cliente_id, assunto_id ou setor_id.');
  }
  const { page, rp } = resolvePage(input.pagina, input.limite, deps);
  const result = await queryPage(deps, 'su_ticket', filters, page, rp, 'id', 'desc');
  const lines = result.rows.map((row) =>
    join([
      `id=${str(row, 'id')}`,
      str(row, 'protocolo'),
      `status=${label(STATUS, str(row, 'su_status'))}`,
      `cliente=${str(row, 'id_cliente') ?? '-'}`,
      str(row, 'titulo'),
      str(row, 'data_criacao') ? `criação=${str(row, 'data_criacao')}` : undefined,
    ]),
  );
  return { count: result.rows.length, text: pageText('Atendimentos', result.rows.length, result.total, page, rp, lines) };
}

export async function obterTicket(deps: ToolDeps, id: string): Promise<ToolText> {
  const result = await queryPage(deps, 'su_ticket', [{ field: 'id', op: '=', value: id }], 1, 1, 'id', 'asc');
  const row = result.rows[0];
  if (!row) return { count: 0, text: `Atendimento ${id} não encontrado.` };
  const message = str(row, 'menssagem') ?? str(row, 'mensagem');
  const lines = [
    `Atendimento ${str(row, 'id')} protocolo ${str(row, 'protocolo') ?? '-'}`,
    `Título: ${str(row, 'titulo') ?? '-'}`,
    `Status: ${label(STATUS, str(row, 'su_status')) ?? '-'}`,
    `Cliente: ${str(row, 'id_cliente') ?? '-'}`,
    `Contrato: ${str(row, 'id_contrato') ?? '-'}`,
    `Assunto (id): ${str(row, 'id_assunto') ?? '-'}`,
    `Setor (id): ${str(row, 'id_ticket_setor') ?? '-'}`,
    `Aberto por (id): ${str(row, 'id_usuarios') ?? '-'}`,
    `Criação: ${str(row, 'data_criacao') ?? '-'}`,
    `Última alteração: ${str(row, 'data_ultima_alteracao') ?? '-'}`,
    `Mensagem: ${clip(message) ?? '-'}`,
  ];
  return { count: 1, text: lines.join('\n') };
}
