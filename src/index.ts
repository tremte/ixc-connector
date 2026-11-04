import { pathToFileURL } from 'node:url';
import { loadConfig } from './config.js';
import { createApp } from './http/app.js';

export async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig(process.env);
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', message: error instanceof Error ? error.message : 'configuração inválida' }));
    process.exit(1);
  }
  if (config.usingDemoKeys) {
    console.error(JSON.stringify({
      level: 'warn',
      message: 'Modo mock sem MCP_KEYS. Chaves de demonstração ativas. Não publique este modo.',
      chaves: config.principals.map((item) => ({ nome: item.name, perfil: item.profile, chave: item.key })),
    }));
  }
  const { app } = createApp(config);
  const server = app.listen(config.port, config.host, () => {
    console.error(JSON.stringify({
      level: 'info',
      message: 'ixc-connector escutando',
      host: config.host,
      port: config.port,
      mode: config.ixc.mock ? 'mock' : 'live',
    }));
  });
  const shutdown = () => {
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  void main();
}
