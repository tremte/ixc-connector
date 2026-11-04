import type { FieldFilter } from '../ixc/types.js';
import { join, money, pageText, queryPage, resolvePage, str, yn, type ToolDeps, type ToolText } from './support.js';

export interface ListarPlanosInput {
  nome?: string;
  ativo?: 'S' | 'N' | 'todos';
  pagina?: number;
  limite?: number;
}

export async function listarPlanos(deps: ToolDeps, input: ListarPlanosInput): Promise<ToolText> {
  const filters: FieldFilter[] = [];
  const ativo = input.ativo ?? 'S';
  if (ativo !== 'todos') filters.push({ field: 'Ativo', op: '=', value: ativo });
  if (input.nome) {
    if (input.nome.trim().length < 2) throw new Error('Informe ao menos 2 caracteres do nome do plano.');
    filters.push({ field: 'nome', op: 'L', value: input.nome.trim() });
  }
  const { page, rp } = resolvePage(input.pagina, input.limite, deps);
  const result = await queryPage(deps, 'vd_contratos', filters, page, rp, 'nome', 'asc');
  const lines = result.rows.map((row) =>
    join([
      `id=${str(row, 'id')}`,
      str(row, 'nome'),
      `valor=${money(row.valor_contrato)}`,
      `ativo=${yn(str(row, 'Ativo')) ?? '-'}`,
    ]),
  );
  return { count: result.rows.length, text: pageText('Planos', result.rows.length, result.total, page, rp, lines) };
}

export async function obterPlano(deps: ToolDeps, id: string): Promise<ToolText> {
  const result = await queryPage(deps, 'vd_contratos', [{ field: 'id', op: '=', value: id }], 1, 1, 'id', 'asc');
  const row = result.rows[0];
  if (!row) return { count: 0, text: `Plano ${id} não encontrado.` };
  const lines = [
    `Plano ${str(row, 'id')}`,
    `Nome: ${str(row, 'nome') ?? '-'}`,
    `Descrição: ${str(row, 'descricao') ?? '-'}`,
    `Valor: ${money(row.valor_contrato)}`,
    `Ativo: ${yn(str(row, 'Ativo')) ?? '-'}`,
  ];
  return { count: 1, text: lines.join('\n') };
}
