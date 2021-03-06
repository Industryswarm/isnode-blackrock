const _ = require('../utils')._;

function formatParse(format) {
  format = format.split('-');
  let keyType = 'private';
  const keyOpt = {type: 'default'};

  for (let i = 1; i < format.length; i++) {
    if (format[i]) {
      switch (format[i]) {
        case 'public':
          keyType = format[i];
          break;
        case 'private':
          keyType = format[i];
          break;
        case 'pem':
          keyOpt.type = format[i];
          break;
        case 'der':
          keyOpt.type = format[i];
          break;
      }
    }
  }

  return {scheme: format[0], keyType: keyType, keyOpt: keyOpt};
}

module.exports = {
  pkcs1: require('./pkcs1'),
  pkcs8: require('./pkcs8'),
  components: require('./components'),

  isPrivateExport: function(format) {
    return module.exports[format] && typeof module.exports[format].privateExport === 'function';
  },

  isPrivateImport: function(format) {
    return module.exports[format] && typeof module.exports[format].privateImport === 'function';
  },

  isPublicExport: function(format) {
    return module.exports[format] && typeof module.exports[format].publicExport === 'function';
  },

  isPublicImport: function(format) {
    return module.exports[format] && typeof module.exports[format].publicImport === 'function';
  },

  detectAndImport: function(key, data, format) {
    if (format === undefined) {
      for (const scheme in module.exports) {
        if (typeof module.exports[scheme].autoImport === 'function' && module.exports[scheme].autoImport(key, data)) {
          return true;
        }
      }
    } else if (format) {
      const fmt = formatParse(format);

      if (module.exports[fmt.scheme]) {
        if (fmt.keyType === 'private') {
          module.exports[fmt.scheme].privateImport(key, data, fmt.keyOpt);
        } else {
          module.exports[fmt.scheme].publicImport(key, data, fmt.keyOpt);
        }
      } else {
        throw Error('Unsupported key format');
      }
    }

    return false;
  },

  detectAndExport: function(key, format) {
    if (format) {
      const fmt = formatParse(format);

      if (module.exports[fmt.scheme]) {
        if (fmt.keyType === 'private') {
          if (!key.isPrivate()) {
            throw Error('This is not private key');
          }
          return module.exports[fmt.scheme].privateExport(key, fmt.keyOpt);
        } else {
          if (!key.isPublic()) {
            throw Error('This is not public key');
          }
          return module.exports[fmt.scheme].publicExport(key, fmt.keyOpt);
        }
      } else {
        throw Error('Unsupported key format');
      }
    }
  },
};
