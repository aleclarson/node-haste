/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */
'use strict';

const Cache = require('./Cache');
const Fastfs = require('./fastfs');
const LazyVar = require('LazyVar');
const PureObject = require('PureObject');
const Type = require('Type');
const assertType = require('assertType');
const fp = require('./fastpath');
const fromArgs = require('fromArgs');

const AssetModule = LazyVar(() => require('./AssetModule'));
const Module = LazyVar(() => require('./Module'));
const NullModule = LazyVar(() => require('./NullModule'));
const Package = LazyVar(() => require('./Package'));
const Polyfill = LazyVar(() => require('./Polyfill'));

const type = Type('ModuleCache')

type.defineOptions({
  cache: Cache.isRequired,
  fastfs: Fastfs.isRequired,
  platforms: Array,
  extractRequires: Function,
  transformCode: Function,
  assetDependencies: Array,
  moduleOptions: Object,
  extraNodeModules: Object,
  redirect: PureObject,
})

type.defineValues({

  _modules: PureObject.create,

  _packages: PureObject.create,

  _packageModuleMap: () => new WeakMap(),

  _cache: fromArgs('cache'),

  _fastfs: fromArgs('fastfs'),

  _platforms: fromArgs('platforms'),

  _extractRequires: fromArgs('extractRequires'),

  _transformCode: fromArgs('transformCode'),

  _assetDependencies: fromArgs('assetDependencies'),

  _moduleOptions: fromArgs('moduleOptions'),

  _extraNodeModules: fromArgs('extraNodeModules'),

  _redirect: (opts) => opts.redirect || Object.create(null),
})

type.initInstance(function({ fastfs }) {
  fastfs.on('change', this._processFileChange.bind(this));
})

type.defineMethods({

  getAllModules() {
    return this._modules;
  },

  getCachedModule(modulePath) {
    return this._modules[
      modulePath.toLowerCase()
    ];
  },

  getModule(modulePath) {
    return this._getModule(
      modulePath,
      this._modules,
      () => Module.call({
        file: modulePath,
        fastfs: this._fastfs,
        moduleCache: this,
        cache: this._cache,
        extractor: this._extractRequires,
        transformCode: this._transformCode,
        options: this._moduleOptions,
      })
    );
  },

  getNullModule(modulePath) {
    return this._getModule(
      modulePath,
      this._modules,
      () => NullModule.call({
        file: modulePath,
        fastfs: this._fastfs,
        moduleCache: this,
        cache: this._cache,
        extractor: this._extractRequires,
        transformCode: this._transformCode,
        options: this._moduleOptions,
      })
    );
  },

  getAssetModule(modulePath) {
    return this._getModule(
      modulePath,
      this._modules,
      () => AssetModule.call({
        file: modulePath,
        fastfs: this._fastfs,
        moduleCache: this,
        cache: this._cache,
        dependencies: this._assetDependencies,
        platforms: this._platforms,
      })
    );
  },

  getPackage(packagePath) {
    return this._getModule(
      packagePath,
      this._packages,
      () => Package.call({
        file: packagePath,
        fastfs: this._fastfs,
        moduleCache: this,
        cache: this._cache,
      })
    );
  },

  getPackageForModule(module) {
    if (this._packageModuleMap.has(module)) {
      const packagePath = this._packageModuleMap.get(module);
      if (this._packages[packagePath]) {
        return this._packages[packagePath];
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
  },

  createPolyfill({file}) {
    return Polyfill.call({
      file,
      cache: this._cache,
      fastfs: this._fastfs,
      moduleCache: this,
      transformCode: this._transformCode,
    });
  },

  removeModule(modulePath) {
    delete this._modules[
      modulePath.toLowerCase()
    ];
  },

  removePackage(packagePath) {
    delete this._packages[
      packagePath.toLowerCase()
    ];
  },

  _getModule(modulePath, moduleCache, createModule) {
    const hash = modulePath.toLowerCase();
    let module = moduleCache[hash];
    if (!module) {
      module = createModule();
      moduleCache[hash] = module;
    }
    return module;
  },

  _processFileChange(type, filePath, root) {
    const absPath = fp.join(root, filePath);
    const mod = this._modules[absPath];
    const pkg = this._packages[absPath];
    if (mod) {
      this._cache.invalidate(mod.path);
      if (type === 'delete') {
        this.removeModule(mod);
      }
    }
    if (pkg) {
      this._cache.invalidate(pkg.path);
      if (type === 'delete') {
        this.removePackage(pkg);
      }
    }
  },
})

module.exports = type.build()
