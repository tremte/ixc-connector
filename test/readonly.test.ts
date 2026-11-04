import { describe, expect, it, vi } from 'vitest';
import { IXC_LIST_HEADER, IXC_LIST_METHOD, ReadOnlyIxcClient, assertReadOnlyMethod } from '../src/ixc/client.js';
import { ReadOnlyViolation } from '../src/ixc/errors.js';
import { buildListBody } from '../src/ixc/query.js';
import type { ListBody } from '../src/ixc/types.js';

const token = '42:segredo-do-ixc-nao-logar';

function client(fetchImpl: ReadOnlyIxcClient extends never ? never : (url: string, init: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<Response>, maxPageSize = 50) {
  return new ReadOnlyIxcClient({
    baseUrl: 'https://ixc.example/webservice/v1/',
    token,
    maxPageSize,
    maxRetries: 0,
    minIntervalMs: 0,
    fetchImpl: fetchImpl as never,
  });
}

const baseBody = (): ListBody => buildListBody('cliente', {
  filters: [{ field: 'id', op: '=', value: '10' }],
  page: 1,
  rp: 20,
});

describe('cliente somente leitura', () => {
  it('só expõe listagem e recusa outros verbos', () => {
    const methods = Object.getOwnPropertyNames(ReadOnlyIxcClient.prototype);
    expect(methods).toContain('list');
    expect(methods).not.toContain('create');
    expect(methods).not.toContain('update');
    expect(methods).not.toContain('delete');
    expect(methods).not.toContain('post');
    expect(methods).not.toContain('put');
    expect(() => assertReadOnlyMethod('DELETE')).toThrow(ReadOnlyViolation);
    expect(() => assertReadOnlyMethod('PUT')).toThrow(ReadOnlyViolation);
    expect(() => assertReadOnlyMethod('GET')).toThrow(ReadOnlyViolation);
    expect(() => assertReadOnlyMethod(IXC_LIST_METHOD)).not.toThrow();
  });

  it('envia POST com header ixcsoft listar e corta a página', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ total: '0', registros: [] }));
    const api = client(fetchImpl, 5);
    await api.list('cliente', { ...baseBody(), rp: '999', page: '0' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, { method?: string; headers?: Record<string, string>; body?: string }];
    expect(url).toBe('https://ixc.example/webservice/v1/cliente');
    expect(init.method).toBe('POST');
    expect(init.headers?.ixcsoft).toBe(IXC_LIST_HEADER);
    expect(init.headers?.authorization?.startsWith('Basic ')).toBe(true);
    const sent = JSON.parse(init.body ?? '{}') as ListBody;
    expect(sent.rp).toBe('5');
    expect(sent.page).toBe('1');
    expect(sent.qtype).toBe('cliente.id');
    expect(Object.keys(sent).sort()).toEqual(['oper', 'page', 'qtype', 'query', 'rp', 'sortname', 'sortorder']);
  });

  it('pode enviar a listagem como formulário', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ total: '0', registros: [] }));
    const api = new ReadOnlyIxcClient({
      baseUrl: 'https://ixc.example',
      token,
      bodyFormat: 'form',
      maxRetries: 0,
      minIntervalMs: 0,
      fetchImpl: fetchImpl as never,
    });
    await api.list('cliente', baseBody());
    const init = fetchImpl.mock.calls[0]?.[1] as { headers?: Record<string, string>; body?: string };
    expect(init.headers?.['content-type']).toBe('application/x-www-form-urlencoded');
    expect(init.body).toContain('qtype=cliente.id');
    expect(init.headers?.ixcsoft).toBe(IXC_LIST_HEADER);
  });

  it('recusa tabela, campo e filtro fora da allowlist sem chamar a rede', async () => {
    const fetchImpl = vi.fn();
    const api = client(fetchImpl as never);
    await expect(api.list('cliente/1' as 'cliente', baseBody())).rejects.toBeInstanceOf(ReadOnlyViolation);
    await expect(api.list('cliente', {
      ...baseBody(),
      qtype: 'fn_areceber.id',
    })).rejects.toBeInstanceOf(ReadOnlyViolation);
    await expect(api.list('cliente', {
      ...baseBody(),
      grid_param: JSON.stringify([{ TB: 'fn_areceber.status', OP: '=', P: 'A' }]),
    })).rejects.toBeInstanceOf(ReadOnlyViolation);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('monta grid_param como texto JSON e não aceita operador de escrita', () => {
    const body = buildListBody('fn_areceber', {
      filters: [
        { field: 'id_cliente', op: '=', value: '10' },
        { field: 'status', op: '=', value: 'A' },
        { field: 'data_vencimento', op: '<', value: '2026-11-04' },
      ],
      page: 2,
      rp: 20,
      sortField: 'data_vencimento',
      sortOrder: 'asc',
    });
    expect(typeof body.grid_param).toBe('string');
    expect(JSON.parse(body.grid_param ?? '[]')).toEqual([
      { TB: 'fn_areceber.status', OP: '=', P: 'A' },
      { TB: 'fn_areceber.data_vencimento', OP: '<', P: '2026-11-04' },
    ]);
    expect(body.qtype).toBe('fn_areceber.id_cliente');
    expect(() => buildListBody('cliente', {
      filters: [{ field: 'id', op: 'LIKE' as '=', value: '1' }],
      page: 1,
      rp: 1,
    })).toThrow(ReadOnlyViolation);
  });
});
