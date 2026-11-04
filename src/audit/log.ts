import { maskValue } from '../privacy/mask.js';
import { stripSecrets } from '../ixc/sanitize.js';

export interface AuditEvent {
  ts: string;
  level: 'audit';
  profile: string;
  keyName: string;
  tool: string;
  params: unknown;
  resultCount: number;
  durationMs: number;
  ok: boolean;
  error?: string;
}

export type AuditWriter = (line: string) => void;

export function sanitizeAuditParams(params: unknown): unknown {
  return maskValue(stripSecrets(params), true);
}

export function writeAudit(event: AuditEvent, write: AuditWriter = (line) => console.log(line)): void {
  write(JSON.stringify(event));
}
