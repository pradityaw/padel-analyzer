const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "..");

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(projectRoot);

// Rebuild when shared contracts change (avoid watching the entire monorepo tree).
config.watchFolders = [path.resolve(monorepoRoot, "shared")];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
];

// Fast Refresh is on by default; keep the dev server responsive on slower filesystems.
config.server = {
  ...config.server,
  enhanceMiddleware: (middleware) => middleware,
};

config.watcher = {
  ...config.watcher,
  healthCheck: {
    enabled: true,
    interval: 30000,
    timeout: 10000,
  },
};

module.exports = config;
