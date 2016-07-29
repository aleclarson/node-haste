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

const type = Type('NullModule')

type.inherits(Module)

type.defineValues({
  code: 'module.exports = null;',
})

type.overrideMethods({

  isHaste() {
    return Promise(false);
  },

  getName() {
    return Promise(this.path);
  },

  getPackage() {
    return null;
  },

  readDependencies() {
    return Promise([]);
  },

  isJSON() {
    return false;
  },

  isNull() {
    return true;
  },

  read() {
    return Promise(this.code);
  },
})

module.exports = type.build()
