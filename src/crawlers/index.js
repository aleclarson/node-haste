'use strict';

const Promise = require('Promise');

const nodeCrawl = require('./node');
const watchmanCrawl = require('./watchman');

function crawl(roots, options) {
  const {fileWatcher} = options;
  return (fileWatcher ? fileWatcher.isWatchman() : Promise(false)).then(
    isWatchman => isWatchman ? watchmanCrawl(roots, options) : nodeCrawl(roots, options)
  );
}

module.exports = crawl;
