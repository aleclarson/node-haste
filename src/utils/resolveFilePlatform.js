/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */
'use strict';

const fp = require('../fastpath');

function resolveFilePlatform(filePath, platform, preferNativePlatform, resolver) {
  const ext = fp.extname(filePath);
  const filename = ext ? filePath.slice(0, 0 - ext.length) : filePath;

  let result = resolver(filename + '.' + platform + ext);
  if (result != null) {
    return result;
  }

  if (preferNativePlatform) {
    result = resolver(filename + '.native' + ext);
    if (result != null) {
      return result;
    }
  }

  result = resolver(filePath);
  if (result != null) {
    return result;
  }
}

module.exports = resolveFilePlatform;
