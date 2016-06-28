/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */
'use strict';

const fs = require('graceful-fs');

module.exports = readWhile;

function readWhile(filePath, predicate) {
  return new Promise((resolve, reject) => {
    fs.open(filePath, 'r', (openError, fd) => {
      if (openError) {
        reject(openError);
        return;
      }

      read(
        fd,
        /*global Buffer: true*/
        new Buffer(512),
        makeReadCallback(fd, predicate, (readError, result, completed) => {
          if (readError) {
            reject(readError);
          } else {
            resolve({result, completed});
          }
        })
      );
    });
  });
}

function read(fd, buffer, callback) {
  fs.read(fd, buffer, 0, buffer.length, -1, callback);
}

function close(fd, error, result, complete, callback) {
  fs.close(fd, closeError => callback(error || closeError, result, complete));
}

function makeReadCallback(fd, predicate, callback) {
  let result = '';
  let index = 0;
  return function readCallback(error, bytesRead, buffer) {
    if (error) {
      close(fd, error, undefined, false, callback);
      return;
    }

    const completed = bytesRead === 0;
    const chunk = completed ? '' : buffer.toString('utf8', 0, bytesRead);
    result += chunk;
    if (completed || !predicate(chunk, index++, result)) {
      close(fd, null, result, completed, callback);
    } else {
      read(fd, buffer, readCallback);
    }
  };
}
