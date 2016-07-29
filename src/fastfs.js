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
const fromArgs = require('fromArgs');
const fs = require('io/sync');
const Promise = require('Promise');
const PureObject = require('PureObject');
const Type = require('Type');

const File = require('./File');
const FileWatcher = require('./FileWatcher');
const fp = require('./fastpath');
const isDescendant = require('./utils/isDescendant');
const matchExtensions = require('./utils/matchExtensions');

const NOT_FOUND_IN_ROOTS = 'NotFoundInRootsError';

const type = Type('Fastfs')

type.inherits(EventEmitter)
type.createInstance(() => new EventEmitter())

type.defineOptions({
  name: String.isRequired,
  roots: Array.isRequired,
  lazyRoots: Array,
  fileWatcher: FileWatcher.isRequired,
  blacklist: Function.withDefault(emptyFunction.thatReturnsFalse),
  crawling: Promise.isRequired,
  activity: Object.Kind.isRequired,
})

type.defineValues({

  _name: fromArgs('name'),

  _roots({ roots }) {
    return this._createRoots(roots);
  },

  _lazyRoots({ lazyRoots }) {
    return this._createLazyRoots(lazyRoots);
  },

  _fileWatcher: fromArgs('fileWatcher'),

  _blacklist: fromArgs('blacklist'),

  _crawling: fromArgs('crawling'),

  _activity: fromArgs('activity'),

  _fastPaths: PureObject.create,
})

type.defineMethods({

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
          const dirname = filePath.substr(0, filePath.lastIndexOf(fp.sep));
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
  },

  stat(filePath) {
    return Promise.try(() => this._getFile(filePath).stat());
  },

  getAllFiles() {
    return Object.keys(this._fastPaths)
      .filter(filePath => !this._fastPaths[filePath].isDir);
  },

  findFilesByExts(exts) {
    return this.getAllFiles()
      .filter(filePath => matchExtensions(exts, filePath));
  },

  matchFilesByPattern(pattern) {
    return this.getAllFiles()
      .filter(filePath => filePath.match(pattern));
  },

  readFile(filePath) {
    const file = this._getFile(filePath);
    if (!file) {
      throw new Error(`Unable to find file with path: ${filePath}`);
    }
    return file.read();
  },

  readWhile(filePath, predicate) {
    const file = this._getFile(filePath);
    if (!file) {
      throw new Error(`Unable to find file with path: ${filePath}`);
    }
    return file.readWhile(predicate);
  },

  closest(filePath, name) {
    for (let file = this._getFile(filePath).parent;
         file;
         file = file.parent) {
      if (file.children[name]) {
        return file.children[name].path;
      }
    }
    return null;
  },

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
  },

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
  },

  matches(dir, pattern) {
    const dirFile = this._getFile(dir);
    if (!dirFile.isDir) {
      throw new Error(`Expected file ${dirFile.path} to be a directory`);
    }

    return Object.keys(dirFile.children)
      .filter(name => name.match(pattern))
      .map(name => fp.join(dirFile.path, name));
  },

  _createRoots(rootPaths, each = emptyFunction) {
    return rootPaths && rootPaths.map(rootPath => {
      // If the path ends in a separator ("/"), remove it to make string
      // operations on paths safer.
      if (rootPath.endsWith(fp.sep)) {
        rootPath = rootPath.substr(0, rootPath.length - 1);
      }

      rootPath = fp.resolve(rootPath);
      const root = new File(rootPath, true);
      each(root);
      return root;
    });
  },

  _createLazyRoots(rootPaths) {
    return this._createRoots(rootPaths, (root) => {
      root.isLazy = true;
    });
  },

  _getRoot(filePath) {
    return this._searchRoots(filePath, this._roots) ||
      this._searchRoots(filePath, this._lazyRoots);
  },

  _searchRoots(filePath, roots) {
    for (let i = 0; i < roots.length; i++) {
      let root = roots[i];
      if (isDescendant(root.path, filePath)) {
        return root;
      }
    }
    return null;
  },

  _getAndAssertRoot(filePath) {
    const root = this._getRoot(filePath);
    if (!root) {
      const error = new Error(`File '${filePath}' not found in any of the roots`);
      error.type = NOT_FOUND_IN_ROOTS;
      throw error;
    }
    return root;
  },

  _getFile(filePath) {
    filePath = fp.resolve(filePath);

    let file = this._fastPaths[filePath];
    if (!file) {
      const root = this._getAndAssertRoot(filePath);
      if (!root.isLazy) {
        file = root.getFileFromPath(filePath);
      } else if (fs.isFile(filePath)) {
        file = this._addChild(root, filePath);
      } else {
        console.log(`File does not exist: '${filePath}'`);
      }
    }

    return file;
  },

  _processFileChange(type, relPath, rootPath, fstat) {
    const filePath = fp.resolve(rootPath, relPath);
    if (this._blacklist(filePath)) { return }
    if (fstat && fstat.isDirectory()) { return }

    const root = this._getRoot(filePath);
    if (!root) { return }

    let file = this._fastPaths[filePath];
    if (file && type !== 'add') {
      file.remove();
      delete this._fastPaths[filePath];
    }

    if (type !== 'delete') {
      file = this._addChild(root, filePath);
    }

    log.moat(1);
    log.white(type, ' ');
    log.yellow(lotus.relative(filePath));
    log.moat(1);
    this.emit('change', type, relPath, rootPath, fstat);
  },

  _addChild(root, filePath) {
    const parts = fp.relative(root.path, filePath).split(fp.sep);
    const numParts = parts.length;
    let parent = root;
    for (let i = 0; i < numParts; i++) {
      let nextPath = parent.path + "/" + parts[i];
      let nextFile = root.getFileFromPath(nextPath);
      if (nextFile == null) {
        let isDir = i < numParts - 1;
        let isValid = isDir ? fs.isDir : fs.isFile;
        if (!isValid(nextPath)) {
          let fileType = isDir ? 'directory' : 'file';
          let error = Error('"' + nextPath + '" is not a ' + fileType + ' that exists.');
          error.type = NOT_FOUND_IN_ROOTS;
          throw error;
        }

        nextFile = new File(nextPath, isDir);
        nextFile.parent = parent;

        if (isDir) {
          let filename = 'package.json';
          let pkgJsonPath = fp.join(nextPath, filename);
          if (fs.isFile(pkgJsonPath)) {
            let pkgJson = new File(pkgJsonPath, false);
            pkgJson.parent = nextFile;
            nextFile.children[filename] = pkgJson;
            this._fastPaths[pkgJsonPath] = pkgJson;
          }
        } else {
          let filename = fp.basename(nextPath);
          parent.children[filename] = nextFile;
          this._fastPaths[nextPath] = nextFile;
        }
      }
      if (nextFile.isDir) {
        parent = nextFile;
      } else {
        return nextFile;
      }
    }
  },
})

module.exports = type.build()
