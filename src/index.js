 /**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */
'use strict';

const emptyFunction = require('emptyFunction');
const util = require('util');
const fs = require('io');

const path = require('./fastpath');
const Cache = require('./Cache');
const crawl = require('./crawlers');
const Fastfs = require('./fastfs');
const Module = require('./Module');
const Polyfill = require('./Polyfill');
const HasteMap = require('./HasteMap');
const FileWatcher = require('./FileWatcher');
const ModuleCache = require('./ModuleCache');
const extractRequires = require('./utils/extractRequires');
const replacePatterns = require('./utils/replacePatterns');
const ResolutionRequest = require('./ResolutionRequest');
const ResolutionResponse = require('./ResolutionResponse');
const getAssetDataFromName = require('./utils/getAssetDataFromName');
const getPlatformExtension = require('./utils/getPlatformExtension');
const getInverseDependencies = require('./utils/getInverseDependencies');

const defaultActivity = {
  startEvent: () => {},
  endEvent: () => {},
};

class DependencyGraph {
  constructor({
    lazyRoots,
    projectRoots,
    projectExts,
    assetExts,
    activity = defaultActivity,
    getBlacklist = emptyFunction,
    fileWatcher,
    providesModuleNodeModules,
    platforms = [],
    preferNativePlatform = false,
    cache,
    mocksPattern,
    extractRequires,
    transformCode,
    shouldThrowOnUnresolvedErrors = emptyFunction.thatReturnsTrue,
    enableAssetMap,
    assetDependencies,
    moduleOptions,
    extraNodeModules,
  }) {
    this._opts = {
      lazyRoots,
      projectRoots,
      projectExts,
      assetExts,
      activity,
      fileWatcher,
      providesModuleNodeModules,
      platforms: new Set(platforms),
      preferNativePlatform,
      cache,
      mocksPattern,
      extractRequires,
      transformCode,
      shouldThrowOnUnresolvedErrors,
      enableAssetMap: enableAssetMap || true,
      assetDependencies,
      moduleOptions: moduleOptions || {
        cacheTransformResults: true,
      },
      extraNodeModules,
      ignoreFilePath: getBlacklist() || emptyFunction.thatReturnsFalse,
    };

    this.load();
  }

  load() {
    if (this._loading) {
      return this._loading;
    }

    const {
      projectRoots,
      lazyRoots,
      platforms,
      projectExts,
      ignoreFilePath,
      fileWatcher,
      activity,
    } = this._opts;

    const crawlActivity = activity.startEvent('crawl filesystem');

    this._crawling = crawl(projectRoots, {
      extensions: projectExts,
      ignoreFilePath,
      fileWatcher,
    });

    this._crawling.then(() =>
      activity.endEvent(crawlActivity));

    this._fastfs = new Fastfs('find .js files', {
      roots: projectRoots,
      lazyRoots,
      fileWatcher,
      activity,
      ignoreFilePath,
      crawling: this._crawling,
    });

    this._fastfs.on(
      'change',
      this._processFileChange.bind(this)
    );

    this._moduleCache = new ModuleCache({
      fastfs: this._fastfs,
      cache: this._opts.cache,
      extractRequires: this._opts.extractRequires,
      transformCode: this._opts.transformCode,
      assetDependencies: this._assetDependencies,
      moduleOptions: this._opts.moduleOptions,
    }, platforms);

    this._hasteMap = new HasteMap({
      projectExts,
      fastfs: this._fastfs,
      moduleCache: this._moduleCache,
      ignoreFilePath,
      preferNativePlatform: this._opts.preferNativePlatform,
      platforms,
    });

    return this._loading = this._fastfs.build().then(() => {
      const hasteActivity = activity.startEvent('find haste modules');
      return this._hasteMap.build().then(hasteModules => {
        const hasteModuleNames = Object.keys(hasteModules);

        const json = {};
        hasteModuleNames.forEach(moduleName => {
          const map = hasteModules[moduleName];
          const mod = map.generic || Object.keys(map)[0];
          if (mod && mod.path) {
            json[moduleName] = path.relative(lotus.path, mod.path);
          }
        });

        fs.sync.write(
          lotus.path + '/.ReactNativeHasteMap.json',
          JSON.stringify(json, null, 2)
        );

        log.moat(1);
        log.white('Haste modules: ');
        log.cyan(hasteModuleNames.length);
        log.moat(1);

        activity.endEvent(hasteActivity);
        return hasteModules;
      });
    });
  }

  /**
   * Returns a promise with the direct dependencies the module associated to
   * the given entryPath has.
   */
  getShallowDependencies(entryPath, transformOptions) {
    return this._moduleCache
      .getModule(entryPath)
      .getDependencies(transformOptions);
  }

