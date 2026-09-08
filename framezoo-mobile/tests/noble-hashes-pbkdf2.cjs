const crypto = require('node:crypto');

module.exports = {
  pbkdf2(_hash, password, salt, options) {
    return new Uint8Array(
      crypto.pbkdf2Sync(password, salt, options.c, options.dkLen, 'sha256'),
    );
  },
};
