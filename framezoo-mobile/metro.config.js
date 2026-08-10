const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const path = require('node:path');
const fs = require('node:fs');

const packageJson = require('./package.json');
const platformAwarePackages = new Set([
  'react-native-safe-area-context',
  'react-native-screens',
]);
const packageNames = [
  ...Object.keys(packageJson.dependencies ?? {}),
  ...Object.keys(packageJson.devDependencies ?? {}),
];
const packageEntryPoints = Object.fromEntries(
  packageNames.flatMap((packageName) => {
    try {
      return [
        [
          packageName,
          require.resolve(packageName, {
            paths: [__dirname],
          }),
        ],
      ];
    } catch {
      return [];
    }
  }),
);
const packagePaths = Object.fromEntries(
  packageNames.flatMap((packageName) => {
    try {
      return [
        [
          packageName,
          path.dirname(
            require.resolve(`${packageName}/package.json`, {
              paths: [__dirname],
            }),
          ),
        ],
      ];
    } catch {
      return [];
    }
  }),
);
const babelRuntimePath = packagePaths['@babel/runtime'];

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  watchFolders: [path.resolve(__dirname, '../node_modules')],
    resolver: {
    unstable_enableSymlinks: true,
    nodeModulesPaths: [
      path.resolve(__dirname, 'node_modules'),
      path.resolve(__dirname, '../node_modules'),
    ],
    extraNodeModules: {
      ...packagePaths,
    },
    resolveRequest(context, moduleName, platform) {
      const prefix = '@babel/runtime/';
      if (platformAwarePackages.has(moduleName)) {
        return context.resolveRequest(context, moduleName, platform);
      }
      if (packageEntryPoints[moduleName]) {
        return { type: 'sourceFile', filePath: packageEntryPoints[moduleName] };
      }
      if (moduleName.startsWith(prefix) && babelRuntimePath) {
        const relativePath = moduleName.slice(prefix.length);
        const candidates = [
          path.join(babelRuntimePath, relativePath),
          path.join(babelRuntimePath, `${relativePath}.js`),
        ];
        const filePath = candidates.find((candidate) => fs.existsSync(candidate));
        if (filePath) {
          return { type: 'sourceFile', filePath };
        }
      }
      return context.resolveRequest(context, moduleName, platform);
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
