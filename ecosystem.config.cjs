module.exports = {
  apps: [
    {
      name: 'claude-anthropic-proxy',
      script: 'src/server.js',
      interpreter: 'node',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        HOST: '0.0.0.0',
        PORT: '8080',
      },
    },
  ],
};
