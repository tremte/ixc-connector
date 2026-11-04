import type { FieldFilter } from '../ixc/types.js';
import {
  digits,
  formatCnpj,
  formatCpf,
  join,
  pageText,
  queryPage,
  requireOne,
  resolvePage,
  str,
  yn,
  type ToolDeps,
  type ToolText,
} from './support.js';

export interface BuscarClientesInput {
  nome?: string;
  cpf_cnpj?: string;
  id?: string;
  ativo?: 'S' | 'N';
  pagina?: number;
  limite?: number;
}

export async function buscarClientes(deps: ToolDeps, input: BuscarClientesInput): Promise<ToolText> {
  requireOne([input.nome, input.cpf_cnpj, input.id], 'Informe nome, cpf_cnpj ou id. A base inteira não é listada.');
  if (input.nome && input.nome.trim().length < 3) {
    throw new Error('Informe ao menos 3 caracteres do nome.');
  }
  const { page, rp } = resolvePage(input.pagina, input.limite, deps);
  const filters = baseFilters(input);
  let result = await queryPage(deps, 'cliente', filters, page, rp, 'id', 'asc');
  if (result.rows.length === 0 && input.nome && !input.id && !input.cpf_cnpj) {
    result = await queryPage(
      deps,
      'cliente',
      replaceField(filters, 'razao', 'fantasia'),
      page,
      rp,
      'id',
      'asc',
    );
  }
  if (result.rows.length === 0 && input.cpf_cnpj && !input.id) {
    for (const attempt of documentAttempts(input.cpf_cnpj).slice(1)) {
      result = await queryPage(
        deps,
        'cliente',
        replaceValue(filters, 'cnpj_cpf', attempt),
        page,
        rp,
        'id',
        'asc',
      );
      if (result.rows.length > 0) break;
    }
  }
  const lines = result.rows.map((row) =>
    join([
      `id=${str(row, 'id')}`,
      str(row, 'razao'),
      str(row, 'fantasia') ? `fantasia=${str(row, 'fantasia')}` : undefined,
      str(row, 'cnpj_cpf') ? `doc=${str(row, 'cnpj_cpf')}` : undefined,
      str(row, 'telefone_celular') ? `cel=${str(row, 'telefone_celular')}` : undefined,
      `ativo=${yn(str(row, 'ativo')) ?? '-'}`,
      str(row, 'bairro'),
    ]),
  );
  return { count: result.rows.length, text: pageText('Clientes', result.rows.length, result.total, page, rp, lines) };
}

export async function obterCliente(deps: ToolDeps, id: string): Promise<ToolText> {
  const result = await queryPage(deps, 'cliente', [{ field: 'id', op: '=', value: id }], 1, 1, 'id', 'asc');
  const row = result.rows[0];
  if (!row) return { count: 0, text: `Cliente ${id} não encontrado.` };
  const city = await cityName(deps, str(row, 'cidade'));
  const lines = [
    `Cliente ${str(row, 'id')}`,
    `Nome: ${str(row, 'razao') ?? '-'}`,
    str(row, 'fantasia') ? `Fantasia: ${str(row, 'fantasia')}` : undefined,
    `Tipo: ${str(row, 'tipo_pessoa') === 'J' ? 'jurídica' : str(row, 'tipo_pessoa') === 'F' ? 'física' : str(row, 'tipo_pessoa') ?? '-'}`,
    `CPF/CNPJ: ${str(row, 'cnpj_cpf') ?? '-'}`,
    `E-mail: ${str(row, 'email') ?? '-'}`,
    `Telefones: ${[str(row, 'fone'), str(row, 'telefone_celular'), str(row, 'telefone_comercial'), str(row, 'whatsapp')].filter(Boolean).join(', ') || '-'}`,
    `Endereço: ${[str(row, 'endereco'), str(row, 'numero'), str(row, 'bairro'), str(row, 'cep')].filter(Boolean).join(', ') || '-'}`,
    `Cidade (id IXC): ${str(row, 'cidade') ?? '-'}${city ? ` — ${city}` : ''}`,
    `Ativo: ${yn(str(row, 'ativo')) ?? '-'}`,
    `Cadastro: ${str(row, 'data_cadastro') ?? '-'}`,
  ].filter((line): line is string => Boolean(line));
  return { count: 1, text: lines.join('\n') };
}

function baseFilters(input: BuscarClientesInput): FieldFilter[] {
  const filters: FieldFilter[] = [];
  if (input.id) filters.push({ field: 'id', op: '=', value: input.id });
  if (input.cpf_cnpj) filters.push({ field: 'cnpj_cpf', op: '=', value: documentAttempts(input.cpf_cnpj)[0] ?? input.cpf_cnpj });
  if (input.nome) filters.push({ field: 'razao', op: 'L', value: input.nome.trim() });
  if (input.ativo) filters.push({ field: 'ativo', op: '=', value: input.ativo });
  return filters;
}

function documentAttempts(value: string): string[] {
  const raw = value.trim();
  const numbers = digits(raw);
  const attempts = [raw];
  if (numbers.length === 11) attempts.push(formatCpf(numbers), numbers);
  if (numbers.length === 14) attempts.push(formatCnpj(numbers), numbers);
  return [...new Set(attempts)];
}

function replaceField(filters: FieldFilter[], from: string, to: string): FieldFilter[] {
  return filters.map((filter) => (filter.field === from ? { ...filter, field: to } : filter));
}

function replaceValue(filters: FieldFilter[], field: string, value: string): FieldFilter[] {
  return filters.map((filter) => (filter.field === field ? { ...filter, value } : filter));
}

async function cityName(deps: ToolDeps, id: string | undefined): Promise<string | undefined> {
  if (!id) return undefined;
  try {
    const result = await queryPage(deps, 'cidade', [{ field: 'id', op: '=', value: id }], 1, 1, 'id', 'asc');
    const row = result.rows[0];
    if (!row) return undefined;
    return [str(row, 'nome'), str(row, 'uf')].filter(Boolean).join('/');
  } catch {
    return undefined;
  }
}
