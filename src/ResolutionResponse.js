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
const sync = require('sync');
const Promise = require('Promise');
const PureObject = require('PureObject');
const Type = require('Type');

const AsyncTaskGroup = require('./utils/AsyncTaskGroup');
const Resolution = require('./Resolution');

const type = Type('ResolutionResponse')

type.defineOptions({
  transformOptions: Object,
})

type.defineValues({

  mainModuleId: null,

  dependencies: null,

  numPrependedDependencies: 0,

  _mainModule: null,

  _updating: null,

  _dependers: () => new Map(),

  _resolutions: () => new Map(),

  _transformOptions: fromArgs('transformOptions'),
})

type.defineMethods({

  hasResolution(module) {
    return this._resolutions.has(module);
  },

  getResolution(module, config) {
    let resolution = this._resolutions.get(module);
    if (!resolution && config) {
      resolution = this._createResolution(module, config);
      if (this.dependencies) {
        this.dependencies.push(module);
      } else {
        this.dependencies = [module];
        this._mainModule = module;
      }
    }
    return resolution;
  },

  getInverseDependencies(module) {
    return this._onceUpdated(() => {
      if (module) {
        return this._dependers[module.path] || new Set();
      } else {
        const dependers = new Map();
        sync.each(this._dependers, (dependers, modulePath) => {
          const module =
          dependers.set(dependency, dependers);
        });
        return dependencies;
      }
    });
  },

  copy({
    dependencies = this.dependencies,
    numPrependedDependencies = 0,
  }) {
    if (dependencies === this.dependencies) {
      numPrependedDependencies = this.numPrependedDependencies;
    }

    const copy = ResolutionResponse();
    return Object.assign(copy, {
      dependencies,
      numPrependedDependencies,
      mainModuleId: this.mainModuleId,
      _mainModule: this._mainModule,
      _updating: this._updating,
      _dependers: this._dependers,
      _resolutions: this._resolutions,
      _transformOptions: this._transformOptions,
    });
  },

  onceReady(callback) {
    return this._onceUpdated(() => {
      assert(this._mainModule, 'Must have at least one dependency!');
      return this._mainModule
        .getName()
        .then(name => {
          this.mainModuleId = name;
          return this;
        })
        .then(callback);
    });
  },

  _createResolution(module, config) {
    const resolution = Resolution(module, config);
    this._resolutions.set(module, resolution);
    return resolution;
  },

  _removeResolution(module) {
    const index = this.dependencies.indexOf(module);
    if (index !== -1) {
      this.dependencies.splice(index, 1);
      delete this._resolutions[module.path];
    }
  },

  _addDepender(module, depender) {
    let dependers = this._dependers.get(module);
    if (!dependers) {
      dependers = new Set();
      this._dependers.set(module, dependers);
    }
    dependers.add(depender);
  },

  _removeDependers(module) {
    const dependers = this._dependers.get(module);
    if (dependers) {
      this._dependers.delete(module);
      dependers.forEach(depender => {
        const resolution = this._resolutions[depender.path];
        if (resolution) {
          resolution.invalidatePath(module.path);
        } else {
          console.warn(`Missing depender: '${depender.path}'`);
        }
      });
    }
  },

  _onceUpdated(callback) {
    return (this._updating ?
      this._updating.done : Promise()).then(callback);
  },

  _beginUpdate(resolution) {
    if (!this._updating) {
      this._updating = new AsyncTaskGroup();
      this._updating.done.then(() => {
        this._updating = null;
      });
    }
    this._updating.start(resolution);
  },

  _endUpdate(resolution) {
    if (this._updating) {
      this._updating.end(resolution);
    }
  },
})

const ResolutionResponse = type.build();

module.exports = ResolutionResponse;
