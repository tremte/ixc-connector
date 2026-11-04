import { describe, expect, it } from 'vitest';
import { sanitizeAuditParams } from '../src/audit/log.js';
import { buscarClientes, obterCliente } from '../src/domain/clientes.js';
import { listarLogins } from '../src/domain/logins.js';
import type { ToolDeps } from '../src/domain/support.js';
import { todayIso } from '../src/domain/support.js';
import { MockIxcClient } from '../src/ixc/mock.js';
import { maskDocument, maskPhone, maskValue } from '../src/privacy/mask.js';

function deps(maskPii: boolean): ToolDeps {
  return {
    reader: new MockIxcClient(todayIso('America/Sao_Paulo')),
    profile: maskPii ? 'financeiro' : 'admin',
    keyName: maskPii ? 'financeiro' : 'admin',
    maskPii,
    pageSize: 20,
    pageSizeMax: 50,
    summaryMaxRecords: 100,
    timeZone: 'America/Sao_Paulo',
  };
}

describe('máscara LGPD', () => {
  it('mascara CPF, CNPJ e telefone', () => {
    expect(maskDocument('123.456.789-09')).toBe('***.***.***-09');
    expect(maskDocument('12345678909')).toBe('***.***.***-09');
    expect(maskDocument('12.345.678/0001-90')).toBe('**.345.***/****-90');
    expect(maskPhone('(47) 98888-7777')).toBe('*******7777');
    expect(maskValue({ cnpj_cpf: '123.456.789-09', telefone_celular: '47988887777', id: '10' }, true)).toEqual({
      cnpj_cpf: '***.***.***-09',
      telefone_celular: '*******7777',
      id: '10',
    });
    expect(maskValue({ cnpj_cpf: '123.456.789-09' }, false)).toEqual({ cnpj_cpf: '123.456.789-09' });
  });

  it('mascara a saída de perfil não admin e preserva a do admin', async () => {
    const masked = await obterCliente(deps(true), '10');
    const open = await obterCliente(deps(false), '10');
    expect(masked.text).toContain('***.***.***-09');
    expect(masked.text).not.toContain('123.456.789-09');
    expect(masked.text).toContain('7777');
    expect(masked.text).not.toContain('98888-7777');
    expect(open.text).toContain('123.456.789-09');
    expect(open.text).toContain('(47) 98888-7777');
  });

  it('nunca devolve senha de login e mascara documentos no log', async () => {
    const result = await listarLogins(deps(false), { cliente_id: '10' });
    expect(result.text).toContain('maria.silva');
    expect(result.text).toContain('online');
    expect(result.text.toLowerCase()).not.toContain('senha');
    expect(result.text).not.toContain('nao-deve-aparecer');
    const found = await buscarClientes(deps(false), { cpf_cnpj: '12345678909' });
    expect(found.text).toContain('Maria Silva');
    const audit = sanitizeAuditParams({ cpf_cnpj: '123.456.789-09', senha: 'x', nome: 'Maria' });
    expect(JSON.stringify(audit)).not.toContain('123.456.789-09');
    expect(JSON.stringify(audit)).not.toContain('senha');
    expect(JSON.stringify(audit)).toContain('Maria');
  });
});
