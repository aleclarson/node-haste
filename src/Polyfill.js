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
const fromArgs = require('fromArgs');

const Module = require('./Module');
const fp = require('./fastpath');

const type = Type('Polyfill')

type.inherits(Module)

type.defineValues({
  _id: fromArgs('id'),
  _dependencies: fromArgs('dependencies'),
})

type.overrideMethods({

  isHaste() {
    return Promise(false);
  },

  getName() {
    return Promise.try(() => {
      if (fp.isAbsolute(this._id)) {
        return lotus.relative(this._id);
      }
      return this._id;
    });
  },

  getPackage() {
    return null;
  },

  readDependencies() {
    return Promise(this._dependencies);
  },

  isJSON() {
    return false;
  },

  isPolyfill() {
    return true;
  },
})

module.exports = type.build()
