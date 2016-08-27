/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */
'use strict';

const Event = require('Event');
const LazyVar = require('LazyVar');
const Promise = require('Promise');
const Type = require('Type');
const assertType = require('assertType');
const assertTypes = require('assertTypes');
const emptyFunction = require('emptyFunction');
const fromArgs = require('fromArgs');

const AssetMap = require('./AssetMap');
const AsyncTaskGroup = require('./utils/AsyncTaskGroup');
const Fastfs = require('./fastfs');
const HasteMap = require('./HasteMap');
const Resolution = LazyVar(() => require('./Resolution'));

const type = Type('ResolutionCache')

type.defineOptions({
  platform: String,
  preferNativePlatform: Boolean,
  transformOptions: Object.Maybe,
  extensions: Array,
  assetMap: AssetMap,
  hasteMap: HasteMap,
  fastfs: Fastfs,
})

type.defineValues({

  platform: fromArgs('platform'),

  preferNativePlatform: fromArgs('preferNativePlatform'),

  transformOptions: fromArgs('transformOptions'),

  extensions: fromArgs('extensions'),

  assetMap: fromArgs('assetMap'),

  hasteMap: fromArgs('hasteMap'),

  fastfs: fromArgs('fastfs'),

  // Emits whenever a Resolution is created.
  didCreate: () => Event(),

  // Emits whenever a Resolution is deleted.
  didDelete: () => Event(),

  // Caches the inverse dependencies of every module.
  _dependers: () => new Map(),

  // Caches the dependencies of every module.
  _resolutions: () => new Map(),

  // Holds the Resolutions still in-progress.
  _resolving: () => new Set(),

  // Holds the Resolutions that need reloading.
  _dirty: () => new Set(),

  // When '_resolving' is not empty, this holds a Promise
  // that is resolved when '_resolving' is empty once again.
  _allResolved: null,
})

type.defineMethods({

  allResolved(options = {}) {
    assertTypes(options, {
      onError: Function.Maybe,
      onProgress: Function.Maybe,
    })
    this._flushDirty(options);
    return Promise(this._allResolved);
  },

  hasResolution(module) {
    return this._resolutions.has(module);
  },

  getResolution(module) {
    let resolution = this._resolutions.get(module);
    if (!resolution) {
      resolution = Resolution.call(module, this);
      this._resolutions.set(module, resolution);
      this.didCreate.emit(module, resolution);
    }
    return resolution;
  },

  deleteResolution(module) {
    const resolution = this._resolutions.get(module);
    if (resolution) {
      this._resolutions.delete(module);
      this._dependers.delete(module);
      this._dirty.delete(resolution);
      this.didDelete.emit(module, resolution);
    }
  },

  markDirty(resolution) {
    assertType(resolution, Resolution.get());
    this._dirty.add(resolution);
  },

  markResolving(resolution) {
    assertType(resolution, Resolution.get());
    if (!this._resolving.has(resolution)) {
      this._resolving.add(resolution);
      if (!this._allResolved) {
        this._allResolved = Promise.defer().promise;
      }
      return true;
    }
  },

  markResolved(resolution) {
    assertType(resolution, Resolution.get());
    if (this._resolving.has(resolution)) {
      this._resolving.delete(resolution);
      if (this._resolving.size === 0) {
        this._allResolved._fulfill();
        this._allResolved = null;
      }
      return true;
    }
  },

  getDependers(module) {
    return this._dependers.get(module);
  },

  addDepender(module, depender) {
    let dependers = this._dependers.get(module);
    if (!dependers) {
      dependers = new Set();
      this._dependers.set(module, dependers);
    }
    dependers.add(depender);
  },

  deleteDepender(module, depender) {
    const dependers = this._dependers.get(module);
    if (dependers) {
      dependers.delete(depender);
      dependers.size || this.deleteResolution(module);
    }
  },

  clearDependers(module) {
    const dependers = this._dependers.get(module);
    if (!dependers) {
      return;
    }
    this._dependers.delete(module);
    dependers.forEach(depender => {
      const resolution = this._resolutions.get(depender);
      if (resolution) {
        resolution.markDirty(module.path);
      } else {
        console.warn(`Missing depender: '${depender.path}'`);
      }
    });
  },

  // gatherInverseDependencies(module) {
  //   return Promise(this._allResolved).then(() => {
  //     if (module) {
  //       return this._dependers[module.path] || new Set();
  //     } else {
  //       const dependers = new Map();
  //       this._dependers.forEach((dependers, modulePath) => {
  //         const module =
  //         dependers.set(dependency, dependers);
  //       });
  //       return dependers;
  //     }
  //   });
  // },

  _flushDirty({onProgress, onError}) {
    if (!this._dirty.size) {
      return;
    }
    this._dirty.forEach(resolution => {
      resolution.reloadRequires({
        force: true,
        recursive: false,
        onProgress,
        onError,
      });
    });
    this._dirty.clear();
  },
})

module.exports = type.build()
