'use strict';

const debug = require('debug')('ReactNativePackager:DependencyGraph');

const Promise = require('Promise');
const fs = require('io');

const path = require('../fastpath');

function nodeRecReadDir(roots, {ignoreFilePath, extensions}) {
  const queue = roots.slice();
  const retFiles = [];
  const extPattern = new RegExp(
    '\.(' + extensions.join('|') + ')$'
  );

  function search() {
    const currDir = queue.shift();
    if (!currDir) {
      return Promise();
    }

    return fs.async.readDir(currDir)
      .then(files => files.map(f => path.join(currDir, f)))
      .then(files => {
        return Promise.map(f =>
          fs.async.stats(f).fail(handleBrokenLink)
        ).then(stats => [
          // Remove broken links.
          files.filter((file, i) => !!stats[i]),
          stats.filter(Boolean),
        ])
      })
      .then(([files, stats]) => {
        files.forEach((filePath, i) => {
          if (ignoreFilePath(filePath)) {
            return;
          }

          if (stats[i].isDirectory()) {
            queue.push(filePath);
            return;
          }

          if (filePath.match(extPattern)) {
            retFiles.push(path.resolve(filePath));
          }
        });

        return search();
      });
  }

  return search().then(() => retFiles);
}

function handleBrokenLink(e) {
  debug('WARNING: error stating, possibly broken symlink', e.message);
  return Promise();
}

module.exports = nodeRecReadDir;
