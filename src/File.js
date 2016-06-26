/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */
'use strict';

const denodeify = require('denodeify');
const fs = require('graceful-fs');
const path = require('./fastpath');
const readWhile = require('./lib/readWhile');

const readFile = denodeify(fs.readFile);
const stat = denodeify(fs.stat);

class File {
  constructor(filePath, isDir) {
    this.path = filePath;
    this.isDir = isDir;
    this.children = this.isDir ? Object.create(null) : null;
  }

  read() {
    if (!this._read) {
      this._read = readFile(this.path, 'utf8');
    }
    return this._read;
  }

  readWhile(predicate) {
    return readWhile(this.path, predicate).then(({result, completed}) => {
      if (completed && !this._read) {
        this._read = Promise.resolve(result);
      }
      return result;
    });
  }

  stat() {
    if (!this._stat) {
      this._stat = stat(this.path);
    }

    return this._stat;
  }

  addChild(file, fileMap) {
    const parts = file.path.substr(this.path.length + 1).split(path.sep);
    if (parts.length === 1) {
      this.children[parts[0]] = file;
      file.parent = this;
    } else if (this.children[parts[0]]) {
      this.children[parts[0]].addChild(file, fileMap);
    } else {
      const dir = new File(this.path + path.sep + parts[0], true);
      dir.parent = this;
      this.children[parts[0]] = dir;
      fileMap[dir.path] = dir;
      dir.addChild(file, fileMap);
    }
  }

  getFileFromPath(filePath) {
    const parts = path.relative(this.path, filePath).split(path.sep);

    /*eslint consistent-this:0*/
    let file = this;
    for (let i = 0; i < parts.length; i++) {
      const fileName = parts[i];
      if (!fileName) {
        continue;
      }

      if (!file || !file.isDir) {
        // File not found.
        return null;
      }

      file = file.children[fileName];
    }

    return file;
  }

  ext() {
    return path.extname(this.path).substr(1);
  }

  remove() {
    if (!this.parent) {
      throw new Error(`No parent to delete ${this.path} from`);
    }

    delete this.parent.children[path.basename(this.path)];
  }
}
