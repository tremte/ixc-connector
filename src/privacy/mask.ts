const DOC_KEY = /(cpf|cnpj)/i;
const PHONE_KEY = /(fone|telefone|whatsapp|celular)/i;

export function maskDocument(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length === 11) return `***.***.***-${digits.slice(-2)}`;
  if (digits.length === 14) return `**.${digits.slice(2, 5)}.***/****-${digits.slice(-2)}`;
  if (digits.length <= 2) return '***';
  return `${'*'.repeat(digits.length - 2)}${digits.slice(-2)}`;
}

export function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length <= 4) return '****';
  return `${'*'.repeat(digits.length - 4)}${digits.slice(-4)}`;
}

export function maskValue<T>(value: T, enabled: boolean): T {
  if (!enabled) return value;
  return walk(value) as T;
}

function walk(value: unknown, key?: string): unknown {
  if (Array.isArray(value)) return value.map((item) => walk(item));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [childKey, child] of Object.entries(value as Record<string, unknown>)) {
      out[childKey] = walk(child, childKey);
    }
    return out;
  }
  if (typeof value === 'string' && key) {
    if (DOC_KEY.test(key)) return maskDocument(value);
    if (PHONE_KEY.test(key)) return maskPhone(value);
  }
  return value;
}
