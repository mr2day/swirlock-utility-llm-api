import { createRequire } from 'node:module';

interface HostConfig {
  env: Record<string, string | number | boolean>;
}

const requireConfig = createRequire(__filename);
const hostConfig = requireConfig('../host.config.cjs') as HostConfig;

if (!isRecord(hostConfig.env)) {
  throw new Error('host.config.cjs must export an env object.');
}

for (const [name, value] of Object.entries(hostConfig.env)) {
  process.env[name] = String(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
