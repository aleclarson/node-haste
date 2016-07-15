 /**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */
'use strict';

module.exports = {

  DependencyGraph: require('./DependencyGraph'),
  Cache: require('./Cache'),
  Fastfs: require('./fastfs'),
  FileWatcher: require('./FileWatcher'),
  Module: require('./Module'),
  Polyfill: require('./Polyfill'),

  extractRequires: require('./utils/extractRequires'),
  matchExtensions: require('./utils/matchExtensions'),
  replacePatterns: require('./utils/replacePatterns'),
  getAssetDataFromName: require('./utils/getAssetDataFromName'),
  getPlatformExtension: require('./utils/getPlatformExtension'),
  getInverseDependencies: require('./utils/getInverseDependencies'),
};
