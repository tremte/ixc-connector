const SECRET_KEY = /(senha|password|passwd|token|secret|authorization|cvv|cart[aã]o|gateway_link|api_key)/i;

export function stripSecrets<T>(value: T): T {
  return strip(value) as T;
}

function strip(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => strip(item));
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY.test(key)) continue;
    out[key] = strip(item);
  }
  return out;
}

export function finalizePage<T extends { registros?: Record<string, unknown>[] }>(page: T): T {
  return {
    ...page,
    registros: (page.registros ?? []).map((row) => stripSecrets(row)),
  };
}
