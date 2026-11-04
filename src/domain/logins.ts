import type { FieldFilter } from '../ixc/types.js';
import { join, label, pageText, queryPage, requireOne, resolvePage, str, yn, type ToolDeps, type ToolText } from './support.js';

const AUTH: Record<string, string> = {
  L: 'PPPoE',
  H: 'Hotspot',
  M: 'IP x MAC',
  V: 'VLAN',
  D: 'IPoE',
  I: 'Integração',
  E: 'Externa',
};

export interface ListarLoginsInput {
  cliente_id?: string;
  contrato_id?: string;
  login?: string;
  online?: boolean;
  ativo?: 'S' | 'N';
  pagina?: number;
  limite?: number;
}

export async function listarLogins(deps: ToolDeps, input: ListarLoginsInput): Promise<ToolText> {
  requireOne(
    [input.cliente_id, input.contrato_id, input.login],
    'Informe cliente_id, contrato_id ou login.',
  );
  const filters: FieldFilter[] = [];
  if (input.cliente_id) filters.push({ field: 'id_cliente', op: '=', value: input.cliente_id });
  if (input.contrato_id) filters.push({ field: 'id_contrato', op: '=', value: input.contrato_id });
  if (input.login) filters.push({ field: 'login', op: 'L', value: input.login.trim() });
  if (input.online === true) filters.push({ field: 'online', op: '=', value: 'S' });
  if (input.online === false) filters.push({ field: 'online', op: '=', value: 'N' });
  if (input.ativo) filters.push({ field: 'ativo', op: '=', value: input.ativo });
  const { page, rp } = resolvePage(input.pagina, input.limite, deps);
  const result = await queryPage(deps, 'radusuarios', filters, page, rp, 'id', 'asc');
  const lines = result.rows.map((row) =>
    join([
      `id=${str(row, 'id')}`,
      `login=${str(row, 'login')}`,
      `cliente=${str(row, 'id_cliente')}`,
      `contrato=${str(row, 'id_contrato')}`,
      online(str(row, 'online')),
      `ativo=${yn(str(row, 'ativo')) ?? '-'}`,
      str(row, 'ip') ? `ip=${str(row, 'ip')}` : undefined,
      str(row, 'mac') ? `mac=${str(row, 'mac')}` : undefined,
      `auth=${label(AUTH, str(row, 'autenticacao')) ?? '-'}`,
      str(row, 'ultima_conexao_inicial') ? `última=${str(row, 'ultima_conexao_inicial')}` : undefined,
    ]),
  );
  return {
    count: result.rows.length,
    text: pageText('Logins', result.rows.length, result.total, page, rp, lines),
  };
}

function online(code: string | undefined): string {
  if (code === 'S') return 'situação=online';
  if (code === 'N') return 'situação=offline';
  if (!code) return 'situação=-';
  return `situação=não mapeada (${code})`;
}
