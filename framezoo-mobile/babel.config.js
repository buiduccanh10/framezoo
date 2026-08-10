const INLINE_ENV_KEYS = new Set(['FRAMEZOO_BACKEND_URL', 'VITE_BACKEND_URL']);

function inlineFrameZooEnvironment({ types }) {
  return {
    name: 'inline-framezoo-environment',
    visitor: {
      MemberExpression(path) {
        if (path.node.computed || !path.get('object').isMemberExpression()) {
          return;
        }

        const object = path.get('object');
        if (
          !object.get('object').isIdentifier({ name: 'process' }) ||
          !object.get('property').isIdentifier({ name: 'env' }) ||
          !path.get('property').isIdentifier()
        ) {
          return;
        }

        const key = path.node.property.name;
        if (!INLINE_ENV_KEYS.has(key)) return;

        const value = process.env[key];
        path.replaceWith(
          value === undefined
            ? types.unaryExpression('void', types.numericLiteral(0))
            : types.stringLiteral(value),
        );
      },
    },
  };
}

module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    inlineFrameZooEnvironment,
    [
      'module-resolver',
      {
        alias: {
          '@': './src',
        },
        extensions: ['.ios.ts', '.android.ts', '.ts', '.tsx', '.js', '.jsx', '.json'],
      },
    ],
  ],
};
