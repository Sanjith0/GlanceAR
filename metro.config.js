const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const webDirectory = path.join(__dirname, 'src/web');
const webOverrides = new Map([
  [require.resolve('expo-router/build/qualified-entry'), 'qualified-entry.web.tsx'],
  [require.resolve('expo-router/build/global-state/browserHistoryAdapter'), 'browserHistoryAdapter.web.ts'],
  [require.resolve('expo-router/build/link/useLinkToPathProps'), 'useLinkToPathProps.web.ts'],
  [require.resolve('expo-router/build/react-navigation/native/useLinkBuilder'), 'useLinkBuilder.web.ts'],
]);

// Only web is adapted. Imports made by the adapters themselves deliberately
// resolve to Expo's originals, preserving its history queue and click handling.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolved = context.resolveRequest(context, moduleName, platform);
  if (platform !== 'web' || context.originModulePath.startsWith(webDirectory + path.sep)) {
    return resolved;
  }
  const replacement = resolved.type === 'sourceFile' && webOverrides.get(resolved.filePath);
  return replacement
    ? { type: 'sourceFile', filePath: path.join(webDirectory, replacement) }
    : resolved;
};

module.exports = config;
