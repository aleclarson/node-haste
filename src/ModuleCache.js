'use strict';

const AssetModule = require('./AssetModule');
const Package = require('./Package');
const Module = require('./Module');
const Polyfill = require('./Polyfill');
const path = require('./fastpath');

class ModuleCache {

  constructor({
    fastfs,
    cache,
    extractRequires,
    transformCode,
    assetDependencies,
    moduleOptions,
  }, platforms) {
    this._moduleCache = Object.create(null);
    this._packageCache = Object.create(null);
    this._fastfs = fastfs;
    this._cache = cache;
    this._extractRequires = extractRequires;
    this._transformCode = transformCode;
    this._platforms = platforms;
    this._assetDependencies = assetDependencies;
    this._moduleOptions = moduleOptions;
    this._packageModuleMap = new WeakMap();

    fastfs.on('change', this._processFileChange.bind(this));
  }

  getCachedModule(filePath) {
    return this._moduleCache[
      filePath.toLowerCase()
    ];
  }

  getModule(filePath) {
    const hash = filePath.toLowerCase();
    if (!this._moduleCache[hash]) {
      this._moduleCache[hash] = new Module({
        file: filePath,
        fastfs: this._fastfs,
        moduleCache: this,
        cache: this._cache,
        extractor: this._extractRequires,
        transformCode: this._transformCode,
        options: this._moduleOptions,
      });
    }
    return this._moduleCache[hash];
  }

  getAllModules() {
    return this._moduleCache;
  }

  getAssetModule(filePath) {
    const hash = filePath.toLowerCase();
    if (!this._moduleCache[hash]) {
      this._moduleCache[hash] = new AssetModule({
        file: filePath,
        fastfs: this._fastfs,
        moduleCache: this,
        cache: this._cache,
        dependencies: this._assetDependencies,
      }, this._platforms);
    }
    return this._moduleCache[hash];
  }

  getPackage(filePath) {
    const hash = filePath.toLowerCase();
    if (!this._packageCache[hash]) {
      this._packageCache[hash] = new Package({
        file: filePath,
        fastfs: this._fastfs,
        moduleCache: this,
        cache: this._cache,
      });
    }
    return this._packageCache[hash];
  }

  getPackageForModule(module) {
    if (this._packageModuleMap.has(module)) {
      const packagePath = this._packageModuleMap.get(module);
      if (this._packageCache[packagePath]) {
        return this._packageCache[packagePath];
      } else {
        this._packageModuleMap.delete(module);
      }
    }

    const packagePath = this._fastfs.closest(module.path, 'package.json');
    if (!packagePath) {
      return null;
    }

    this._packageModuleMap.set(module, packagePath);
    return this.getPackage(packagePath);
  }

  createPolyfill({file}) {
    return new Polyfill({
      file,
      cache: this._cache,
      depGraphHelpers: this._depGraphHelpers,
      fastfs: this._fastfs,
      moduleCache: this,
      transformCode: this._transformCode,
    });
  }

  removeModule(filePath) {
    delete this._moduleCache[
      filePath.toLowerCase()
    ];
  }

  removePackage(filePath) {
    delete this._packageCache[
      filePath.toLowerCase()
    ];
  }

  _processFileChange(type, filePath, root) {
    const absPath = path.join(root, filePath);

    if (this._moduleCache[absPath]) {
      this._moduleCache[absPath]._processFileChange(type);
    }
    if (this._packageCache[absPath]) {
      this._packageCache[absPath]._processFileChange(type);
    }
  }
}

module.exports = ModuleCache;
