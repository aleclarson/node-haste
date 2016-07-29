/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */
'use strict';

const {EventEmitter} = require('events');
const {execSync} = require('child_process');

const PureObject = require('PureObject');
const Promise = require('Promise');
const Type = require('Type');
const sane = require('sane');

const MAX_WAIT_TIME = 120000;

const type = Type('FileWatcher')

type.inherits(EventEmitter)
type.createInstance(() => new EventEmitter())

type.defineValues({

  _loading: null,

  _watcherByRoot: PureObject.create,

  _watcherClass() {
    try {
      execSync('watchman version', {stdio: 'ignore'});
      return sane.WatchmanWatcher;
    } catch (e) {}
    return sane.NodeWatcher;
  },
})

type.defineMethods({

  watch(config) {
    const promise = this._loading || Promise();
    return this._loading = promise.then(() =>
      this._createWatcher(config)
      .then(watcher => {
        this._watcherByRoot[config.dir] = watcher;
        watcher.on(
          'all',
          // args = (type, filePath, root, stat)
          (...args) => this.emit('all', ...args)
        );
      }));
  },

  isWatchman() {
    return this._watcherClass == sane.WatchmanWatcher;
  },

  getWatchers() {
    return this._loading;
  },

  getWatcherForRoot(root) {
    return this._loading.then(() => this._watcherByRoot[root]);
  },

  end() {
    inited = false;
    return this._loading.then(
      (watchers) => watchers.map(
        watcher => Promise.ify(watcher.close).call(watcher)
      )
    );
  },

  _createWatcher(rootConfig) {
    const watcher = new this._watcherClass(rootConfig.dir, {
      glob: rootConfig.globs,
      dot: false,
    });

    return Promise.defer((resolve, reject) => {
      const rejectTimeout = setTimeout(() => {
        reject(new Error(timeoutMessage(this._watcherClass)));
      }, MAX_WAIT_TIME);

      watcher.once('ready', () => {
        clearTimeout(rejectTimeout);
        resolve(watcher);
      });
    });
  },
})

module.exports = type.build()

//
// Helpers
//

function timeoutMessage(Watcher) {
  const lines = [
    'Watcher took too long to load (' + Watcher.name + ')',
  ];
  if (Watcher === sane.WatchmanWatcher) {
    lines.push(
      'Try running `watchman version` from your terminal',
      'https://facebook.github.io/watchman/docs/troubleshooting.html',
    );
  }
  return lines.join('\n');
}
