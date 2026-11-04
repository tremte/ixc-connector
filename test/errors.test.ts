import { describe, expect, it, vi } from 'vitest';
import { ReadOnlyIxcClient } from '../src/ixc/client.js';
import { IxcError } from '../src/ixc/errors.js';
import { buildListBody } from '../src/ixc/query.js';
import type { ListBody } from '../src/ixc/types.js';

const token = '7:token-super-secreto';
const body: ListBody = buildListBody('cliente', { filters: [{ field: 'id', op: '=', value: '1' }], page: 1, rp: 5 });

function api(fetchImpl: (url: string, init: unknown) => Promise<Response>, overrides: { maxRetries?: number; sleep?: (ms: number) => Promise<void>; insecureTls?: boolean } = {}) {
  return new ReadOnlyIxcClient({
    baseUrl: 'https://ixc.example',
    token,
    maxRetries: overrides.maxRetries ?? 2,
    retryBaseMs: 25,
    minIntervalMs: 0,
    insecureTls: overrides.insecureTls,
    sleep: overrides.sleep ?? (async () => undefined),
    fetchImpl: fetchImpl as never,
  });
}

describe('erros e retentativas', () => {
  it('repete 5xx e esgota sem devolver o token', async () => {
    const fetchImpl = vi.fn(async () => new Response('falha', { status: 503 }));
    const sleeps: number[] = [];
    const client = api(fetchImpl, { sleep: async (ms) => { sleeps.push(ms); } });
    await expect(client.list('cliente', body)).rejects.toThrow(/HTTP 503/);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([25, 50]);
    try {
      await client.list('cliente', body);
    } catch (error) {
      expect(String(error)).not.toContain(token);
      expect(String(error)).not.toContain('Basic');
    }
  });

  it('não repete erro 4xx', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ type: 'error', message: 'Você não tem permissão para acessar o recurso cliente' }, { status: 400 }));
    const client = api(fetchImpl, { maxRetries: 2 });
    await expect(client.list('cliente', body)).rejects.toThrow(/permissão/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('trata corpo de erro com HTTP 200 e tempo esgotado como retry', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ type: 'error', message: 'Recurso cliente não está disponível!' }));
    await expect(api(fetchImpl, { maxRetries: 3 }).list('cliente', body)).rejects.toBeInstanceOf(IxcError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    let calls = 0;
    const flaky = vi.fn(async () => {
      calls += 1;
      if (calls < 3) {
        const error = new Error('aborted');
        error.name = 'TimeoutError';
        throw error;
      }
      return Response.json({ total: '1', registros: [{ id: '1', senha: 'vazou', razao: 'Maria' }] });
    });
    const page = await api(flaky).list('cliente', body);
    expect(page.registros?.[0]).toEqual({ id: '1', razao: 'Maria' });
    expect(JSON.stringify(page)).not.toContain('vazou');
    expect(flaky).toHaveBeenCalledTimes(3);
  });

  it('usa dispatcher inseguro só quando pedido', async () => {
    const seen: unknown[] = [];
    const fetchImpl = vi.fn(async (_url: string, init: { dispatcher?: unknown }) => {
      seen.push(init.dispatcher);
      return Response.json({ total: '0', registros: [] });
    });
    await api(fetchImpl as never, { insecureTls: false }).list('cliente', body);
    await api(fetchImpl as never, { insecureTls: true }).list('cliente', body);
    expect(seen[0]).toBeUndefined();
    expect(seen[1]).toBeDefined();
  });
});
