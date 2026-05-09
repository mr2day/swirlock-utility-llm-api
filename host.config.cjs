// Shared, machine-agnostic defaults for this model host. Machine-specific
// values (which model is hosted, which Ollama URL, etc.) belong in
// `host.config.local.cjs`, which is gitignored. Local values override the
// defaults below. See `host.config.local.cjs.example` for the local template.

const fs = require('node:fs');
const path = require('node:path');

const defaults = {
  NODE_ENV: 'production',
  PORT: '3213',
  HOST: '0.0.0.0',
  OLLAMA_HOST: 'http://127.0.0.1:11434',
  OLLAMA_KEEP_ALIVE: '-1',
  PRELOAD_MODEL: 'true',
  MODEL_IMAGE_INPUT: 'true',
  MODEL_THINKING: 'false',
  JSON_BODY_LIMIT: '256mb',
};

const localPath = path.join(__dirname, 'host.config.local.cjs');
const localOverrides = fs.existsSync(localPath)
  ? require(localPath).env || {}
  : {};

module.exports = { env: { ...defaults, ...localOverrides } };
