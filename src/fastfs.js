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
const emptyFunction = require('emptyFunction');

const File = require('./File');
const path = require('./fastpath');
const isDescendant = require('./utils/isDescendant');
const matchExtensions = require('./utils/matchExtensions');

const NOT_FOUND_IN_ROOTS = 'NotFoundInRootsError';

class Fastfs extends EventEmitter {
  constructor(name, {
    roots,
    lazyRoots,
    fileWatcher,
    ignoreFilePath = emptyFunction.thatReturnsFalse,
    crawling,
    activity,
  }) {
    super();
    this._name = name;
    this._roots = this._createRoots(roots);
    this._lazyRoots = this._createLazyRoots(lazyRoots);
    this._fileWatcher = fileWatcher;
    this._ignoreFilePath = ignoreFilePath;
    this._crawling = crawling;
    this._activity = activity;
    this._fastPaths = Object.create(null);
  }

  build() {
    return this._crawling.then(files => {
      let fastfsActivity;
      const activity = this._activity;
      if (activity) {
        fastfsActivity = activity.startEvent(this._name);
      }
      files.forEach(filePath => {
        const root = this._getRoot(filePath);
        if (root) {
          const newFile = new File(filePath, false);
          const dirname = filePath.substr(0, filePath.lastIndexOf(path.sep));
          const parent = this._fastPaths[dirname];
          this._fastPaths[filePath] = newFile;
          if (parent) {
            parent.addChild(newFile, this._fastPaths);
          } else {
            root.addChild(newFile, this._fastPaths);
          }
        }
      });
      if (activity) {
        activity.endEvent(fastfsActivity);
      }

      if (this._fileWatcher) {
        this._fileWatcher.on('all', this._processFileChange.bind(this));
      }
    });
  }

  stat(filePath) {
    return Promise.try(() => this._getFile(filePath).stat());
  }

  getAllFiles() {
    return Object.keys(this._fastPaths)
      .filter(filePath => !this._fastPaths[filePath].isDir);
  }

  findFilesByExts(exts, { ignoreFilePath } = {}) {
    return this.getAllFiles().filter(filePath =>
      matchExtensions(exts, filePath) && !ignoreFilePath(filePath));
  }

  matchFilesByPattern(pattern) {
    return this.getAllFiles().filter(file => file.match(pattern));
  }

  readFile(filePath) {
    const file = this._getFile(filePath);
    if (!file) {
      throw new Error(`Unable to find file with path: ${filePath}`);
    }
    return file.read();
  }

  readWhile(filePath, predicate) {
    const file = this._getFile(filePath);
    if (!file) {
      throw new Error(`Unable to find file with path: ${filePath}`);
    }
    return file.readWhile(predicate);
  }

  closest(filePath, name) {
    for (let file = this._getFile(filePath).parent;
         file;
         file = file.parent) {
      if (file.children[name]) {
        return file.children[name].path;
      }
    }
    return null;
  }

  fileExists(filePath) {
    let file;
    try {
      file = this._getFile(filePath);
    } catch (e) {
      if (e.type === NOT_FOUND_IN_ROOTS) {
        return false;
      }
      throw e;
    }

    return file && !file.isDir;
  }

  dirExists(filePath) {
    let file;
    try {
      file = this._getFile(filePath);
    } catch (e) {
      if (e.type === NOT_FOUND_IN_ROOTS) {
        return false;
      }
      throw e;
    }

    return file && file.isDir;
  }

  matches(dir, pattern) {
    const dirFile = this._getFile(dir);
    if (!dirFile.isDir) {
      throw new Error(`Expected file ${dirFile.path} to be a directory`);
    }

    return Object.keys(dirFile.children)
      .filter(name => name.match(pattern))
      .map(name => path.join(dirFile.path, name));
  }

  _createRoots(rootPaths, each = emptyFunction) {
    return rootPaths && rootPaths.map(rootPath => {
      // If the path ends in a separator ("/"), remove it to make string
      // operations on paths safer.
      if (rootPath.endsWith(path.sep)) {
        rootPath = rootPath.substr(0, rootPath.length - 1);
      }

      rootPath = path.resolve(rootPath);
      const root = new File(rootPath, true);
      each(root);
      return root;
    });
  }

  _createLazyRoots(rootPaths) {
    return this._createRoots(rootPaths, (root) => {
      root.isLazy = true;
    });
  }

  _getRoot(filePath) {
    return this._searchRoots(filePath, this._roots) ||
      this._searchRoots(filePath, this._lazyRoots);
  }

  _searchRoots(filePath, roots) {
    for (let i = 0; i < roots.length; i++) {
      let root = roots[i];
      if (isDescendant(root.path, filePath)) {
        return root;
      }
    }
    return null;
  }

  _getAndAssertRoot(filePath) {
    const root = this._getRoot(filePath);
    if (!root) {
      const error = new Error(`File '${filePath}' not found in any of the roots`);
      error.type = NOT_FOUND_IN_ROOTS;
      throw error;
    }
    return root;
  }

  _getFile(filePath) {
    filePath = path.resolve(filePath);
    if (!this._fastPaths[filePath]) {
      const root = this._getAndAssertRoot(filePath);
      if (this._ignoreFilePath(filePath)) {
        this._fastPaths[filePath] = root.getFileFromPath(filePath);
      } else {
        this._fastPaths[filePath] = root._createFileFromPath(filePath);
      }
    }

    return this._fastPaths[filePath];
  }

  _processFileChange(type, filePath, rootPath, fstat) {
    const absPath = path.resolve(rootPath, filePath);
    if (this._ignoreFilePath(absPath)) { return }
    if (fstat && fstat.isDirectory()) { return }

    const root = this._getRoot(absPath);
    if (!root) { return }

    if (type === 'add') {
      try {
        const file = this._getFile(absPath);
      } catch(error) {
        if (error.code !== NOT_FOUND_IN_ROOTS) {
          throw error;
        }
      }
    } else {
      const file = this._fastPaths[absPath];
      if (file) {
        file.remove();
        delete this._fastPaths[absPath];
      }
    }

    if (type !== 'delete') {
      const file = new File(absPath, false);
      root.addChild(file, this._fastPaths);
    }

    log.moat(1);
    log.white(type, ' ');
    log.yellow(lotus.relative(absPath));
    log.moat(1);
    this.emit('change', type, filePath, rootPath, fstat);
  }
}

module.exports = Fastfs;
