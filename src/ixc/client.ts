import { Agent, fetch as undiciFetch, type RequestInit as UndiciRequestInit } from 'undici';
import { IxcError, ReadOnlyViolation } from './errors.js';
import { assertListBody } from './query.js';
import { finalizePage } from './sanitize.js';
import { assertAllowedTable, type AllowedTable, type IxcPage, type IxcReader, type ListBody } from './types.js';
import { Semaphore } from '../ratelimit/limiter.js';

/**
 * Listagem no IXC Provedor: POST com o header `ixcsoft: listar`.
 * Os exemplos oficiais em curl, Postman e Python da wiki de formulários usam POST.
 * O snippet Node da mesma página e o guia de Franquias mostram GET com corpo;
 * este cliente segue o curl oficial e não implementa outro verbo.
 */
export const IXC_LIST_METHOD = 'POST' as const;
export const IXC_LIST_HEADER = 'listar' as const;

export function assertReadOnlyMethod(method: string): void {
  if (method !== IXC_LIST_METHOD) {
    throw new ReadOnlyViolation(
      `Operação bloqueada (${method}). Este conector só lista registros no IXC.`,
    );
  }
}

export interface ReadOnlyIxcOptions {
  baseUrl: string;
  token: string;
  insecureTls?: boolean;
  timeoutMs?: number;
  maxRetries?: number;
  retryBaseMs?: number;
  maxPageSize?: number;
  minIntervalMs?: number;
  maxConcurrency?: number;
  /** `json` segue o curl oficial. `form` segue a coleção Postman, que envia os campos como formulário. */
  bodyFormat?: 'json' | 'form';
  fetchImpl?: (url: string, init: UndiciRequestInit) => Promise<Response>;
  sleep?: (ms: number) => Promise<void>;
}

export class ReadOnlyIxcClient implements IxcReader {
  private readonly baseUrl: string;
  private readonly authorization: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryBaseMs: number;
  private readonly maxPageSize: number;
  private readonly minIntervalMs: number;
  private readonly dispatcher?: Agent;
  private readonly fetchImpl: (url: string, init: UndiciRequestInit) => Promise<Response>;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly semaphore: Semaphore;
  private readonly bodyFormat: 'json' | 'form';
  private lastCallAt = 0;

  constructor(options: ReadOnlyIxcOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.authorization = `Basic ${Buffer.from(options.token, 'utf8').toString('base64')}`;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.maxRetries = options.maxRetries ?? 2;
    this.retryBaseMs = options.retryBaseMs ?? 200;
    this.maxPageSize = options.maxPageSize ?? 50;
    this.minIntervalMs = options.minIntervalMs ?? 0;
    this.fetchImpl = options.fetchImpl ?? ((url, init) => undiciFetch(url, init) as Promise<Response>);
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.semaphore = new Semaphore(options.maxConcurrency ?? 4);
    this.bodyFormat = options.bodyFormat ?? 'json';
    if (options.insecureTls) {
      this.dispatcher = new Agent({ connect: { rejectUnauthorized: false } });
    }
  }

  async list(table: AllowedTable, body: ListBody): Promise<IxcPage> {
    assertAllowedTable(table);
    assertListBody(table, body);
    assertReadOnlyMethod(IXC_LIST_METHOD);
    const wire: ListBody = {
      ...body,
      page: String(Math.max(1, Number(body.page) || 1)),
      rp: String(Math.min(this.maxPageSize, Math.max(1, Number(body.rp) || 1))),
    };
    return this.withSlot(() => this.withRetry(table, wire));
  }

  private async withSlot<T>(fn: () => Promise<T>): Promise<T> {
    await this.semaphore.acquire();
    try {
      await this.pace();
      return await fn();
    } finally {
      this.semaphore.release();
    }
  }

