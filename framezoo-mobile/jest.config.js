const reactNativePreset = require('@react-native/jest-preset');

module.exports = {
  ...reactNativePreset,
  rootDir: '.',
  setupFiles: [],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@noble/hashes/pbkdf2\\.js$': '<rootDir>/tests/noble-hashes-pbkdf2.cjs',
    '^@noble/hashes/sha2\\.js$': '<rootDir>/tests/noble-hashes-sha2.cjs',
  },
};
