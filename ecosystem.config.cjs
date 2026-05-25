const path = require("path");

const repoRoot = path.resolve(__dirname);

module.exports = {
  apps: [
    {
      name: "padel-api",
      script: "node",
      args: "scripts/pm2-api.mjs",
      cwd: repoRoot,
      interpreter: "none",
      env: {
        NODE_ENV: "development",
        PORT: "3001",
      },
      watch: false,
      autorestart: true,
      max_restarts: 50,
      min_uptime: "10s",
    },
    {
      name: "padel-expo",
      script: "node",
      args: "scripts/pm2-expo.mjs",
      cwd: repoRoot,
      interpreter: "none",
      env: {
        CI: "1",
        RCT_METRO_PORT: "8081",
        EXPO_PUBLIC_API_PORT: "3001",
      },
      autorestart: true,
      max_restarts: 50,
      min_uptime: "10s",
    },
  ],
};
