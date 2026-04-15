// PM2 ecosystem config for the DCO render worker
// Usage: pm2 start ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: "dco-worker",
      script: "src/index.ts",
      interpreter: "node_modules/.bin/tsx",
      cwd: __dirname,
      instances: 1, // One AE instance per worker
      autorestart: true,
      watch: false,
      max_restarts: 10,
      restart_delay: 5000,
      env: {
        NODE_ENV: "production",
        REDIS_URL: "redis://localhost:6379",
        API_URL: "http://localhost:3000",
        WORKER_API_KEY: "worker-secret",
        STORAGE_PROVIDER: "local",
        STORAGE_ROOT: "./storage",
      },
    },
  ],
};
