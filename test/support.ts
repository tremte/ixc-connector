import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { loadConfig, type AppConfig } from '../src/config.js';
import { createApp } from '../src/http/app.js';

export function mockConfig(overrides: Record<string, string> = {}): AppConfig {
  return loadConfig({
    IXC_MOCK: 'true',
    IXC_MIN_INTERVAL_MS: '0',
    MCP_KEYS: JSON.stringify([
      { name: 'infra', profile: 'infraestrutura', key: 'infra-chave-de-teste-123' },
      { name: 'financeiro', profile: 'financeiro', key: 'financeiro-chave-de-teste' },
      { name: 'vendas', profile: 'vendas', key: 'vendas-chave-de-teste-123' },
      { name: 'juridico', profile: 'juridico', key: 'juridico-chave-de-teste-1' },
      { name: 'admin', profile: 'admin', key: 'admin-chave-de-teste-12345' },
    ]),
    ...overrides,
  });
}

export async function listen(config: AppConfig): Promise<{ url: string; close: () => Promise<void> }> {
  const { app } = createApp(config);
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

export interface RpcResult {
  status: number;
  body: unknown;
  text: string;
  sessionId?: string;
}

export async function rpc(url: string, key: string | undefined, message: unknown, sessionId?: string): Promise<RpcResult> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    'mcp-protocol-version': '2025-11-25',
  };
  if (key) headers.authorization = `Bearer ${key}`;
  if (sessionId) headers['mcp-session-id'] = sessionId;
  const response = await fetch(`${url}/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify(message),
  });
  const text = await response.text();
  return {
    status: response.status,
    text,
    body: parseRpc(text, response.headers.get('content-type') ?? ''),
    sessionId: response.headers.get('mcp-session-id') ?? undefined,
  };
}

export function parseRpc(text: string, contentType: string): unknown {
  if (!text.trim()) return undefined;
  if (contentType.includes('text/event-stream')) {
    const data = text
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .filter(Boolean)
      .pop();
    return data ? JSON.parse(data) : undefined;
  }
  return JSON.parse(text);
}

export async function openSession(url: string, key: string): Promise<string | undefined> {
  const init = await rpc(url, key, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'teste', version: '1.0.0' },
    },
  });
  if (init.status !== 200) {
    throw new Error(`initialize HTTP ${init.status}: ${init.text}`);
  }
  await rpc(url, key, { jsonrpc: '2.0', method: 'notifications/initialized' }, init.sessionId);
  return init.sessionId;
}

export function resultText(body: unknown): string {
  const result = (body as { result?: { content?: Array<{ text?: string }> } } | undefined)?.result;
  return result?.content?.map((block) => block.text ?? '').join('\n') ?? '';
}
