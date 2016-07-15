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

class ResolutionResponse {
  constructor({transformOptions}) {
    this.transformOptions = transformOptions;
    this.dependencies = [];
    this.mainModuleId = null;
    this.mocks = null;
    this.numPrependedDependencies = 0;
    this._mappings = Object.create(null);
    this._finalized = false;
    this._finalizeCallbacks = [];
  }

  copy(properties) {
    const {
      dependencies = this.dependencies,
      mainModuleId = this.mainModuleId,
      mocks = this.mocks,
    } = properties;

    const numPrependedDependencies = dependencies === this.dependencies
      ? this.numPrependedDependencies : 0;

    return Object.assign(
      new this.constructor({transformOptions: this.transformOptions}),
      this,
      {
        dependencies,
        mainModuleId,
        mocks,
        numPrependedDependencies,
      },
    );
  }

  _assertNotFinalized() {
    if (this._finalized) {
      throw new Error('Attempted to mutate finalized response.');
    }
  }

  _assertFinalized() {
    if (!this._finalized) {
      throw new Error('Attempted to access unfinalized response.');
    }
  }

  finalize() {
    return this._mainModule.getName()
    .then(id => {
      this.mainModuleId = id;
      this._finalized = true;
      process.nextTick(() => {
        this._finalizeCallbacks.forEach(callback => callback(this));
        this._finalizeCallbacks = null;
      });
      return this;
    });
  }

  onFinalize(callback) {
    if (this._finalized) {
      return callback ? callback(this) : Promise(this);
    } else if (callback) {
      this._finalizeCallbacks.push(callback);
    } else {
      const {promise, resolve} = Promise.defer();
      this._finalizeCallbacks.push(resolve);
      return promise;
    }
  }

  pushDependency(module) {
    this._assertNotFinalized();
    if (this.dependencies.length === 0) {
      this._mainModule = module;
    }

    this.dependencies.push(module);
  }

  prependDependency(module) {
    this._assertNotFinalized();
    this.dependencies.unshift(module);
    this.numPrependedDependencies += 1;
  }

  setResolvedDependencyPairs(module, pairs) {
    this._assertNotFinalized();
    const hash = module.hash();
    if (this._mappings[hash] == null) {
      this._mappings[hash] = pairs;
    }
  }

  setMocks(mocks) {
    this.mocks = mocks;
  }

  getResolvedDependencyPairs(module) {
    this._assertFinalized();
    return this._mappings[module.hash()];
  }
}

module.exports = ResolutionResponse;
