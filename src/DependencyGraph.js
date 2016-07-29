/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */
'use strict';

const Promise = require('Promise');
const PureObject = require('PureObject');
const Type = require('Type');
const emptyFunction = require('emptyFunction');
const assertTypes = require('assertTypes');
const fromArgs = require('fromArgs');
const fs = require('io');
const inArray = require('in-array');
const mergeDefaults = require('mergeDefaults');
const sync = require('sync');
const util = require('util');

const AssetMap = require('./AssetMap');
const Cache = require('./Cache');
const Fastfs = require('./fastfs');
const FileWatcher = require('./FileWatcher');
const HasteMap = require('./HasteMap');
const ModuleCache = require('./ModuleCache');
const ResolutionResponse = require('./ResolutionResponse');

const crawl = require('./crawlers');
const fp = require('./fastpath');
const getPlatformExtension = require('./utils/getPlatformExtension');

const defaultActivity = {
  startEvent: () => {},
  endEvent: () => {},
};

const type = Type('DependencyGraph')

type.defineOptions({
  cache: Cache.isRequired,
  fileWatcher: FileWatcher.isRequired,
  projectRoots: Array,
  projectExts: Array,
  assetRoots: Array,
  assetExts: Array,
  lazyRoots: Array,
  platforms: Array,
  preferNativePlatform: Boolean.withDefault(false),
  blacklist: Function.withDefault(emptyFunction.thatReturnsFalse),
  redirect: PureObject,
  activity: Object.withDefault(defaultActivity),
  extractRequires: Function,
  transformCode: Function,
  assetDependencies: Array,
  moduleOptions: Object,
  extraNodeModules: Object,
  onResolutionError: Function,
})

type.defineValues({

  _lazyRoots: fromArgs('lazyRoots'),

  _projectRoots: (opts) => opts.projectRoots || [],

  _projectExts: (opts) => opts.projectExts || [],

  _assetRoots: (opts) => opts.assetRoots || [],

  _assetExts: (opts) => opts.assetExts || [],

  _blacklist: fromArgs('blacklist'),

  _platforms: fromArgs('platforms'),

  _preferNativePlatform: fromArgs('preferNativePlatform'),

  _activity: fromArgs('activity'),

  _extraNodeModules: fromArgs('extraNodeModules'),

  _onResolutionError: fromArgs('onResolutionError'),

  _responseCache: PureObject.create,

  _crawling(opts) {
    return crawl(this._allRoots(), {
      extensions: this._allExts(),
      fileWatcher: opts.fileWatcher,
      blacklist: this._blacklist,
    });
  },

  _fastfs(opts) {
    return Fastfs({
      name: 'find source files',
      roots: this._allRoots(),
      lazyRoots: opts.lazyRoots,
      fileWatcher: opts.fileWatcher,
      blacklist: this._blacklist,
      activity: this._activity,
      crawling: this._crawling,
    });
  },

  _moduleCache(opts) {
    return ModuleCache({
      fastfs: this._fastfs,
      cache: opts.cache,
      platforms: this._platforms,
      extractRequires: opts.extractRequires,
      transformCode:  opts.transformCode,
      assetDependencies: opts.assetDependencies,
      moduleOptions: opts.moduleOptions || {cacheTransformResults: true},
      redirect: opts.redirect,
    });
  },

  _assetMap(opts) {
    return AssetMap({
      fastfs: this._fastfs,
      extensions: opts.assetExts,
    });
  },

  _hasteMap(opts) {
    return HasteMap({
      projectExts: this._projectExts,
      fastfs: this._fastfs,
      moduleCache: this._moduleCache,
      blacklist: this._blacklist,
      platforms: this._platforms,
      preferNativePlatform: this._preferNativePlatform,
    });
  },

  _loading(opts) {
    const crawlActivity = this._activity.startEvent('crawl filesystem');
    return this._crawling
    .then(() => this._activity.endEvent(crawlActivity))
    .then(() => this._fastfs.build())
    .then(() => {
      const assetActivity = this._activity.startEvent('find assets');
      this._assetMap.build();
      log.moat(1);
      log.gray('assets found: ');
      log.white(Object.keys(this._assetMap._assets).length);
      log.moat(1);
      this._activity.endEvent(assetActivity);
    })
    .then(() => {
      const hasteActivity = this._activity.startEvent('find haste modules');
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
        log.gray('haste modules found: ');
        log.white(hasteModuleNames.length);
        log.moat(1);

        this._activity.endEvent(hasteActivity);
        return hasteModules;
      });
    });
  },
})

