import type { ToolGroup } from '../profiles.js';

export interface ToolSpec {
  name: string;
  group: ToolGroup;
}

export const TOOLS: ToolSpec[] = [
  { name: 'buscar_clientes', group: 'clientes' },
  { name: 'obter_cliente', group: 'clientes' },
  { name: 'listar_contratos', group: 'contratos' },
  { name: 'obter_contrato', group: 'contratos' },
  { name: 'listar_movimentacao_contratos', group: 'contratos' },
  { name: 'listar_logins', group: 'logins' },
  { name: 'listar_ordens_servico', group: 'os' },
  { name: 'obter_ordem_servico', group: 'os' },
  { name: 'listar_tickets', group: 'tickets' },
  { name: 'obter_ticket', group: 'tickets' },
  { name: 'listar_contas_receber', group: 'financeiro' },
  { name: 'resumo_inadimplencia', group: 'financeiro' },
  { name: 'listar_planos', group: 'planos' },
  { name: 'obter_plano', group: 'planos' },
];

export function toolNamesFor(groups: readonly ToolGroup[]): string[] {
  const allowed = new Set(groups);
  return TOOLS.filter((tool) => allowed.has(tool.group)).map((tool) => tool.name);
}
