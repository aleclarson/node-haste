'use strict';

const fp = require('./fastpath');

class Package {

  constructor({ file, fastfs, moduleCache, cache }) {
    this.path = file;
    this.root = fp.dirname(this.path);
    this._fastfs = fastfs;
    this.type = 'Package';
    this._moduleCache = moduleCache;
    this._cache = cache;
  }

  getMain() {
    return this.read().then(json => {
      const replacements = getReplacements(json);

      let main = json.main;
      if (typeof replacements === 'string') {
        main = replacements;
      }

      let ext;
      if (main) {
        ext = fp.extname(main) || '.js';
        main = main.replace(/^\.\//, ''); // Remove leading dot-slash
        main = main.replace(/(\.js|\.json)$/, ''); // Remove trailing extension
      } else {
        ext = '.js';
        main = 'index';
      }

      if (replacements && typeof replacements === 'object') {
        main = replacements[main] ||
          replacements[main + ext] ||
          main;
      }

      if (ext) {
        main += ext;
      }

      return fp.join(this.root, main);
    });
  }

  isHaste() {
    return this._cache.get(this.path, 'package-haste', () =>
      this.read().then(json => !!json.name)
    );
  }

  getName() {
    return this._cache.get(this.path, 'package-name', () =>
      this.read().then(json => json.name)
    );
  }

  _processFileChange() {
    this._cache.invalidate(this.path);
    this._moduleCache.removePackage(this.path);
  }

  redirectRequire(moduleName, resolveFilePath) {

    if (moduleName[0] === '.') {
      throw new Error('Relative paths are not supported!');
    }

    return this.read().then(json => {
      const replacements = getReplacements(json);
      if (!replacements || typeof replacements !== 'object') {
        return moduleName;
      }

      // Returns undefined if no replacement exists.
      const redirect = (modulePath) => {
        const replacement = replacements[modulePath];

        // Support disabling modules.
        if (replacement === false) { return null }

        if (typeof replacement !== 'string') { return }

        if (fp.isAbsolute(replacement)) {
          throw Error(`Redirections cannot use absolute paths: '${replacement}'`);
        }

        // Always return an absolute path!
        return fp.join(this.root, replacement);
      }

      // The unique key used in the "browser"
      // or "react-native" field in the 'package.json'!
      let modulePath = moduleName;

      // Make absolute paths relative to the 'package.json'!
      if (fp.isAbsolute(moduleName)) {
        modulePath = './' + fp.relative(this.root, moduleName);
      }

      let replacement = redirect(modulePath);
      if (replacement !== undefined) {
        return replacement;
      }

      // This hook can be used to try to resolve
      // a relative path using different extensions.
      if (typeof resolveFilePath === 'function') {
        replacement = resolveFilePath(modulePath, redirect);
        if (replacement !== undefined) {
          return replacement;
        }
      }

      // No replacement found.
      return moduleName;
    });
  }

  read() {
    if (!this._reading) {
      this._reading = this._fastfs.readFile(this.path)
        .then(jsonStr => JSON.parse(jsonStr));
    }

    return this._reading;
  }
}

function getReplacements(pkg) {
  let rn = pkg['react-native'];
  let browser = pkg.browser;
  if (rn == null) {
    return browser;
  }

  if (browser == null) {
    return rn;
  }

  if (typeof rn === 'string') {
    rn = { [pkg.main]: rn };
  }

  if (typeof browser === 'string') {
    browser = { [pkg.main]: browser };
  }

  // merge with "browser" as default,
  // "react-native" as override
  return { ...browser, ...rn };
}

module.exports = Package;
