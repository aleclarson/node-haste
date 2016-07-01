/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */
'use strict';

const path = require('../fastpath');

module.exports = function resolveFilePlatform(filePath, {
  platform,
  preferNativePlatform,
  resolver,
}) {
  const ext = path.extname(filePath);

  let result = resolver(filePath + '.' + platform + ext);
  if (result !== undefined) {
    return result;
  }

  if (preferNativePlatform) {
    result = resolver(filePath + '.native' + ext);
    if (result !== undefined) {
      return result;
    }
  }

  result = resolver(filePath + ext);
  if (result !== undefined) {
    return result;
  }
}