type.initInstance(function(opts) {
  this._fastfs.on(
    'change',
    this._processFileChange.bind(this)
  );
})

type.defineMethods({

  load() {
    return this._loading;
  },

  /**
   * Returns a promise with the direct dependencies the module associated to
   * the given entryFile has.
   */
  getShallowDependencies(entryFile, transformOptions) {
    return this._moduleCache
      .getModule(entryFile)
      .readDependencies(transformOptions);
  },

  /**
   * Returns the module object for the given path.
   */
  getModuleForPath(entryFile) {
    return this._moduleCache.getModule(entryFile);
  },

  getAllModules() {
    return this.load().then(() => this._moduleCache.getAllModules());
  },

  getDependencies(options) {
    assertTypes(options, {
      entryFile: String,
      platform: String,
      recursive: Boolean.Maybe,
      transformOptions: Object.Maybe,
      onProgress: Function.Maybe,
      onError: Function.Maybe,
    })
    mergeDefaults(options, {
      recursive: true,
      verbose: false,
    })
    return this.load().then(() => {
      const {transformOptions, recursive} = options;
      const platform = this._getRequestPlatform(options.entryFile, options.platform);
      const entryFile =
        fp.isAbsolute(options.entryFile) ?
          fp.resolve(options.entryFile) :
          fp.join(process.cwd(), options.entryFile);

      const responseId = JSON.stringify({entryFile, platform, recursive});
      let response = this._responseCache[responseId];
      if (response) {
        return response;
      }

      response = ResolutionResponse({transformOptions});
      this._responseCache[responseId] = response;

      const entry = this._moduleCache.getModule(entryFile);
      const resolution = response.getResolution(entry, {
        platform,
        preferNativePlatform: this._preferNativePlatform,
        extensions: this._projectExts,
        fastfs: this._fastfs,
        assetMap: this._assetMap,
        hasteMap: this._hasteMap,
      });

      const onError = options.onError || emptyFunction;
      return resolution._updateResponse(response, {
        recursive,
        onProgress: options.onProgress,
        onError: (...args) => {
          const result = onError.apply(null, args);
          if (result !== false) {
            this._onResolutionError.apply(null, args);
          }
        },
      });
    });
  },

  getFS() {
    return this._fastfs;
  },

  matchFilesByPattern(pattern) {
    return this._loading.then(() =>
      this._fastfs.matchFilesByPattern(pattern));
  },

  createPolyfill(options) {
    return this._moduleCache.createPolyfill(options);
  },

  _allRoots() {
    return this._projectRoots
      .concat(this._assetRoots);
  },

  _allExts() {
    return this._projectExts
      .concat(this._assetExts);
  },

  _getRequestPlatform(entryPath, platform) {
    if (platform == null) {
      platform = getPlatformExtension(entryPath, this._platforms);
    } else if (!inArray(this._platforms, platform)) {
      throw new Error('Unrecognized platform: ' + platform);
    }
    return platform;
  },

  _processFileChange(type, filePath, root, fstat) {
    const absPath = fp.join(root, filePath);
    if (this._blacklist(absPath)) {
      return;
    }

    const module = this._moduleCache.getCachedModule(absPath);
    module && sync.each(this._responseCache, (response, responseId) => {
      const resolution = response.getResolution(module);
      if (!resolution) {
        return;
      }
      if (type === 'delete') {
        response._removeDependers(module);
        response._removeResolution(resolution);
      } else {
        resolution._updateResponse(response, {
          recursive: JSON.parse(responseId).recursive,
          onError: this._onResolutionError,
        });
      }
    });

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
  },
})

module.exports = type.build()

//
// Helpers
//

function resolveKeyWithPromise([key, promise]) {
  return promise.then(value => [key, value]);
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
