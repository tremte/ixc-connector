export const PROFILES = ['infraestrutura', 'financeiro', 'vendas', 'juridico', 'admin'] as const;

export type ProfileName = (typeof PROFILES)[number];

export const TOOL_GROUPS = [
  'clientes',
  'contratos',
  'logins',
  'os',
  'tickets',
  'financeiro',
  'planos',
] as const;

export type ToolGroup = (typeof TOOL_GROUPS)[number];

export const PROFILE_GROUPS: Record<ProfileName, readonly ToolGroup[]> = {
  infraestrutura: ['clientes', 'contratos', 'logins', 'os', 'tickets'],
  financeiro: ['clientes', 'contratos', 'financeiro'],
  vendas: ['clientes', 'contratos', 'planos'],
  juridico: ['clientes', 'contratos'],
  admin: TOOL_GROUPS,
};

export const PROFILE_LABEL: Record<ProfileName, string> = {
  infraestrutura: 'Infraestrutura',
  financeiro: 'Financeiro',
  vendas: 'Vendas e Marketing',
  juridico: 'Jurídico e Regulatório',
  admin: 'Administração',
};

export function isProfile(value: string): value is ProfileName {
  return (PROFILES as readonly string[]).includes(value);
}

export function groupsFor(profile: ProfileName): readonly ToolGroup[] {
  return PROFILE_GROUPS[profile];
}
