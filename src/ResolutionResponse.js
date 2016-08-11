/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */
'use strict';

const assert = require('assert');
const fromArgs = require('fromArgs');
const Type = require('Type');

const AsyncTaskGroup = require('./utils/AsyncTaskGroup');
const Resolution = require('./Resolution');
const ResolutionCache = require('./ResolutionCache');

const type = Type('ResolutionResponse')

type.defineOptions({
  cache: ResolutionCache,
})

type.defineValues({

  mainModuleId: null,

  dependencies: null,

  numPrependedDependencies: 0,

  _mainModule: null,

  _cache: fromArgs('cache'),
})

// TODO: Stop these listeners when this
//       ResolutionResponse is no longer in use.
type.initInstance(function() {

  this._cache
    .didCreate(module => this._addDependency(module))
    .start();

  this._cache
    .didDelete(module => this._removeDependency(module))
    .start();
})

type.defineMethods({

  copy({
    dependencies = this.dependencies,
    numPrependedDependencies = 0,
  }) {
    if (dependencies === this.dependencies) {
      numPrependedDependencies = this.numPrependedDependencies;
    }

    const copy = this.constructor({cache: this._cache});
    return Object.assign(copy, {
      dependencies,
      numPrependedDependencies,
      mainModuleId: this.mainModuleId,
      _mainModule: this._mainModule,
    });
  },

  hasResolution(module) {
    return this._cache.hasResolution(module);
  },

  getResolution(module) {
    return this._cache.getResolution(module);
  },

  deleteResolution(module) {
    this._cache.deleteResolution(module);
  },

  allResolved(options) {
    return this._cache.allResolved(options)
    .then(() => {
      assert(this._mainModule, 'Must have at least one dependency!');
      return this._mainModule
        .getName()
        .then(name => {
          this.mainModuleId = name;
          return this;
        });
    });
  },

  gatherInverseDependencies(module) {
    return this._cache.gatherInverseDependencies(module);
  },

  _addDependency(module) {
    if (this.dependencies) {
      this.dependencies.push(module);
    } else {
      this.dependencies = [module];
      this._mainModule = module;
    }
  },

  _removeDependency(module) {
    if (!this.dependencies) {
      return;
    }
    const index = this.dependencies.indexOf(module);
    if (index === -1) {
      return;
    }
    if (this.dependencies.length === 1) {
      this.dependencies = null;
    } else {
      this.dependencies.splice(index, 1);
    }
  },
})

module.exports = type.build()
