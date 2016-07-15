 /**
 * Copyright (c) 2016-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */
'use strict';

const Promise = require('Promise');

module.exports = class AsyncTaskGroup {
  constructor() {
    const deferred = Promise.defer();
    this._runningTasks = new Set();
    this._resolve = deferred.resolve;
    this.done = deferred.promise;
  }

  start(taskHandle) {
    this._runningTasks.add(taskHandle);
  }

  end(taskHandle) {
    const runningTasks = this._runningTasks;
    if (runningTasks.delete(taskHandle) && runningTasks.size === 0) {
      this._resolve();
    }
  }
};