  private async pace(): Promise<void> {
    if (this.minIntervalMs <= 0) return;
    const wait = this.minIntervalMs - (Date.now() - this.lastCallAt);
    if (wait > 0) await this.sleep(wait);
    this.lastCallAt = Date.now();
  }

  private async withRetry(table: AllowedTable, body: ListBody): Promise<IxcPage> {
    let last: IxcError | undefined;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        return await this.once(table, body);
      } catch (error) {
        if (!(error instanceof IxcError) || !error.retryable || attempt === this.maxRetries) throw error;
        last = error;
        await this.sleep(this.retryBaseMs * 2 ** attempt);
      }
    }
    throw last ?? new IxcError('Falha ao consultar o IXC.');
  }

  private async once(table: AllowedTable, body: ListBody): Promise<IxcPage> {
    const url = `${this.baseUrl}/webservice/v1/${encodeURIComponent(table)}`;
    const payload = this.bodyFormat === 'form' ? formBody(body) : JSON.stringify(body);
    const init: UndiciRequestInit = {
      method: IXC_LIST_METHOD,
      headers: {
        authorization: this.authorization,
        'content-type': this.bodyFormat === 'form' ? 'application/x-www-form-urlencoded' : 'application/json',
        accept: 'application/json',
        ixcsoft: IXC_LIST_HEADER,
      },
      body: payload,
      signal: AbortSignal.timeout(this.timeoutMs),
      dispatcher: this.dispatcher,
    };
    let response: Response;
    try {
      response = await this.fetchImpl(url, init);
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
      throw new IxcError(timedOut ? 'Tempo esgotado ao consultar o IXC.' : 'Falha de rede ao consultar o IXC.', {
        retryable: true,
      });
    }
    const text = await response.text();
    if (response.status >= 500 || response.status === 429) {
      throw new IxcError(`IXC respondeu HTTP ${response.status}.`, {
        retryable: true,
        status: response.status,
      });
    }
    if (!response.ok) {
      throw new IxcError(httpErrorMessage(response.status, text), { status: response.status });
    }
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      throw new IxcError('IXC devolveu uma resposta que não é JSON.');
    }
    if (!parsed || typeof parsed !== 'object') {
      throw new IxcError('IXC devolveu uma resposta inesperada.');
    }
    const page = parsed as IxcPage;
    if (page.type === 'error') {
      throw new IxcError(page.message || 'O IXC recusou a consulta.');
    }
    return finalizePage(page);
  }
}

function formBody(body: ListBody): string {
  const params = new URLSearchParams();
  params.set('qtype', body.qtype);
  params.set('query', body.query);
  params.set('oper', body.oper);
  params.set('page', body.page);
  params.set('rp', body.rp);
  params.set('sortname', body.sortname);
  params.set('sortorder', body.sortorder);
  if (body.grid_param) params.set('grid_param', body.grid_param);
  return params.toString();
}

function httpErrorMessage(status: number, text: string): string {
  const fromBody = readIxcMessage(text);
  if (status === 401 || status === 403) {
    return 'IXC recusou a autenticação. Verifique o token e se o IP deste servidor está liberado no grupo do usuário.';
  }
  if (fromBody) return `IXC: ${fromBody}`;
  return `IXC respondeu HTTP ${status}.`;
}

function readIxcMessage(text: string): string | undefined {
  try {
    const parsed = JSON.parse(text) as { message?: unknown; msg?: unknown };
    const message = parsed.message ?? parsed.msg;
    if (typeof message === 'string' && message.trim()) return message.trim().slice(0, 300);
  } catch {
    return undefined;
  }
  return undefined;
}

export function normalizeBaseUrl(url: string): string {
  let value = url.trim().replace(/\/+$/, '');
  value = value.replace(/\/webservice\/v1$/i, '');
  if (!/^https?:\/\/.+/i.test(value)) {
    throw new Error('IXC_BASE_URL deve ser uma URL http(s) do IXC, sem caminho de tabela.');
  }
  return value;
}
