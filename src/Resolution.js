/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */
'use strict';

const NODE_PATHS = require('node-paths');

const PureObject = require('PureObject');
const Promise = require('Promise');
const Type = require('Type');
const assertType = require('assertType');
const assertTypes = require('assertTypes');
const emptyFunction = require('emptyFunction');
const fromArgs = require('fromArgs');
const fs = require('io/sync');
const inArray = require('in-array');
const path = require('path');
const util = require('util');

const Module = require('./Module');
const ResolutionCache = require('./ResolutionCache');
const fp = require('./fastpath');
const resolveFileExtension = require('./utils/resolveFileExtension');
const resolveFilePlatform = require('./utils/resolveFilePlatform');

const type = Type('Resolution')

type.defineArgs({
  module: Module.Kind.isRequired,
  cache: ResolutionCache.isRequired,
})

type.defineValues({

  _module: fromArgs(0),

  _cache: fromArgs(1),

  _moduleRequires: () => [],

  _modulePaths: () => [],

  _modulePromises: PureObject.create,

  _allResolved: null,
})

type.defineGetters({

  _moduleCache() {
    return this._module._moduleCache;
  },
})

type.defineMethods({

  allResolved(callback) {
    return (this._allResolved || Promise([])).then(callback);
  },

  eachResolved(iterator) {
    assertType(iterator, Function, 'iterator');
    return Promise.chain(this._modulePromises, (modulePromise, path) => {
      return modulePromise.then(module => iterator(module, path));
    });
  },

  filterResolved(iterator) {
    assertType(iterator, Function, 'iterator');
    const results = [];
    return Promise.chain(this._modulePromises, (modulePromise, path) => {
      return modulePromise
        .then(module => iterator(module, path))
        .then(result => result === false || results.push(result));
    })
    .then(() => results);
  },

  reloadRequires(options) {
    assertTypes(options, {
      force: Boolean.Maybe,
      recursive: Boolean.Maybe,
      onError: Function.Maybe,
      onProgress: Function.Maybe,
    })
    const needsResolving = this._cache.markResolving(this);
    if (!needsResolving) {
      return this._allResolved;
    }
    return this._module.readDependencies(this._cache.transformOptions)
    .then(moduleRequires => {
      if (!options.force && moduleRequires === this._moduleRequires) {
        return this._allResolved;
      }
      return this._resolveRequires(moduleRequires, options.onError)
      .then(moduleDeps => {
        return Promise.chain(moduleDeps, (moduleDep) => {
          if (!moduleDep) {
            return;
          }
          this._cache.addDepender(moduleDep, this._module);

          // Only recursively update if the dependency is a new module.
          if (options.recursive && !this._cache.hasResolution(moduleDep)) {
            return this._cache
              .getResolution(moduleDep)
              .reloadRequires(options);
          }
        })
        .then(() => moduleDeps);
      });
    })
    .then(moduleDeps => {
      options.onProgress && options.onProgress(moduleDeps, this);
      this._cache.markResolved(this);
      return moduleDeps;
    });
  },

  markDirty(modulePath) {
    assertType(modulePath, String);
    return this._allResolved.then(() => {
      const index = this._modulePaths.indexOf(modulePath);
      if (index !== -1) {
        this._modulePaths[index] = null;
        const requiredPath = this._moduleRequires[index];
        this._markDirty(requiredPath);
      }
    });
  },

  unload() {
    this._cache.clearDependers(this._module);
    this._cache.deleteResolution(this);
  },

  _markDirty(requiredPath) {
    const modulePromise = this._modulePromises[requiredPath];
    if (modulePromise) {
      modulePromise.isAborted = true;
      delete this._modulePromises[requiredPath];
      this._cache.markDirty(this);
    }
  },

  _resolveRequires(moduleRequires, onError) {
    assertType(moduleRequires, Array, 'moduleRequires');
    assertType(onError, Function.Maybe, 'onError');

    // Remove any promises associated with removed paths.
    const modulePromises = this._modulePromises;
    this._moduleRequires.forEach((requiredPath, index) => {
      if (!inArray(moduleRequires, requiredPath)) {
        const modulePromise = modulePromises[requiredPath];
        if (modulePromise) {
          modulePromise.then(module =>
            this._cache.deleteDepender(module, this._module));
          delete modulePromises[requiredPath];
        }
      }
    });

    this._moduleRequires = moduleRequires;
    this._modulePaths = [];

    const moduleDeps = [];
    const modulePaths = this._modulePaths;
    return this._allResolved = Promise.chain(moduleRequires, (requiredPath, index) => {
      let modulePromise = modulePromises[requiredPath];
      if (!modulePromise) {
        modulePromise = this._resolveModule(requiredPath);
        onError && modulePromise.fail(error => {
          onError(error, {
            requiredPath,
            fromModule: this._module,
            resolution: this,
          })
        });
      }
      modulePromise = modulePromise.then(dependency => {
        if (!modulePromise.isAborted) {
          modulePaths[index] = dependency.path;
        }
        moduleDeps.push(dependency);
        return dependency;
      })
      .fail(error => {
        if (error.type === 'UnableToResolveError') {
          this._markDirty(requiredPath);
        }
      });
      return modulePromises[requiredPath] = modulePromise;
    })
    .then(() => moduleDeps);
  },

  _resolveModule(requiredPath) {

    return this._redirectRequire(requiredPath)
    .then(redirectedPath => {

      if (typeof redirectedPath !== 'string') {
        return this._moduleCache.getNullModule(requiredPath);
      }
      requiredPath = redirectedPath;

      return this._resolveAssetModule(requiredPath)

      .fail(error =>
        ignoreResolveErrors(error) &&
        this._resolveHasteModule(requiredPath)

        .fail(error =>
          ignoreResolveErrors(error) &&
          this._resolveLotusModule(requiredPath)

          .fail(error =>
            ignoreResolveErrors(error) &&
            this._resolveNodeModule(requiredPath))));
    });
  },

  _resolveAssetModule(requiredPath) {
    const {assetMap, platform} = this._cache;
    const assetPath = assetMap.resolve(requiredPath, platform);
    if (assetPath) {
      return Promise(this._moduleCache.getAssetModule(assetPath));
    }

    return Promise.reject(new UnableToResolveError());
  },

  _resolveHasteModule(requiredPath) {
    if (!isModuleName(requiredPath)) {
      return Promise.reject(new UnableToResolveError());
    }

    const {hasteMap, platform} = this._cache;
    const moduleName = normalizePath(requiredPath);

    let dep = hasteMap.getModule(moduleName, platform);
    if (dep && dep.type === 'Module') {
      return Promise(dep);
    }

    // Find the package of a path like 'fbjs/src/Module.js' or 'fbjs'.
    let packageName = moduleName;
    while (packageName && packageName !== '.') {
      dep = hasteMap.getModule(packageName, platform);
      if (dep && dep.type === 'Package') {
        break;
      }
      packageName = fp.dirname(packageName);
    }

    if (dep && dep.type === 'Package') {
      return Promise.try(() => {
        if (moduleName === packageName) {
          return this._loadAsDir(dep.root, moduleName);
        }
        const filePath = fp.join(
          dep.root,
          fp.relative(packageName, moduleName)
        );

        return Promise.try(() =>
          this._loadAsFile(filePath, moduleName))

        .fail(error =>
          ignoreResolveErrors(error) &&
          this._loadAsDir(filePath, moduleName));
      });
    }

    return Promise.reject(new UnableToResolveError());
  },

  _resolveLotusModule(requiredPath) {
    return this._resolveLotusFile(requiredPath)
    .then(filePath => {
      if (typeof filePath === 'string') {
        return this._moduleCache.getModule(filePath);
      }

      throw new UnableToResolveError();
    });
  },

  _resolveNodeModule(requiredPath) {

    if (!isModuleName(requiredPath)) {
      throw new UnableToResolveError();
    }

    // If a module from the Node.js standard library is imported,
    // default to a "null module" unless a polyfill exists.
    if (inArray(NODE_PATHS, requiredPath)) {
      return this._moduleCache.getNullModule(requiredPath);
    }

    // Search each 'node_modules' directory.
    return this._resolveInstalledModule(requiredPath);
  },

  _resolveInstalledModule(moduleName) {
    const searchQueue = [];
    const isNodeModulesDir = /node_modules$/g;

    let dirPath = fp.dirname(this._module.path);

    const moduleRoot = path.parse(this._module.path).root;
    while (dirPath !== moduleRoot) {
      // Never try 'node_modules/node_modules'
      if (isNodeModulesDir.test(dirPath)) {
        continue;
      }
      searchQueue.push(
        fp.join(dirPath, 'node_modules', moduleName)
      );
      dirPath = fp.dirname(dirPath);
    }

    if (this._extraNodeModules) {
      const parts = moduleName.split('/');
      const packageName = parts[0];
      if (this._extraNodeModules[packageName]) {
        parts[0] = this._extraNodeModules[packageName];
        searchQueue.push(fp.join.apply(path, parts));
      }
    }

    let promise = Promise.reject(new UnableToResolveError());

    searchQueue.forEach(filePath =>

      promise = promise.fail(error =>
        ignoreResolveErrors(error) &&
        this._loadAsFile(filePath, moduleName))

      .fail(error =>
        ignoreResolveErrors(error) &&
        this._loadAsDir(filePath, moduleName)));

    return promise;
  },

  _resolvePackageMain(dirPath) {
    const pkgPath = fp.join(dirPath, 'package.json');
    if (this._fileExists(pkgPath)) {
      return this._moduleCache.getPackage(pkgPath).getMain();
    }
    return Promise(fp.join(dirPath, 'index'));
  },

  _resolveFile(filePath, resolver) {
    const {platform, preferNativePlatform} = this._cache;
    return resolveFileExtension(
      filePath,
      this._cache.extensions,
      (filePath) => resolveFilePlatform(
        filePath,
        platform,
        preferNativePlatform,
        resolver
      )
    );
  },

  _resolveLotusFile: Promise.wrap(function(requiredPath) {

    // Convert relative paths to absolutes.
    const isRelative = requiredPath[0] === '.';
    if (isRelative) {
      requiredPath = this._toAbsolutePath(requiredPath);
    }

    // Prepend $LOTUS_PATH to any module names.
    else if (requiredPath[0] !== fp.sep) {
      requiredPath = fp.join(lotus.path, requiredPath);
    }

    if (fs.isDir(requiredPath)) {

      if (isRelative) {
        // Try coercing './MyClass' into './MyClass/index'
        const indexPath = this._resolveFile(
          requiredPath + '/index',
          (filePath) => lotus.resolve(filePath, this._module.path),
        );
        if (indexPath) {
          return indexPath;
        }
      }

      // Search for a 'package.json' and get its 'main' field.
      return this._resolvePackageMain(requiredPath)
      .then(mainPath =>
        this._resolveFile(
          mainPath,
          (filePath) => lotus.resolve(filePath, this._module.path),
        ));
    }

    // Try the module path as-is.
    return this._resolveFile(
      requiredPath,
      (filePath) => lotus.resolve(filePath, this._module.path),
    );
  }),

  _loadAsFile(filePath, toModule) {
    const result = this._resolveFile(filePath, (filePath) => {
      try {
        if (this._fileExists(filePath)) {
          return this._moduleCache.getModule(filePath);
        }
      } catch (error) {
        if (error.code !== 404) {
          throw error;
        }
      }
    });
    if (result != null) {
      return result;
    }
    throw new UnableToResolveError();
  },

  _loadAsDir(dirPath, toModule) {
    if (!this._dirExists(dirPath)) {
      throw new UnableToResolveError();
    }

    return this._resolvePackageMain(dirPath)
    .then(mainPath => this._loadAsFile(mainPath, toModule));
  },

  _fileExists(filePath) {
    const {fastfs} = this._cache;
    const root = fastfs._getRoot(filePath);
    if (root == null) {
      return false;
    }
    if (root.isLazy) {
      return fs.isFile(filePath);
    }
    return fastfs.fileExists(filePath);
  },

  _dirExists(filePath) {
    const {fastfs} = this._cache;
    const root = fastfs._getRoot(filePath);
    if (root == null) {
      return false;
    }
    if (root.isLazy) {
      return fs.isDir(filePath);
    }
    return fastfs.dirExists(filePath);
  },

  _toAbsolutePath(filePath) {
    return fp.resolve(
      fp.dirname(this._module.path),
      filePath
    );
  },

  _redirectRequire(requiredPath) {
    return Promise.try(() => {
      const pkg = this._module.getPackage();
      if (!pkg) {
        return requiredPath;
      }
      const absPath = this._toAbsolutePath(requiredPath);
      const resolver = this._resolveFile.bind(this);
      return pkg.redirectRequire(absPath, resolver)
        .then(redirectedPath =>
          redirectedPath === absPath ?
            requiredPath : redirectedPath);
    })
    .then(requiredPath => {
      const redirectedPath = this._moduleCache._redirect[requiredPath];
      if (redirectedPath === false) {
        return null;
      }
      return redirectedPath || requiredPath;
    });
  },
})

module.exports = type.build()

//
// Helpers
//

function isModuleName(filePath) {
  const firstChar = filePath[0];
  return firstChar !== '.' && firstChar !== fp.sep;
}

function ignoreResolveErrors(error) {
 if (error.type !== 'UnableToResolveError') {
   throw error;
 }
 return true;
}

function normalizePath(modulePath) {
 if (fp.sep === '/') {
   modulePath = fp.normalize(modulePath);
 } else if (fp.posix) {
   modulePath = fp.posix.normalize(modulePath);
 }

 return modulePath.replace(/\/$/, '');
}

function UnableToResolveError() {
 Error.call(this);
 Error.captureStackTrace(this, this.constructor);
 this.type = this.name = 'UnableToResolveError';
 this.message = 'Could not resolve dependency!'
}
util.inherits(UnableToResolveError, Error);
