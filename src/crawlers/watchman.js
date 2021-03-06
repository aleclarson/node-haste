'use strict';

const Promise = require('Promise');

const fp = require('../fastpath');
const isDescendant = require('../utils/isDescendant');

const watchmanURL = 'https://facebook.github.io/watchman/docs/troubleshooting.html';

function watchmanRecReadDir(roots, {blacklist, fileWatcher, exts}) {
  const files = [];
  return Promise.map(roots, root => {
    return fileWatcher.getWatcherForRoot(root);
  })
  .then(watchers => {
    // All watchman roots for all watches we have.
    const watchmanRoots = watchers.map(
      watcher => watcher.watchProjectInfo.root
    );

    // Actual unique watchers (because we use watch-project we may end up with
    // duplicate "real" watches, and that's by design).
    // TODO(amasad): push this functionality into the `FileWatcher`.
    const uniqueWatchers = watchers.filter(
      (watcher, i) => watchmanRoots.indexOf(watcher.watchProjectInfo.root) === i
    );

    return Promise.map(uniqueWatchers, watcher => {
      const watchedRoot = watcher.watchProjectInfo.root;

      // Build up an expression to filter the output by the relevant roots.
      const dirExpr = ['anyof'];
      for (let i = 0; i < roots.length; i++) {
        const root = roots[i];
        if (isDescendant(watchedRoot, root)) {
          dirExpr.push(['dirname', fp.relative(watchedRoot, root)]);
        }
      }

      const cmd = Promise.ify(watcher.client.command.bind(watcher.client));
      return cmd(['query', watchedRoot, {
        suffix: exts,
        expression: ['allof', ['type', 'f'], 'exists', dirExpr],
        fields: ['name'],
      }]).then(resp => {
        if ('warning' in resp) {
          console.warn('watchman warning: ', resp.warning);
        }

        resp.files.forEach(filePath => {
          filePath = watchedRoot + fp.sep + filePath;
          if (!blacklist(filePath)) {
            files.push(filePath);
          }
          return false;
        });
      });
    });
  })
  .then(() => files)
  .fail(error => {
    throw new Error(
      `Watchman error: ${error.message.trim()}. Make sure watchman ` +
      `is running for this project. See ${watchmanURL}.`
    );
  });
}

module.exports = watchmanRecReadDir;
