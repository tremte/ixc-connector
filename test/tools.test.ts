import { describe, expect, it } from 'vitest';
import { listarMovimentacao } from '../src/domain/contratos.js';
import { listarContas, resumoInadimplencia } from '../src/domain/financeiro.js';
import { listarOrdens } from '../src/domain/ordens.js';
import { listarPlanos } from '../src/domain/planos.js';
import { listarTickets } from '../src/domain/tickets.js';
import { runTool, todayIso, type ToolDeps } from '../src/domain/support.js';
import { MockIxcClient } from '../src/ixc/mock.js';
import type { IxcReader, ListBody } from '../src/ixc/types.js';

function deps(extra: Partial<ToolDeps> = {}): ToolDeps {
  return {
    reader: new MockIxcClient(todayIso('America/Sao_Paulo')),
    profile: 'infraestrutura',
    keyName: 'infra',
    maskPii: true,
    pageSize: 20,
    pageSizeMax: 50,
    summaryMaxRecords: 100,
    timeZone: 'America/Sao_Paulo',
    ...extra,
  };
}

class RecordingReader implements IxcReader {
  bodies: ListBody[] = [];
  constructor(private readonly inner: IxcReader) {}
  async list(table: Parameters<IxcReader['list']>[0], body: ListBody) {
    this.bodies.push(body);
    return this.inner.list(table, body);
  }
}

describe('consultas de domínio', () => {
  it('pagina planos e avisa que há mais páginas', async () => {
    const reader = new RecordingReader(new MockIxcClient('2026-11-04'));
    const result = await listarPlanos(deps({ reader, pageSizeMax: 1 }), { ativo: 'todos', limite: 100, pagina: 1 });
    expect(result.count).toBe(1);
    expect(result.text).toContain('total 2');
    expect(result.text).toContain('Há mais páginas');
    expect(reader.bodies[0]?.rp).toBe('1');
  });

  it('separa contratos novos e cancelados no período', async () => {
    const novos = await listarMovimentacao(deps(), {
      tipo: 'novos',
      data_inicio: '2024-05-01',
      data_fim: '2024-05-31',
    });
    expect(novos.text).toContain('id=100');
    expect(novos.text).not.toContain('id=200');
    const cancelados = await listarMovimentacao(deps(), {
      tipo: 'cancelados',
      data_inicio: '2024-06-01',
      data_fim: '2024-06-30',
    });
    expect(cancelados.text).toContain('id=200');
    expect(cancelados.count).toBe(1);
  });

  it('filtra OS aberta por cidade e técnico e esconde a finalizada', async () => {
    const result = await listarOrdens(deps(), { cidade: 'Florianópolis', tecnico: 'João' });
    expect(result.text).toContain('id=900');
    expect(result.text).not.toContain('id=901');
    expect(result.text).toContain('aberta');
  });

  it('lista só atendimentos abertos por padrão', async () => {
    const result = await listarTickets(deps(), {});
    expect(result.text).toContain('id=300');
    expect(result.text).not.toContain('id=301');
  });

  it('resume a inadimplência e lista títulos vencidos do cliente', async () => {
    const summary = await resumoInadimplencia(deps(), undefined);
    expect(summary.text).toContain('149,90');
    expect(summary.text).toContain('Títulos no IXC: 2');
    const bills = await listarContas(deps(), { cliente_id: '10', situacao: 'vencidas' });
    expect(bills.text).toContain('id=700');
    expect(bills.text).not.toContain('id=701');
    expect(bills.text).not.toContain('pagamentos.example');
  });

  it('registra auditoria sem segredo e devolve erro de filtro', async () => {
    const lines: string[] = [];
    const output = await runTool(deps({ audit: (line) => lines.push(line) }), 'buscar_clientes', { cpf_cnpj: '123.456.789-09', token: 'abc' }, async () => {
      throw new Error('Informe nome, cpf_cnpj ou id.');
    });
    expect(output.isError).toBe(true);
    const event = JSON.parse(lines[0] ?? '{}') as { params: { cpf_cnpj?: string; token?: string }; ok: boolean };
    expect(event.ok).toBe(false);
    expect(event.params.cpf_cnpj).toBe('***.***.***-09');
    expect(event.params.token).toBeUndefined();
    expect(lines[0]).not.toContain('demo-');
  });
});
