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

function resolveFileExtension(filePath, extensions, resolver) {

  // If an extension is provided, don't try the default extensions.
  if (fp.extname(filePath)) {
    return resolver(filePath);
  }

  // Try each default extension.
  for (let i = 0; i < extensions.length; i++) {
    let result = resolver(filePath + '.' + extensions[i]);
    if (result != null) {
      return result;
    }
  }
}

module.exports = resolveFileExtension;
