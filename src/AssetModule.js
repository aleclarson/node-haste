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
const Type = require('Type');

const Module = require('./Module');
const getAssetDataFromName = require('./utils/getAssetDataFromName');

const type = Type('AssetModule')

type.inherits(Module)

type.defineOptions({
  platforms: Array,
})

type.defineValues({

  _name: null,

  _type: null,

  _dependencies: (opts) => opts.dependencies || [],
})

type.initInstance(function(opts) {
  const { resolution, name, type } = getAssetDataFromName(this.path, opts.platforms);
  this.resolution = resolution;
  this._name = name;
  this._type = type;
})

type.overrideMethods({

  isHaste() {
    return Promise(false);
  },

  readDependencies() {
    return Promise(this._dependencies);
  },

  read() {
    return Promise({});
  },

  getName() {
    return this.__super().then(
      id => id.replace(/\/[^\/]+$/, `/${this._name}.${this._type}`)
    );
  },

  hash() {
    return `AssetModule : ${this.path}`;
  },

  isJSON() {
    return false;
  },

  isAsset() {
    return true;
  },
})

module.exports = type.build()
