/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */
'use strict';

const nodeCrawl = require('./node');
const watchmanCrawl = require('./watchman');

function crawl(roots, options) {
  const {fileWatcher} = options;
  if (fileWatcher && fileWatcher.isWatchman()) {
    return watchmanCrawl(roots, options);
  }
  return nodeCrawl(roots, options);
}

module.exports = crawl;
