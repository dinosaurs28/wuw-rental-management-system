const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Suppress: "Unknown option watcher.unstable_workerThreads"
// Root metro-config (0.83.7) doesn't recognize this option, but @expo/metro's
// nested metro-config (0.83.3) injects it. Cosmetic warning only — strip it.
if (config.watcher && "unstable_workerThreads" in config.watcher) {
  delete config.watcher.unstable_workerThreads;
}

module.exports = config;