  getFS() {
    return this._fastfs;
  }

  /**
   * Returns the module object for the given path.
   */
  getModuleForPath(entryFile) {
    return this._moduleCache.getModule(entryFile);
  }

  getAllModules() {
    return this.load().then(() => this._moduleCache.getAllModules());
  }

  getDependencies({
    entryPath,
    platform,
    transformOptions,
    onProgress,
    recursive = true,
    ignoreFilePath = emptyFunction.thatReturnsFalse,
  }) {
    return this.load().then(() => {
      platform = this._getRequestPlatform(entryPath, platform);
      const absPath = this._getAbsolutePath(entryPath);
      const req = new ResolutionRequest({
        platform,
        platforms: this._opts.platforms,
        preferNativePlatform: this._opts.preferNativePlatform,
        projectExts: this._opts.projectExts,
        assetExts: this._opts.assetExts,
        entryPath: absPath,
        fastfs: this._fastfs,
        hasteMap: this._hasteMap,
        moduleCache: this._moduleCache,
        ignoreFilePath: (filePath) => ignoreFilePath(filePath) || this._opts.ignoreFilePath(filePath),
        shouldThrowOnUnresolvedErrors: this._opts.shouldThrowOnUnresolvedErrors,
        extraNodeModules: this._opts.extraNodeModules,
      });

      const response = new ResolutionResponse({transformOptions});

      return req.getOrderedDependencies({
        response,
        mocksPattern: this._opts.mocksPattern,
        transformOptions,
        onProgress,
        recursive,
      }).then(() => response);
    });
  }

  matchFilesByPattern(pattern) {
    return this.load().then(() => this._fastfs.matchFilesByPattern(pattern));
  }

  _mergeArrays(arrays) {
    const result = [];
    arrays.forEach((array) => {
      if (!Array.isArray(array)) {
        return;
      }
      array.forEach((item) =>
        result.push(item));
    });
    return result;
  }

  _getRequestPlatform(entryPath, platform) {
    if (platform == null) {
      platform = getPlatformExtension(entryPath, this._opts.platforms);
    } else if (!this._opts.platforms.has(platform)) {
      throw new Error('Unrecognized platform: ' + platform);
    }
    return platform;
  }

  _getAbsolutePath(filePath) {
    if (path.isAbsolute(filePath)) {
      return path.resolve(filePath);
    }

    for (let i = 0; i < this._opts.projectRoots.length; i++) {
      const root = this._opts.projectRoots[i];
      const potentialAbsPath = path.join(root, filePath);
      if (this._fastfs.fileExists(potentialAbsPath)) {
        return path.resolve(potentialAbsPath);
      }
    }

    throw new NotFoundError(
      'Cannot find entry file %s in any of the roots: %j',
      filePath,
      this._opts.projectRoots
    );
  }

  _processFileChange(type, filePath, root, fstat) {
    const absPath = path.join(root, filePath);
    if (!this._opts.ignoreFilePath(absPath)) {
      return;
    }

    // Ok, this is some tricky promise code. Our requirements are:
    // * we need to report back failures
    // * failures shouldn't block recovery
    // * Errors can leave `hasteMap` in an incorrect state, and we need to rebuild
    // After we process a file change we record any errors which will also be
    // reported via the next request. On the next file change, we'll see that
    // we are in an error state and we should decide to do a full rebuild.
    this._loading = this._loading.always(() => {
      if (this._hasteMapError) {
        console.warn(
          'Rebuilding haste map to recover from error:\n' +
          this._hasteMapError.stack
        );
        this._hasteMapError = null;

        // Rebuild the entire map if last change resulted in an error.
        this._loading = this._hasteMap.build();
      } else {
        this._loading = this._hasteMap.processFileChange(type, absPath);
        this._loading.fail((e) => this._hasteMapError = e);
      }
      return this._loading;
    });
  }

  createPolyfill(options) {
    return this._moduleCache.createPolyfill(options);
  }
}

function NotFoundError() {
  Error.call(this);
  Error.captureStackTrace(this, this.constructor);
  var msg = util.format.apply(util, arguments);
  this.message = msg;
  this.type = this.name = 'NotFoundError';
  this.status = 404;
}
util.inherits(NotFoundError, Error);

Object.assign(exports, {
  DependencyGraph,
  Cache,
  Fastfs,
  FileWatcher,
  Module,
  Polyfill,
  extractRequires,
  getAssetDataFromName,
  getPlatformExtension,
  replacePatterns,
  getInverseDependencies,
});
