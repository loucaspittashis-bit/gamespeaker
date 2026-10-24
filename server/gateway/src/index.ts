import { loadConfig } from './config.ts';
import { createGateway } from './server.ts';

const config = loadConfig();
const gateway = createGateway(config);

gateway.server.listen(config.port, config.host, () => {
  console.log(new Date().toISOString(), `gateway listening on http://${config.host}:${config.port}`);
});

let closing = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (closing) return;
    closing = true;
    gateway.close().then(() => process.exit(0));
  });
}
