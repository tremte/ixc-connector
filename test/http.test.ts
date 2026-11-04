import { afterEach, describe, expect, it, vi } from 'vitest';
import { groupsFor } from '../src/profiles.js';
import { toolNamesFor } from '../src/mcp/catalog.js';
import { loadConfig } from '../src/config.js';
import { listen, mockConfig, openSession, resultText, rpc } from './support.js';

const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  vi.restoreAllMocks();
  while (closers.length) await closers.pop()?.();
});

describe('HTTP, autenticação e perfis', () => {
  it('exige chave, responde health e não vaza token', async () => {
    const runtime = await listen(mockConfig());
    closers.push(runtime.close);
    const health = await fetch(`${runtime.url}/health`);
    expect(await health.json()).toEqual({ status: 'ok', mode: 'mock' });
    const denied = await rpc(runtime.url, undefined, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    expect(denied.status).toBe(401);
    expect(denied.text).not.toContain('infra-chave');
    const wrong = await rpc(runtime.url, 'chave-que-nao-existe-123', { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    expect(wrong.status).toBe(401);
  });

  it('lista só as ferramentas do perfil e executa uma consulta mascarada', async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((line?: unknown) => {
      lines.push(String(line));
    });
    const runtime = await listen(mockConfig());
    closers.push(runtime.close);
    const key = 'financeiro-chave-de-teste';
    const session = await openSession(runtime.url, key);
    const listed = await rpc(runtime.url, key, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, session);
    expect(listed.status).toBe(200);
    const names = toolNames(listed.body);
    expect(names).toEqual(toolNamesFor(groupsFor('financeiro')));
    expect(names).not.toContain('listar_logins');
    expect(names).not.toContain('listar_ordens_servico');
    expect(names).toContain('resumo_inadimplencia');

    const blocked = await rpc(runtime.url, key, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'listar_logins', arguments: { cliente_id: '10' } },
    }, session);
    expect(JSON.stringify(blocked.body)).toMatch(/not found|desconhec|unknown/i);

    const call = await rpc(runtime.url, key, {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'obter_cliente', arguments: { id: '10' } },
    }, session);
    const text = resultText(call.body);
    expect(text).toContain('Maria Silva');
    expect(text).toContain('***.***.***-09');
    expect(text).not.toContain('123.456.789-09');
    const audit = lines.map((line) => line).join('\n');
    expect(audit).toContain('"tool":"obter_cliente"');
    expect(audit).toContain('"profile":"financeiro"');
    expect(audit).not.toContain(key);
    expect(audit).not.toContain('123.456.789-09');
    spy.mockRestore();
  });

  it('o admin vê todas as ferramentas e o documento sem máscara', async () => {
    const runtime = await listen(mockConfig());
    closers.push(runtime.close);
    const key = 'admin-chave-de-teste-12345';
    const session = await openSession(runtime.url, key);
    const listed = await rpc(runtime.url, key, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, session);
    expect(toolNames(listed.body)).toEqual(toolNamesFor(groupsFor('admin')));
    const call = await rpc(runtime.url, key, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'obter_cliente', arguments: { id: 10 } },
    }, session);
    expect(resultText(call.body)).toContain('123.456.789-09');
  });

  it('aplica o limite por chave', async () => {
    const runtime = await listen(mockConfig({ RATE_LIMIT_PER_MINUTE: '1' }));
    closers.push(runtime.close);
    const key = 'juridico-chave-de-teste-1';
    const first = await rpc(runtime.url, key, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 't', version: '1' } },
    });
    const second = await rpc(runtime.url, key, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
  });

  it('recusa subir sem IXC quando não está em mock', () => {
    expect(() => loadConfig({ MCP_KEYS: '[]' })).toThrow(/MCP_KEYS/);
    expect(() => loadConfig({
      IXC_MOCK: 'false',
      IXC_BASE_URL: 'https://ixc.example',
      IXC_TOKEN: 'sem-dois-pontos',
      MCP_KEYS: JSON.stringify([{ name: 'admin', profile: 'admin', key: 'admin-chave-de-teste-12345' }]),
    })).toThrow(/IXC_TOKEN/);
  });
});

function toolNames(body: unknown): string[] {
  const tools = (body as { result?: { tools?: Array<{ name: string }> } }).result?.tools ?? [];
  return tools.map((tool) => tool.name);
}
