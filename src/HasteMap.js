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

const fp = require('./fastpath');
const matchExtensions = require('./utils/matchExtensions');
const getPlatformExtension = require('./utils/getPlatformExtension');

const GENERIC_PLATFORM = 'generic';
const NATIVE_PLATFORM = 'native';
const PACKAGE_JSON = fp.sep + 'package.json';

class HasteMap {
  constructor({
    projectExts,
    fastfs,
    moduleCache,
    ignoreFilePath,
    preferNativePlatform,
    platforms,
  }) {
    this._projectExts = projectExts;
    this._fastfs = fastfs;
    this._moduleCache = moduleCache;
    this._ignoreFilePath = ignoreFilePath;
    this._preferNativePlatform = preferNativePlatform;
    this._platforms = platforms;
  }

  build() {
    this._map = Object.create(null);
    return Promise.map(this._fastfs.getAllFiles(), (filePath) => {
      if (this._ignoreFilePath(filePath)) { return }
      if (matchExtensions(this._projectExts, filePath)) {
        return this._processHasteModule(filePath);
      } else if (filePath.endsWith(PACKAGE_JSON)) {
        return this._processHastePackage(filePath);
      }
    }).then(() => this._map);
  }

  processFileChange(type, absPath) {
    return Promise.try(() => {
      /*eslint no-labels: 0 */
      if (type === 'delete' || type === 'change') {
        loop: for (const name in this._map) {
          const modulesMap = this._map[name];
          for (const platform in modulesMap) {
            const module = modulesMap[platform];
            if (module.path === absPath) {
              delete modulesMap[platform];
              break loop;
            }
          }
        }

        if (type === 'delete') {
          return null;
        }
      }

      if (matchExtensions(this._projectExts, absPath)) {
        if (fp.basename(absPath) === 'package.json') {
          return this._processHastePackage(absPath);
        } else {
          return this._processHasteModule(absPath);
        }
      }
    });
  }

  getModule(name, platform = null) {
    const modulesMap = this._map[name];
    if (modulesMap == null) {
      return null;
    }

    // If platform is 'ios', we prefer .ios.js to .native.js which we prefer to
    // a plain .js file.
    let module = undefined;
    if (module == null && platform != null) {
      module = modulesMap[platform];
    }
    if (module == null && this._preferNativePlatform) {
      module = modulesMap[NATIVE_PLATFORM];
    }
    if (module == null) {
      module = modulesMap[GENERIC_PLATFORM];
    }
    return module;
  }

  _processHasteModule(file) {
    const module = this._moduleCache.getModule(file);
    return module.isHaste().then(
      isHaste => isHaste && module.getName()
        .then(name => this._updateHasteMap(name, module))
    );
  }

  _processHastePackage(file) {
    file = fp.resolve(file);
    const pkg = this._moduleCache.getPackage(file);
    return pkg.isHaste()
      .then(isHaste =>
        isHaste && pkg.getName().then(name =>
          this._updateHasteMap(name, pkg)))
      .fail(e => {
        if (e instanceof SyntaxError) {
          // Malformed package.json.
          return;
        }
        throw e;
      });
  }

  _updateHasteMap(name, mod) {
    if (this._map[name] == null) {
      this._map[name] = Object.create(null);
    }

    const moduleMap = this._map[name];
    const modulePlatform = getPlatformExtension(mod.path, this._platforms) || GENERIC_PLATFORM;
    const existingModule = moduleMap[modulePlatform];

    if (existingModule && existingModule.path !== mod.path) {
      // Force modules to override their packages.
      if (existingModule.type === 'Package') {
        if (mod.type === 'Module') {
          moduleMap[modulePlatform] = mod;
          return;
        }
      }
      throw new Error(
        `@providesModule naming collision:\n` +
        `  Duplicate module name: ${name}\n` +
        `  Paths: ${mod.path} collides with ${existingModule.path}\n\n` +
        `This error is caused by a @providesModule declaration ` +
        `with the same name across two different files.`
      );
    }

    moduleMap[modulePlatform] = mod;
  }
}

module.exports = HasteMap;
