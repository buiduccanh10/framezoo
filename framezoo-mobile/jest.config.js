const reactNativePreset = require('@react-native/jest-preset');

module.exports = {
  ...reactNativePreset,
  rootDir: '.',
  setupFiles: [],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
};
