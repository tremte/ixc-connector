import { ReadOnlyViolation } from './errors.js';

export const ALLOWED_TABLES = [
  'cliente',
  'cliente_contrato',
  'radusuarios',
  'su_oss_chamado',
  'su_ticket',
  'fn_areceber',
  'vd_contratos',
  'su_oss_assunto',
  'cidade',
  'funcionarios',
] as const;

export type AllowedTable = (typeof ALLOWED_TABLES)[number];

export const OPERATORS = ['=', '!=', '>', '<', '>=', '<=', 'L', 'NL'] as const;

export type Oper = (typeof OPERATORS)[number];

export interface FieldFilter {
  field: string;
  op: Oper;
  value: string;
}

/** Corpo aceito pelo webservice na listagem. Só estes campos são enviados. */
export interface ListBody {
  qtype: string;
  query: string;
  oper: Oper;
  page: string;
  rp: string;
  sortname: string;
  sortorder: 'asc' | 'desc';
  grid_param?: string;
}

export interface IxcPage {
  page?: string | number;
  total?: string | number;
  registros?: Record<string, unknown>[];
  type?: string;
  message?: string;
}

export interface IxcReader {
  list(table: AllowedTable, body: ListBody): Promise<IxcPage>;
}

export function assertAllowedTable(table: string): asserts table is AllowedTable {
  if (!(ALLOWED_TABLES as readonly string[]).includes(table)) {
    throw new ReadOnlyViolation(`Tabela não permitida neste conector: ${table}`);
  }
}
