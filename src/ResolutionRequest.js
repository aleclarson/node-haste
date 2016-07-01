 /**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */
'use strict';

const debug = require('debug')('ReactNativePackager:DependencyGraph');

const inArray = require ('in-array');
const NODE_PATHS = require('node-paths');
const path = require('path');
const Promise = require('Promise');
const util = require('util');

const getAssetDataFromName = require('./utils/getAssetDataFromName');
const resolveFileExtension = require('./utils/resolveFileExtension');
const resolveFilePlatform = require('./utils/resolveFilePlatform');
const matchExtensions = require('./utils/matchExtensions');
const MapWithDefaults = require('./utils/MapWithDefaults');
const AsyncTaskGroup = require('./utils/AsyncTaskGroup');
const NullModule = require('./NullModule');
const Module = require('./Module');
const fp = require('./fastpath');

class ResolutionRequest {
  constructor({
    platform,
    platforms,
    preferNativePlatform,
    projectExts,
    assetExts,
    entryPath,
    fastfs,
    hasteMap,
    moduleCache,
    ignoreFilePath,
    shouldThrowOnUnresolvedErrors,
    extraNodeModules,
  }) {
    this._platform = platform;
    this._platforms = platforms;
    this._preferNativePlatform = preferNativePlatform;
    this._projectExts = projectExts;
    this._assetExts = assetExts;
    this._entryPath = entryPath;
    this._fastfs = fastfs;
    this._hasteMap = hasteMap;
    this._moduleCache = moduleCache;
    this._ignoreFilePath = ignoreFilePath;
    this._shouldThrowOnUnresolvedErrors = shouldThrowOnUnresolvedErrors;
    this._extraNodeModules = extraNodeModules;
  }

  resolveDependency(fromModule, toModuleName) {
    return this._resolveJSDependency(fromModule, toModuleName)
    .then(resolvedModule => {
      if (!resolvedModule || this._ignoreFilePath(resolvedModule.path)) {
        return null;
      }
      fromModule.setDependency(toModuleName, resolvedModule);
      return resolvedModule;
    })
    .fail(error => {
      log.moat(1);
      log.red('Failed to resolve: ');
      log.white(toModuleName);
      log.moat(0);
      log.gray('  fromModule = ');
      log.white(fp.relative(lotus.path, fromModule.path));
      log.moat(1);
      if (this._shouldThrowOnUnresolvedErrors(this._entryPath, this._platform)) {
        throw error;
      }
    });
  }

  getOrderedDependencies({
    response,
    mocksPattern,
    transformOptions,
    onProgress,
    recursive = true,
  }) {
    return this._getAllMocks(mocksPattern).then(allMocks => {
      const entry = this._moduleCache.getModule(this._entryPath);
      const mocks = Object.create(null);
      response.pushDependency(entry);
      let totalModules = 1;
      let finishedModules = 0;
      const resolveDependencies = module =>
        module.getDependencies(transformOptions)
          .then(dependencyNames =>
            Promise.all(
              dependencyNames.map(name => this.resolveDependency(module, name))
            ).then(dependencies => [dependencyNames, dependencies])
          );

      const addMockDependencies = !allMocks
        ? (module, result) => result
        : (module, [dependencyNames, dependencies]) => {
          const list = [module.getName()];
          const pkg = module.getPackage();
          if (pkg) {
            list.push(pkg.getName());
          }
          return Promise.all(list).then(names => {
            names.forEach(name => {
              if (allMocks[name] && !mocks[name]) {
                dependencyNames.push(name);
                dependencies.push(mockModule);
              }
            });
            return [dependencyNames, dependencies];
          });
        };

      const collectedDependencies = new MapWithDefaults(module => collect(module));
      const crawlDependencies = (mod, [depNames, dependencies]) => {
        const filteredPairs = [];

        dependencies.forEach((modDep, i) => {
          const name = depNames[i];
          if (modDep == null) {
            // It is possible to require mocks that don't have a real
            // module backing them. If a dependency cannot be found but there
            // exists a mock with the desired ID, resolve it and add it as
            // a dependency.
            if (allMocks && allMocks[name] && !mocks[name]) {
              const mockModule = this._moduleCache.getModule(allMocks[name]);
              mocks[name] = allMocks[name];
              return filteredPairs.push([name, mockModule]);
            }
            debug(
              'WARNING: Cannot find required module `%s` from module `%s`',
              name,
              mod.path
            );
            return false;
          }
          return filteredPairs.push([name, modDep]);
        });
        response.setResolvedDependencyPairs(mod, filteredPairs);

        const dependencyModules = filteredPairs.map(([, m]) => m);
        const newDependencies =
          dependencyModules.filter(m => !collectedDependencies.has(m));

        if (onProgress) {
          finishedModules += 1;
          totalModules += newDependencies.length;
          onProgress(finishedModules, totalModules);
        }

        if (recursive) {
          // doesn't block the return of this function invocation, but defers
          // the resulution of collectionsInProgress.done.then(…)
          dependencyModules
            .forEach(dependency => collectedDependencies.get(dependency));
        }
        return dependencyModules;
      };

      const collectionsInProgress = new AsyncTaskGroup();
      function collect(module) {
        log.cyan.dim('•');
        if (log.line.length == 50) {
          log.moat(0);
        }
        collectionsInProgress.start(module);
        const result = resolveDependencies(module)
          .then(result => addMockDependencies(module, result))
          .then(result => crawlDependencies(module, result));
        const end = () => collectionsInProgress.end(module);
        result.then(end, end);
        return result;
      }

      return Promise.all([
        // kicks off recursive dependency discovery, but doesn't block until it's done
        collectedDependencies.get(entry),

        // resolves when there are no more modules resolving dependencies
        collectionsInProgress.done,
      ]).then(([rootDependencies]) => {
        return Promise.all(
          Array.from(collectedDependencies, resolveKeyWithPromise)
        ).then(moduleToDependenciesPairs =>
          [rootDependencies, new MapWithDefaults(() => [], moduleToDependenciesPairs)]
        );
      }).then(([rootDependencies, moduleDependencies]) => {
        // serialize dependencies, and make sure that every single one is only
        // included once
        const seen = new Set([entry]);
        function traverse(dependencies) {
          dependencies.forEach(dependency => {
            if (seen.has(dependency)) { return; }

            seen.add(dependency);
            response.pushDependency(dependency);
            traverse(moduleDependencies.get(dependency));
          });
        }

        traverse(rootDependencies);
        response.setMocks(mocks);
      });
    });
  }

