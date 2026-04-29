const { env } = require('./host.config.cjs');

module.exports = {
  apps: [
    {
      name: 'swirlock-llm-host',
      script: 'dist/main.js',
      instances: 1,
      autorestart: true,
      watch: false,
      env,
    },
  ],
};
