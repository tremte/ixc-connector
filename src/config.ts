import { readFileSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import { isProfile, type ProfileName } from './profiles.js';

export const SERVER_NAME = 'ixc-connector';
export const SERVER_VERSION = '1.0.0';

export interface Principal {
  name: string;
  profile: ProfileName;
  key: string;
}

export interface IxcSettings {
  mock: boolean;
  baseUrl?: string;
  token?: string;
  insecureTls: boolean;
  timeoutMs: number;
  maxRetries: number;
  retryBaseMs: number;
  maxPageSize: number;
  defaultPageSize: number;
  summaryMaxRecords: number;
  minIntervalMs: number;
  maxConcurrency: number;
  bodyFormat: 'json' | 'form';
}

export interface AppConfig {
  host: string;
  port: number;
  trustProxy: boolean;
  maskPii: boolean;
  timeZone: string;
  rateLimitPerMinute: number;
  ipRateLimitPerMinute: number;
  principals: Principal[];
  usingDemoKeys: boolean;
  ixc: IxcSettings;
}

const DEMO_KEYS: Principal[] = [
  { name: 'demo-infra', profile: 'infraestrutura', key: 'demo-infra-chave-somente-mock' },
  { name: 'demo-financeiro', profile: 'financeiro', key: 'demo-financeiro-chave-somente-mock' },
  { name: 'demo-vendas', profile: 'vendas', key: 'demo-vendas-chave-somente-mock' },
  { name: 'demo-juridico', profile: 'juridico', key: 'demo-juridico-chave-somente-mock' },
  { name: 'demo-admin', profile: 'admin', key: 'demo-admin-chave-somente-mock' },
];

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const mock = boolEnv(env, 'IXC_MOCK', false);
  const maxPageSize = intEnv(env, 'IXC_MAX_PAGE_SIZE', 50, 1, 200);
  const defaultPageSize = intEnv(env, 'IXC_DEFAULT_PAGE_SIZE', 20, 1, maxPageSize);
  const timeZone = env.BUSINESS_TIMEZONE?.trim() || 'America/Sao_Paulo';
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());
  } catch {
    throw new Error('BUSINESS_TIMEZONE inválido.');
  }

  let principals: Principal[] = [];
  let usingDemoKeys = false;
  const file = env.MCP_KEYS_FILE?.trim();
  const rawKeys = env.MCP_KEYS?.trim();
  if (file) {
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      throw new Error(`Não foi possível ler MCP_KEYS_FILE (${file}).`);
    }
    principals = parseKeys(text);
  } else if (rawKeys) {
    principals = parseKeys(rawKeys);
  } else if (mock) {
    principals = DEMO_KEYS;
    usingDemoKeys = true;
  } else {
    throw new Error('Defina MCP_KEYS ou MCP_KEYS_FILE com as chaves de cada setor.');
  }

  const ixc: IxcSettings = {
    mock,
    insecureTls: boolEnv(env, 'IXC_INSECURE_TLS', false),
    timeoutMs: intEnv(env, 'IXC_TIMEOUT_MS', 15_000, 1000, 120_000),
    maxRetries: intEnv(env, 'IXC_MAX_RETRIES', 2, 0, 5),
    retryBaseMs: intEnv(env, 'IXC_RETRY_BASE_MS', 200, 0, 10_000),
    maxPageSize,
    defaultPageSize,
    summaryMaxRecords: intEnv(env, 'IXC_SUMMARY_MAX_RECORDS', 500, 20, 5000),
    minIntervalMs: intEnv(env, 'IXC_MIN_INTERVAL_MS', 50, 0, 5000),
    maxConcurrency: intEnv(env, 'IXC_MAX_CONCURRENCY', 4, 1, 32),
    bodyFormat: bodyFormatEnv(env.IXC_BODY_FORMAT),
  };

  if (!mock) {
    const baseUrl = env.IXC_BASE_URL?.trim();
    const token = env.IXC_TOKEN?.trim();
    if (!baseUrl) throw new Error('IXC_BASE_URL é obrigatório quando IXC_MOCK não está ativo.');
    if (!token) throw new Error('IXC_TOKEN é obrigatório quando IXC_MOCK não está ativo.');
    if (!/^[^:\s]+:[^:\s]+$/.test(token)) {
      throw new Error('IXC_TOKEN deve estar no formato id_do_usuario:token, sem espaços.');
    }
    ixc.baseUrl = baseUrl;
    ixc.token = token;
  }

  return {
    host: env.HOST?.trim() || '0.0.0.0',
    port: intEnv(env, 'PORT', 3000, 1, 65535),
    trustProxy: boolEnv(env, 'TRUST_PROXY', false),
    maskPii: boolEnv(env, 'MASK_PII', true),
    timeZone,
    rateLimitPerMinute: intEnv(env, 'RATE_LIMIT_PER_MINUTE', 60, 1, 10_000),
    ipRateLimitPerMinute: intEnv(env, 'IP_RATE_LIMIT_PER_MINUTE', 600, 1, 100_000),
    principals,
    usingDemoKeys,
    ixc,
  };
}

export function authenticate(authorization: string | undefined, principals: Principal[]): Principal | undefined {
  if (!authorization) return undefined;
  const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
  if (!match) return undefined;
  const presented = match[1] ?? '';
  if (presented.length > 256) return undefined;
  let found: Principal | undefined;
  for (const principal of principals) {
    if (safeEqual(presented, principal.key)) found = principal;
  }
  return found;
}

export function maskForProfile(maskPii: boolean, profile: ProfileName): boolean {
  return maskPii && profile !== 'admin';
}

function parseKeys(text: string): Principal[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('MCP_KEYS não é um JSON válido.');
  }
  const list = Array.isArray(parsed) ? parsed : isRecord(parsed) ? parsed.keys : undefined;
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error('MCP_KEYS deve ser uma lista de chaves ou um objeto {"keys":[...]}.' );
  }
  const principals: Principal[] = [];
  const names = new Set<string>();
  const keys = new Set<string>();
  for (const item of list) {
    if (!isRecord(item)) throw new Error('Cada entrada de MCP_KEYS precisa de name, profile e key.');
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    const profile = typeof item.profile === 'string' ? item.profile.trim() : '';
    const key = typeof item.key === 'string' ? item.key.trim() : '';
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(name)) {
      throw new Error('Nome de chave inválido. Use letras, números, _ ou -.');
    }
    if (!isProfile(profile)) {
      throw new Error(`Perfil desconhecido: ${profile}.`);
    }
    if (key.length < 16 || /\s/.test(key)) {
      throw new Error(`A chave do perfil ${name} precisa ter ao menos 16 caracteres e não pode ter espaço.`);
    }
    if (names.has(name) || keys.has(key)) throw new Error('Nomes e chaves de API precisam ser únicos.');
    names.add(name);
    keys.add(key);
    principals.push({ name, profile, key });
  }
  return principals;
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function intEnv(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name];
  if (raw == null || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} deve ser um inteiro entre ${min} e ${max}.`);
  }
  return value;
}

function bodyFormatEnv(raw: string | undefined): 'json' | 'form' {
  const value = raw?.trim().toLowerCase() || 'json';
  if (value === 'json' || value === 'form') return value;
  throw new Error('IXC_BODY_FORMAT deve ser json ou form.');
}

function boolEnv(env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
  const raw = env[name];
  if (raw == null || raw.trim() === '') return fallback;
  const value = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'sim'].includes(value)) return true;
  if (['0', 'false', 'no', 'nao', 'não'].includes(value)) return false;
  throw new Error(`${name} deve ser true ou false.`);
}