  _getAllMocks(pattern) {
    // Take all mocks in all the roots into account. This is necessary
    // because currently mocks are global: any module can be mocked by
    // any mock in the system.
    let mocks = null;
    if (pattern) {
      mocks = Object.create(null);
      this._fastfs.matchFilesByPattern(pattern).forEach(file =>
        mocks[fp.basename(file, fp.extname(file))] = file
      );
    }
    return Promise(mocks);
  }

  _resolveHasteDependency(fromModule, toModuleName) {
    toModuleName = normalizePath(toModuleName);
    if (!this._isModuleName(toModuleName)) {
      throw new UnableToResolveError(toModuleName);
    }

    let dep = this._hasteMap.getModule(toModuleName, this._platform);
    if (dep && dep.type === 'Module') {
      return dep;
    }

    // Find the package of a path like 'fbjs/src/Module.js' or 'fbjs'.
    let packageName = toModuleName;
    while (packageName && packageName !== '.') {
      dep = this._hasteMap.getModule(packageName, this._platform);
      if (dep && dep.type === 'Package') {
        break;
      }
      packageName = fp.dirname(packageName);
    }

    if (dep && dep.type === 'Package') {
      return Promise.try(() => {
        if (toModuleName === packageName) {
          return this._loadAsDir(dep.root, fromModule, toModuleName);
        }
        const filePath = fp.join(
          dep.root,
          fp.relative(packageName, toModuleName)
        );
        return tryResolve(
          () => this._loadAsFile(filePath, fromModule, toModuleName),
          () => this._loadAsDir(filePath, fromModule, toModuleName),
        );
      })
      .fail(error => {
        if (error.type !== 'UnableToResolveError') {
          throw error;
        }
        throw new UnableToResolveError(
          fromModule,
          toModuleName,
          'Unable to resolve dependency',
        );
      });
    }

    throw new UnableToResolveError(
      fromModule,
      toModuleName,
      'Unable to resolve dependency',
    );
  }

  _resolveJSDependency(fromModule, toModuleName) {
    return Promise.all([
      toModuleName,
      this._redirectRequire(fromModule, toModuleName)
    ])
    .then(([oldModuleName, toModuleName]) => {

      if (toModuleName === null) {
        return this._getNullModule(oldModuleName, fromModule);
      }

      if (process.config.redirect[toModuleName] !== undefined) {
        let oldModuleName = toModuleName;
        toModuleName = process.config.redirect[toModuleName];
        if (toModuleName === false) {
          return this._getNullModule(oldModuleName, fromModule);
        }
        toModuleName = process.config.resolve(toModuleName);
      }

      return tryResolve(
        () => this._resolveHasteDependency(fromModule, toModuleName),
        () => this._resolveNodeDependency(fromModule, toModuleName),
      );
    })
    .fail(error => {
      log.moat(1);
      log.gray.dim(error.stack);
      log.moat(1);
    })
  }

