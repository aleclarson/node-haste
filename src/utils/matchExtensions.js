/**
* Copyright (c) 2016-present, Facebook, Inc.
* All rights reserved.
*
* This source code is licensed under the BSD-style license found in the
* LICENSE file in the root directory of this source tree. An additional grant
* of patent rights can be found in the PATENTS file in the same directory.
*/
'use strict';

const inArray = require('in-array');
const fp = require('../fastpath');

module.exports = function matchExtensions(extensions, filePath) {
  return inArray(
    extensions,
    fp.extname(filePath).substr(1)
  );
};
