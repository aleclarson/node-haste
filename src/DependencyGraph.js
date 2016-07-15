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

const fp = require('./fastpath');
const crawl = require('./crawlers');
const Fastfs = require('./fastfs');
const AssetMap = require('./AssetMap');
const HasteMap = require('./HasteMap');
const ModuleCache = require('./ModuleCache');
const ResolutionRequest = require('./ResolutionRequest');
const ResolutionResponse = require('./ResolutionResponse');
const getPlatformExtension = require('./utils/getPlatformExtension');

const defaultActivity = {
  startEvent: () => {},
  endEvent: () => {},
};

class DependencyGraph {
  constructor({
    lazyRoots,
    projectRoots,
    projectExts,
    assetRoots = [],
    assetExts = [],
    fileWatcher,
    activity = defaultActivity,
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
    blacklist = emptyFunction.thatReturnsFalse,
    redirect = {},
  }) {
    this._opts = {
      lazyRoots,
      projectRoots,
      projectExts,
      assetRoots,
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
      blacklist,
      redirect,
    };

    this.load();
  }

  load() {
    if (this._loading) {
      return this._loading;
    }

    const {
      activity,
      fileWatcher,
      platforms,
      blacklist,
      projectExts,
      projectRoots,
      assetRoots,
      assetExts,
      lazyRoots,
    } = this._opts;

    const crawlActivity = activity.startEvent('crawl filesystem');

    const roots = projectRoots.concat(assetRoots);
    const extensions = projectExts.concat(assetExts);

    this._crawling = crawl(roots, {
      extensions,
      fileWatcher,
      blacklist,
    });

    this._crawling.then(() =>
      activity.endEvent(crawlActivity));

    this._fastfs = new Fastfs('find source files', {
      roots,
      lazyRoots,
      fileWatcher,
      blacklist,
      activity,
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

    this._assetMap = new AssetMap({
      fastfs: this._fastfs,
      extensions: this._opts.assetExts,
    });

    this._hasteMap = new HasteMap({
      fastfs: this._fastfs,
      projectExts,
      blacklist,
      platforms,
      preferNativePlatform: this._opts.preferNativePlatform,
      moduleCache: this._moduleCache,
    });

    return this._loading = this._fastfs.build()
    .then(() => {
      const assetActivity = activity.startEvent('find assets');
      this._assetMap.build();
      log.moat(1);
      log.white('assets found: ');
      log.yellow(Object.keys(this._assetMap._assets).length);
      log.moat(1);
      activity.endEvent(assetActivity);
    })
    .then(() => {
      const hasteActivity = activity.startEvent('find haste modules');
      return this._hasteMap.build().then(hasteModules => {
        const hasteModuleNames = Object.keys(hasteModules);

        const json = {};
        hasteModuleNames.forEach(moduleName => {
          const map = hasteModules[moduleName];
          const mod = map.generic || Object.keys(map)[0];
          if (mod && mod.path) {
            json[moduleName] = fp.relative(lotus.path, mod.path);
          }
        });

        fs.sync.write(
          lotus.path + '/.ReactNativeHasteMap.json',
          JSON.stringify(json, null, 2)
        );

        log.moat(1);
        log.white('haste modules found: ');
        log.yellow(hasteModuleNames.length);
        log.moat(1);

        activity.endEvent(hasteActivity);
        return hasteModules;
      });
    });
  }

  /**
   * Returns a promise with the direct dependencies the module associated to
   * the given entryFile has.
   */
  getShallowDependencies(entryFile, transformOptions) {
    return this._moduleCache
      .getModule(entryFile)
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
    entryFile,
    platform,
    blacklist = emptyFunction.thatReturnsFalse,
    transformOptions,
    onProgress,
    recursive = true,
    verbose,
  }) {
    return this.load().then(() => {

      const req = new ResolutionRequest({
        entryFile: fp.isAbsolute(entryFile) ? fp.resolve(entryFile) : fp.join(process.cwd(), entryFile),
        projectExts: this._opts.projectExts,
        assetExts: this._opts.assetExts,
        fastfs: this._fastfs,
        assetMap: this._assetMap,
        hasteMap: this._hasteMap,
        moduleCache: this._moduleCache,
        platform: this._getRequestPlatform(entryFile, platform),
        platforms: this._opts.platforms,
        preferNativePlatform: this._opts.preferNativePlatform,
        shouldThrowOnUnresolvedErrors: this._opts.shouldThrowOnUnresolvedErrors,
        extraNodeModules: this._opts.extraNodeModules,
        blacklist: (filePath) => blacklist(filePath) || this._opts.blacklist(filePath),
        redirect: this._opts.redirect,
      });

      const response = new ResolutionResponse({transformOptions});

      return req.getOrderedDependencies({
        response,
        mocksPattern: this._opts.mocksPattern,
        transformOptions,
        onProgress,
        recursive,
        verbose,
      })
      .then(() => response);
    });
  }

  matchFilesByPattern(pattern) {
    return this.load().then(() => this._fastfs.matchFilesByPattern(pattern));
  }

  _getRequestPlatform(entryPath, platform) {
    if (platform == null) {
      platform = getPlatformExtension(entryPath, this._opts.platforms);
    } else if (!this._opts.platforms.has(platform)) {
      throw new Error('Unrecognized platform: ' + platform);
    }
    return platform;
  }

  _processFileChange(type, filePath, root, fstat) {
    const absPath = fp.join(root, filePath);
    if (!this._opts.blacklist(absPath)) {
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

module.exports = DependencyGraph;

function NotFoundError() {
  Error.call(this);
  Error.captureStackTrace(this, this.constructor);
  var msg = util.format.apply(util, arguments);
  this.message = msg;
  this.type = this.name = 'NotFoundError';
  this.status = 404;
}
util.inherits(NotFoundError, Error);
