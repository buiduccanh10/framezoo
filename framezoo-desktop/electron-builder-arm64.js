const pkg = require('./package.json')

module.exports = {
  ...pkg.build,
  nsis: {
    ...pkg.build.nsis,
    useZip: true,
  },
}
