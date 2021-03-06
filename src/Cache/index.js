/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */
'use strict';

const crypto = require('crypto');
const fp = require('../fastpath');
const fs = require('io');
const has = require('has');
const os = require('os');
const Promise = require('Promise');
const Type = require('Type');

const type = Type('Cache');

type.defineOptions({
  resetCache: Boolean.withDefault(false),
  cacheKey: String,
  cacheDirectory: String.withDefault(os.tmpDir()),
})

type.defineValues({
  _cacheFilePath(options) {
    return Cache.getCacheFilePath(
      options.cacheDirectory,
      options.cacheKey,
    );
  },
  _data(options) {
    return options.resetCache ?
      Object.create(null) :
      this._loadCacheSync(this._cacheFilePath);
  },
  _persistEventually() {
    return debounce(
      this._persistCache.bind(this),
      2000,
    );
  },
})

type.defineMethods({

  get(filepath, field, loaderCb) {
    if (!fp.isAbsolute(filepath)) {
      throw new Error('Use absolute paths');
    }

    return this.has(filepath, field)
      ? this._data[filepath].data[field]
      : this.set(filepath, field, loaderCb(filepath));
  },

  invalidate(filepath, field) {
    if (this.has(filepath, field)) {
      if (field == null) {
        delete this._data[filepath];
      } else {
        delete this._data[filepath].data[field];
      }
    }
  },

  end() {
    return this._persistCache();
  },

  has(filepath, field) {
    return has(this._data, filepath) &&
      (field == null || has(this._data[filepath].data, field));
  },

  set(filepath, field, loaderPromise) {
    let record = this._data[filepath];
    if (!record) {
      record = Object.create(null);
      this._data[filepath] = record;
      this._data[filepath].data = Object.create(null);
      this._data[filepath].metadata = Object.create(null);
    }

    record.data[field] = loaderPromise
      .then(data => Promise.map([
        data,
        fs.async.stats(filepath),
      ]))
      .then(([data, stat]) => {
        this._persistEventually();

        // Evict all existing field data from the cache if we're putting new
        // more up to date data
        var mtime = stat.mtime.getTime();
        if (record.metadata.mtime !== mtime) {
          record.data = Object.create(null);
        }
        record.metadata.mtime = mtime;

        return data;
      });

    return record.data[field];
  },

  _persistCache() {
    if (this._persisting != null) {
      return this._persisting;
    }

    const data = this._data;
    const cacheFilepath = this._cacheFilePath;

    this._persisting = Promise.map(getObjectValues(data), (record) => {
      const fieldNames = Object.keys(record.data);
      const fieldValues = getObjectValues(record.data);

      return Promise
      .map(fieldValues)
      .then(ref => {
        const ret = Object.create(null);
        ret.metadata = record.metadata;
        ret.data = Object.create(null);
        fieldNames.forEach((field, index) =>
          ret.data[field] = ref[index]
        );

        return ret;
      });
    })
    .then(values => {
      const json = Object.create(null);

      Object.keys(data).forEach((key, i) => {
        // make sure the key wasn't added nor removed after we started
        // persisting the cache
        const value = values[i];
        if (!value) {
          return;
        }

        json[key] = Object.create(null);
        json[key].metadata = data[key].metadata;
        json[key].data = value.data;
      });

      return fs.async.write(
        cacheFilepath,
        JSON.stringify(json)
      )

      .fail(error => {
        log.moat(1);
        log.red(cacheFilepath);
        log.moat(1);
        log.red('Error: ');
        log.white('Failed to persist cache!');
        log.moat(0);
        log.gray.dim(error.stack);
        log.moat(1);
      })

      .always(() => {
        this._persisting = null;
      });
    });

    return this._persisting;
  },

  _loadCacheSync(cachePath) {
    var ret = Object.create(null);
    var cacheOnDisk = Cache.loadCacheSync(cachePath);

    // Filter outdated cache and convert to promises.
    Object.keys(cacheOnDisk).forEach(key => {
      if (!fs.sync.isFile(key)) {
        return;
      }
      var record = cacheOnDisk[key];
      var stat = fs.sync.stats(key);
      if (stat.mtime.getTime() === record.metadata.mtime) {
        ret[key] = Object.create(null);
        ret[key].metadata = Object.create(null);
        ret[key].data = Object.create(null);
        ret[key].metadata.mtime = record.metadata.mtime;

        Object.keys(record.data).forEach(field => {
          ret[key].data[field] = Promise(record.data[field]);
        });
      }
    });

    return ret;
  },
})

type.defineStatics({

  getCacheFilePath(tmpdir, ...args) {
    const hash = crypto.createHash('md5');
    args.forEach(arg => hash.update(arg));
    return fp.join(tmpdir, hash.digest('hex'));
  },

  loadCacheSync(cachePath) {
    if (!fs.sync.exists(cachePath)) {
      return Object.create(null);
    }

    try {
      return JSON.parse(fs.sync.read(cachePath));
    } catch (e) {
      if (e instanceof SyntaxError) {
        console.warn('Unable to parse cache file. Will clear and continue.');
        try {
          fs.sync.remove(cachePath);
        } catch (err) {
          // Someone else might've deleted it.
        }
        return Object.create(null);
      }
      throw e;
    }
  },
})

const Cache = type.build();
module.exports = Cache;

//
// Helpers
//

function getObjectValues(object) {
  return Object.keys(object).map(key => object[key]);
}

function debounce(fn, delay) {
  var timeout;
  return () => {
    clearTimeout(timeout);
    timeout = setTimeout(fn, delay);
  };
}
