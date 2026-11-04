import { AsyncLocalStorage } from 'node:async_hooks';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import express, { type NextFunction, type Request, type Response } from 'express';
import { authenticate, type AppConfig, type Principal } from '../config.js';
import { ReadOnlyIxcClient } from '../ixc/client.js';
import { MockIxcClient } from '../ixc/mock.js';
import type { IxcReader } from '../ixc/types.js';
import { createMcpServer } from '../mcp/register.js';
import { SlidingWindowLimiter } from '../ratelimit/limiter.js';
import { todayIso } from '../domain/support.js';

const principals = new AsyncLocalStorage<Principal>();

export interface AppRuntime {
  app: express.Express;
  reader: IxcReader;
}

export function createApp(config: AppConfig): AppRuntime {
  const reader = createReader(config);
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', mode: config.ixc.mock ? 'mock' : 'live' });
  });
  app.get('/', (_req, res) => {
    res.json({ service: 'ixc-connector', mcp: '/mcp', health: '/health' });
  });

  const ipLimiter = new SlidingWindowLimiter(config.ipRateLimitPerMinute);
  const keyLimiter = new SlidingWindowLimiter(config.rateLimitPerMinute);
  const handler = toNodeHandler(
    createMcpHandler((ctx) => {
      const principal = principals.getStore() ?? principalFromAuth(ctx.authInfo, config);
      if (!principal) {
        throw new Error('Requisição MCP sem perfil autenticado.');
      }
      return createMcpServer(config, reader, principal);
    }),
  );

  const mcp = async (req: Request, res: Response): Promise<void> => {
    if (!ipLimiter.tryAcquire(clientIp(req))) {
      res.set('Retry-After', '60');
      res.status(429).json({ error: 'Limite de requisições do conector excedido.' });
      return;
    }
    const principal = authenticate(req.header('authorization'), config.principals);
    if (!principal) {
      res.status(401).json({
        error: 'Credencial ausente ou inválida. Envie Authorization: Bearer <chave do setor>.',
      });
      return;
    }
    if (!keyLimiter.tryAcquire(principal.name)) {
      res.set('Retry-After', '60');
      res.status(429).json({ error: 'Limite de requisições do setor excedido.' });
      return;
    }
    await principals.run(principal, () => handler(req, res, req.body));
  };

  app.post('/mcp', (req, res, next) => {
    mcp(req, res).catch(next);
  });
  app.get('/mcp', (req, res, next) => {
    mcp(req, res).catch(next);
  });
  app.delete('/mcp', (req, res, next) => {
    mcp(req, res).catch(next);
  });

  app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    const message = error instanceof Error ? error.message : 'erro interno';
    console.error(JSON.stringify({ level: 'error', message }));
    res.status(500).json({ error: 'Erro interno.' });
  });

  return { app, reader };
}

function createReader(config: AppConfig): IxcReader {
  if (config.ixc.mock) return new MockIxcClient(todayIso(config.timeZone));
  return new ReadOnlyIxcClient({
    baseUrl: config.ixc.baseUrl ?? '',
    token: config.ixc.token ?? '',
    insecureTls: config.ixc.insecureTls,
    timeoutMs: config.ixc.timeoutMs,
    maxRetries: config.ixc.maxRetries,
    retryBaseMs: config.ixc.retryBaseMs,
    maxPageSize: config.ixc.maxPageSize,
    minIntervalMs: config.ixc.minIntervalMs,
    maxConcurrency: config.ixc.maxConcurrency,
    bodyFormat: config.ixc.bodyFormat,
  });
}

function principalFromAuth(authInfo: { clientId?: string; token?: string } | undefined, config: AppConfig): Principal | undefined {
  if (!authInfo) return undefined;
  return config.principals.find((item) => item.name === authInfo.clientId || item.key === authInfo.token);
}

function clientIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
}