  _redirectRequire(fromModule, toModuleName) {
    const pkg = fromModule.getPackage();
    if (!pkg) {
      return Promise(toModuleName);
    }
    let absPath = toModuleName;
    if (toModuleName[0] === '.') {
      absPath = fp.resolve(
        fp.dirname(fromModule.path),
        toModuleName
      );
    }

    return pkg.redirectRequire(
      absPath,
      this._resolveFilePath.bind(this)
    )

    .then(redirect =>
      redirect === absPath ?
        toModuleName : redirect);
  }

  _resolveNodeDependency(fromModule, toModuleName) {

    return this._resolveLotusPath(
      fromModule,
      toModuleName,
    )

    .then(filePath => {

      if (filePath) {
        return this._moduleCache.getModule(filePath);
      }

      if (this._isModuleName(toModuleName)) {

        // If a module from the Node.js standard library is imported,
        // default to a "null module" unless a polyfill exists.
        if (inArray(NODE_PATHS, toModuleName)) {
          return this._getNullModule(
            toModuleName,
            fromModule,
          );
        }

        // Search each 'node_modules' directory.
        return this._findInstalledModule(
          fromModule,
          toModuleName,
        );
      }

      throw new UnableToResolveError(toModuleName);
    });
  }

  _loadAsFile(filePath, fromModule, toModule) {
    return Promise.try(() => {
      if (matchExtensions(this._assetExts, filePath)) {
        const dirPath = fp.dirname(filePath);
        if (!this._dirExists(dirPath)) {
          throw new UnableToResolveError(
            fromModule,
            toModule,
            `Directory ${dirPath} doesn't exist`,
          );
        }

        const {name, type} = getAssetDataFromName(potentialModulePath, this._platforms);

        let pattern = '^' + name + '(@[\\d\\.]+x)?';
        if (this._platform != null) {
          pattern += '(\\.' + this._platform + ')?';
          pattern += '\\.' + type;
        }

        // We arbitrarly grab the first one, because scale selection
        // will happen somewhere
        const [assetFile] = this._fastfs.matches(
          dirPath,
          new RegExp(pattern)
        );

        if (assetFile) {
          return this._moduleCache.getAssetModule(assetFile);
        }
      } else {
        let result = this._resolveFilePath(filePath, (filePath) => {
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
        if (result !== undefined) {
          return result;
        }
      }
      throw new UnableToResolveError(
        fromModule,
        toModule,
        `File '${filePath}' doesnt exist`,
      );
    });
  }

  _loadAsDir(dirPath, fromModule, toModule) {
    return Promise.try(() => {
      if (!this._dirExists(dirPath)) {
        throw new UnableToResolveError(
          fromModule,
          toModule,
`Unable to find this module in its module map or any of the node_modules directories under ${potentialDirPath} and its parent directories

This might be related to https://github.com/facebook/react-native/issues/4968
To resolve try the following:
  1. Clear watchman watches: \`watchman watch-del-all\`.
  2. Delete the \`node_modules\` folder: \`rm -rf node_modules && npm install\`.
  3. Reset packager cache: \`rm -fr $TMPDIR/react-*\` or \`npm start -- --reset-cache\`.`,
        );
      }

      return this._resolvePackageMain(dirPath)
        .then(mainPath => this._loadAsFile(mainPath, fromModule, toModule));
    });
  }

  _fileExists(filePath) {
    const root = this._fastfs._getRoot(filePath);
    if (root == null) {
      return false;
    }
    if (root.isLazy) {
      return fs.sync.isFile(filePath);
    }
    return this._fastfs.fileExists(filePath);
  }

  _dirExists(filePath) {
    const root = this._fastfs._getRoot(filePath);
    if (root == null) {
      return false;
    }
    if (root.isLazy) {
      return fs.sync.isDir(filePath);
    }
    return this._fastfs.dirExists(filePath);
  }

  _isModuleName(filePath) {
    const firstChar = filePath[0];
    return firstChar !== '.' && firstChar !== fp.sep;
  }

  _resolvePackageMain(dirPath) {
    const pkgPath = fp.join(dirPath, 'package.json');
    if (this._fileExists(pkgPath)) {
      return this._moduleCache.getPackage(pkgPath).getMain();
    }
    return Promise(
      fp.join(dirPath, 'index')
    );
  }

  _resolveFilePath(filePath, resolver) {
    const platformOptions = {
      platform: this._platform,
      preferNativePlatform: this._preferNativePlatform,
      resolve: resolver,
    };
    return resolveFileExtension(filePath, {
      extensions: this._projectExts,
      resolve: (filePath) => resolveFilePlatform(filePath, platformOptions),
    });
  }

  _resolveLotusPath(fromModule, toModuleName) {

    // Convert relative paths to absolutes.
    if (toModuleName[0] === '.') {
      toModuleName = fp.resolve(
        fp.dirname(fromModule.path),
        toModuleName
      );

      // Try coercing './MyClass' into './MyClass/index'
      const toModulePath = this._resolveFilePath(
        toModuleName + '/index',
        (filePath) => lotus.resolve(filePath, fromModule.path),
      );
      if (toModulePath) {
        return Promise(toModulePath);
      }
    }

    // Prepend $LOTUS_PATH to any module names.
    else if (toModuleName[0] !== fp.sep) {
      toModuleName = fp.join(lotus.path, toModuleName);
    }

    if (fs.sync.isDir(toModuleName)) {
      return this._resolvePackageMain(toModuleName)
        .then(mainPath => {
          return this._resolveFilePath(
            mainPath,
            (filePath) => lotus.resolve(filePath, fromModule.path),
          );
        });
    }

    return Promise.try(() =>
      this._resolveFilePath(
        toModuleName,
        (filePath) => lotus.resolve(filePath, fromModule.path),
      )
    );
  }

  _findInstalledModule(fromModule, toModuleName) {
    const searchQueue = [];
    const isNodeModulesDir = /node_modules$/g;

    let dirPath = fp.dirname(fromModule.path);

    const fromModuleRoot = path.parse(fromModule.path).root;
    while (dirPath !== fromModuleRoot) {
      // Never try 'node_modules/node_modules'
      if (isNodeModulesDir.test(dirPath)) {
        continue;
      }
      searchQueue.push(
        fp.join(dirPath, 'node_modules', toModuleName)
      );
      dirPath = fp.dirname(dirPath);
    }

    if (this._extraNodeModules) {
      const parts = toModuleName.split('/');
      const packageName = parts[0];
      if (this._extraNodeModules[packageName]) {
        parts[0] = this._extraNodeModules[packageName];
        searchQueue.push(fp.join.apply(path, parts));
      }
    }

    let promise = Promise.reject(new UnableToResolveError(
      fromModule,
      toModuleName,
      'Node module not found',
    ));

    searchQueue.forEach(filePath => {
      promise = promise.fail(error => {
        if (error.type !== 'UnableToResolveError') {
          throw error;
        }
        return tryResolve(
          () => this._loadAsFile(filePath, fromModule, toModuleName),
          () => this._loadAsDir(filePath, fromModule, toModuleName),
        );
      });
    });

    promise.fail(error => {
      if (error.type !== 'UnableToResolveError') {
        throw error;
      }
      throw new UnableToResolveError(toModuleName);
    });

    return promise;
  }

  _getNullModule(modulePath, fromModule) {

    if (typeof modulePath !== 'string') {
      throw TypeError('Expected "modulePath" to be a String');
    }

    const moduleCache = this._moduleCache._moduleCache;

    if (modulePath[0] === '.') {
      modulePath = fp.resolve(
        fp.resolve(fromModule.path),
        modulePath
      );
    }

    modulePath += '_NULL';
    let module = moduleCache[modulePath];

    if (!module) {
      module = moduleCache[modulePath] = new NullModule({
        file: modulePath,
        fastfs: this._fastfs,
        moduleCache: this._moduleCache,
        cache: this._moduleCache._cache,
      });
    }

    return module;
  }
}

function resolutionHash(modulePath, depName) {
  return `${fp.resolve(modulePath)}:${depName}`;
}

function tryResolve(action, secondaryAction) {
  return Promise.try(() => action())
  .fail((error) => {
    if (error.type !== 'UnableToResolveError') {
      throw error;
    }
    return secondaryAction();
  });
}

function UnableToResolveError(fromModule, toModule, message) {
  Error.call(this);
  Error.captureStackTrace(this, this.constructor);
  this.message = util.format(
    'Unable to resolve module %s from %s: %s',
    toModule,
    fromModule.path,
    message,
  );
  this.type = this.name = 'UnableToResolveError';
}

util.inherits(UnableToResolveError, Error);

function normalizePath(modulePath) {
  if (fp.sep === '/') {
    modulePath = fp.normalize(modulePath);
  } else if (fp.posix) {
    modulePath = fp.posix.normalize(modulePath);
  }

  return modulePath.replace(/\/$/, '');
}

function resolveKeyWithPromise([key, promise]) {
  return promise.then(value => [key, value]);
}

function isRelativeImport(path) {
  return /^[.][.]?[/]/.test(path);
}

module.exports = ResolutionRequest;
