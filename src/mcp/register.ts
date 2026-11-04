import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { SERVER_NAME, SERVER_VERSION, maskForProfile, type AppConfig, type Principal } from '../config.js';
import { buscarClientes, obterCliente } from '../domain/clientes.js';
import { listarContratos, listarMovimentacao, obterContrato } from '../domain/contratos.js';
import { listarContas, resumoInadimplencia } from '../domain/financeiro.js';
import { listarLogins } from '../domain/logins.js';
import { listarOrdens, obterOrdem } from '../domain/ordens.js';
import { listarPlanos, obterPlano } from '../domain/planos.js';
import { runTool, type ToolDeps } from '../domain/support.js';
import { listarTickets, obterTicket } from '../domain/tickets.js';
import type { IxcReader } from '../ixc/types.js';
import { PROFILE_LABEL, groupsFor } from '../profiles.js';
import { toolNamesFor } from './catalog.js';

const READONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };

const pagina = z.number().int().min(1).optional().describe('Página, começando em 1.');
const limite = z.number().int().min(1).max(200).optional().describe('Itens nesta página. O servidor ainda aplica o máximo configurado.');
const id = z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative()]).transform((value) => String(value));
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use AAAA-MM-DD.');

export function createMcpServer(config: AppConfig, reader: IxcReader, principal: Principal): McpServer {
  const deps: ToolDeps = {
    reader,
    profile: principal.profile,
    keyName: principal.name,
    maskPii: maskForProfile(config.maskPii, principal.profile),
    pageSize: config.ixc.defaultPageSize,
    pageSizeMax: config.ixc.maxPageSize,
    summaryMaxRecords: config.ixc.summaryMaxRecords,
    timeZone: config.timeZone,
  };
  const allowed = new Set(toolNamesFor(groupsFor(principal.profile)));
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions: [
        `Conector somente leitura do IXC Provedor para o setor ${PROFILE_LABEL[principal.profile]}.`,
        'Não cria, altera nem apaga registros.',
        deps.maskPii ? 'CPF, CNPJ e telefones voltam mascarados.' : 'Este perfil vê CPF, CNPJ e telefones sem máscara.',
        'Filtros de data usam AAAA-MM-DD. Não percorra a base sem filtro.',
      ].join(' '),
    },
  );

  const use = (
    name: string,
    description: string,
    inputSchema: z.ZodType,
    handler: (args: any) => Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }>,
  ): void => {
    if (!allowed.has(name)) return;
    server.registerTool(
      name,
      { description, inputSchema, annotations: READONLY },
      handler as (args: unknown) => Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }>,
    );
  };

  use(
    'buscar_clientes',
    'Busca clientes por nome (razão social; se a página vier vazia, tenta o nome fantasia), CPF/CNPJ ou id. Exige ao menos um desses filtros.',
    z.object({
      nome: z.string().min(3).optional().describe('Trecho do nome ou razão social.'),
      cpf_cnpj: z.string().min(3).optional().describe('CPF ou CNPJ, com ou sem pontuação.'),
      id: id.optional().describe('Id do cliente.'),
      ativo: z.enum(['S', 'N']).optional().describe('S ativo, N inativo.'),
      pagina,
      limite,
    }),
    async (args) => runTool(deps, 'buscar_clientes', args, () => buscarClientes(deps, args)),
  );

  use(
    'obter_cliente',
    'Detalha um cliente pelo id, com endereço e telefones.',
    z.object({ id: id.describe('Id do cliente.') }),
    async (args) => runTool(deps, 'obter_cliente', args, () => obterCliente(deps, args.id)),
  );

  use(
    'listar_contratos',
    'Lista contratos do cliente. status: P pré-contrato, A ativo, I inativo, N negativado, D desistiu. status_internet: A ativo, D desativado, CM bloqueio manual, CA bloqueio automático, FA financeiro em atraso, AA aguardando assinatura.',
    z.object({
      cliente_id: id.optional().describe('Id do cliente.'),
      status: z.string().optional().describe('Status do contrato (código ou nome).'),
      status_internet: z.string().optional().describe('Status da internet do contrato.'),
      pagina,
      limite,
    }),
    async (args) => runTool(deps, 'listar_contratos', args, () => listarContratos(deps, args)),
  );

  use(
    'obter_contrato',
    'Detalha um contrato pelo id.',
    z.object({ id: id.describe('Id do contrato.') }),
    async (args) => runTool(deps, 'obter_contrato', args, () => obterContrato(deps, args.id)),
  );

  use(
    'listar_movimentacao_contratos',
    'Lista contratos ativados (data_ativacao) ou cancelados (data_cancelamento) num intervalo de no máximo 366 dias.',
    z.object({
      tipo: z.enum(['novos', 'cancelados']).describe('novos usa a data de ativação; cancelados usa a data de cancelamento.'),
      data_inicio: data.describe('Início AAAA-MM-DD.'),
      data_fim: data.describe('Fim AAAA-MM-DD.'),
      cliente_id: id.optional().describe('Opcional: restringe a um cliente.'),
      pagina,
      limite,
    }),
    async (args) => runTool(deps, 'listar_movimentacao_contratos', args, () => listarMovimentacao(deps, args)),
  );

  use(
    'listar_logins',
    'Lista logins de conexão (radusuarios), em geral PPPoE, de um cliente ou contrato. online true/false filtra S/N. Senhas não são retornadas. Códigos diferentes de S/N aparecem como não mapeados.',
    z.object({
      cliente_id: id.optional(),
      contrato_id: id.optional(),
      login: z.string().min(2).optional().describe('Trecho do login.'),
      online: z.boolean().optional().describe('true = online (S), false = offline (N).'),
      ativo: z.enum(['S', 'N']).optional(),
      pagina,
      limite,
    }),
    async (args) => runTool(deps, 'listar_logins', args, () => listarLogins(deps, args)),
  );

  use(
    'listar_ordens_servico',
    'Lista ordens de serviço (su_oss_chamado). Padrão: abertas (status diferente de F). Status: A aberta, AN análise, EN encaminhada, AS assumida, AG agendada, DS deslocamento, EX execução, F finalizada, RAG aguardando agendamento. Técnico, assunto e cidade aceitam id ou nome.',
    z.object({
      status: z.string().optional().describe('abertas (padrão), finalizadas, todas ou um código.'),
      tecnico_id: id.optional(),
      tecnico: z.string().min(2).optional().describe('Nome do técnico (tabela funcionarios).'),
      assunto_id: id.optional(),
      assunto: z.string().min(2).optional().describe('Texto do assunto (su_oss_assunto).'),
      cidade_id: id.optional(),
      cidade: z.string().min(2).optional().describe('Nome da cidade.'),
      bairro: z.string().optional(),
      regiao: z.string().optional().describe('Trecho de regiao_manutencao.'),
      cliente_id: id.optional(),
      data_inicio: data.optional().describe('Abertura inicial AAAA-MM-DD.'),
      data_fim: data.optional().describe('Abertura final AAAA-MM-DD.'),
      pagina,
      limite,
    }),
    async (args) => runTool(deps, 'listar_ordens_servico', args, () => listarOrdens(deps, args)),
  );

  use(
    'obter_ordem_servico',
    'Detalha uma ordem de serviço pelo id.',
    z.object({ id: id.describe('Id da OS.') }),
    async (args) => runTool(deps, 'obter_ordem_servico', args, () => obterOrdem(deps, args.id)),
  );

  use(
    'listar_tickets',
    'Lista atendimentos (su_ticket). Padrão: abertos (su_status diferente de S e de C). Status: N novo, P pendente, EP em progresso, S solucionado, C cancelado.',
    z.object({
      status: z.string().optional().describe('abertos (padrão), solucionados, cancelados, todos ou um código.'),
      cliente_id: id.optional(),
      assunto_id: id.optional(),
      setor_id: id.optional().describe('Id do setor do atendimento (id_ticket_setor).'),
      pagina,
      limite,
    }),
    async (args) => runTool(deps, 'listar_tickets', args, () => listarTickets(deps, args)),
  );

  use(
    'obter_ticket',
    'Detalha um atendimento pelo id.',
    z.object({ id: id.describe('Id do atendimento.') }),
    async (args) => runTool(deps, 'obter_ticket', args, () => obterTicket(deps, args.id)),
  );

  use(
    'listar_contas_receber',
    'Lista contas a receber (fn_areceber). situacao abertas = status A, vencidas = A com vencimento anterior a hoje, recebidas = R, todas = sem filtro de status. Exige cliente, contrato ou intervalo de vencimento. incluir_parciais acrescenta status P.',
    z.object({
      cliente_id: id.optional(),
      contrato_id: id.optional(),
      situacao: z.enum(['abertas', 'vencidas', 'recebidas', 'todas']).optional(),
      incluir_parciais: z.boolean().optional().describe('Inclui títulos com status P (parcial).'),
      data_inicio: data.optional(),
      data_fim: data.optional(),
      pagina,
      limite,
    }),
    async (args) => runTool(deps, 'listar_contas_receber', args, () => listarContas(deps, args)),
  );

  use(
    'resumo_inadimplencia',
    'Soma títulos vencidos ainda em aberto (status A e P) até ontem no fuso do provedor. Opcionalmente filtra um cliente. A soma respeita IXC_SUMMARY_MAX_RECORDS.',
    z.object({
      cliente_id: id.optional().describe('Se omitido, soma a carteira até o teto configurado.'),
    }),
    async (args) => runTool(deps, 'resumo_inadimplencia', args, () => resumoInadimplencia(deps, args.cliente_id)),
  );

  use(
    'listar_planos',
    'Lista planos de venda (vd_contratos). Padrão: somente ativos (campo Ativo = S).',
    z.object({
      nome: z.string().min(2).optional(),
      ativo: z.enum(['S', 'N', 'todos']).optional(),
      pagina,
      limite,
    }),
    async (args) => runTool(deps, 'listar_planos', args, () => listarPlanos(deps, args)),
  );

  use(
    'obter_plano',
    'Detalha um plano de venda pelo id.',
    z.object({ id: id.describe('Id do plano (vd_contratos).') }),
    async (args) => runTool(deps, 'obter_plano', args, () => obterPlano(deps, args.id)),
  );

  return server;
}
