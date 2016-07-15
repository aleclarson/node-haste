/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */
'use strict';

const getAssetDataFromName = require('./utils/getAssetDataFromName');
const matchExtensions = require('./utils/matchExtensions');
const path = require('path');

class AssetMap {
  constructor({
    extensions,
    fastfs,
  }) {
    this.extensions = extensions;
    this._fastfs = fastfs;
    this._assets = Object.create(null);
  }

  build() {
    this._fastfs.findFilesByExts(this.extensions)
    .forEach((assetPath) => {
      const asset = getAssetDataFromName(assetPath);
      const assetKey = getAssetKey(asset.name + '.' + asset.type, asset.platform);

      let record = this._assets[assetKey];
      if (!record) {
        record = this._assets[assetKey] = {
          scales: [],
          files: [],
        };
      }

      let insertIndex;
      const length = record.scales.length;

      for (insertIndex = 0; insertIndex < length; insertIndex++) {
        if (asset.resolution <  record.scales[insertIndex]) {
          break;
        }
      }
      record.scales.splice(insertIndex, 0, asset.resolution);
      record.files.splice(insertIndex, 0, assetPath);
    });
  }

  resolve(assetPath, platform) {

    if (path.isAbsolute(assetPath)) {
      if (!matchExtensions(this.extensions, assetPath)) {
        return;
      }

      const dirname = path.dirname(assetPath);
      if (!this._fastfs.dirExists(dirname)) {
        log.moat(1)
        log.white('Error: ')
        log.red(`Directory '${dirname}' does not exist!`)
        log.moat(1);
        return;
      }

      const asset = getAssetDataFromName(assetPath);

      let pattern = '^' + asset.name + '(@[\\d\\.]+x)?';
      if (asset.platform != null) {
        pattern += '(\\.' + asset.platform + ')?';
      }
      pattern += '\\.' + asset.type;

      const matches = this._fastfs.matches(
        dirname,
        new RegExp(pattern)
      );

      // We arbitrarily grab the first one,
      // because scale selection is done client-side.
      if (matches[0]) {
        return matches[0];
      }

      log.moat(1);
      log.red('Error: ');
      log.white(`Asset '${assetPath}' does not exist!`);
      log.moat(1);
    }

    if (assetPath.startsWith('image!')) {
      let assetName = assetPath.substr(6);
      if (!matchExtensions(this.extensions, assetPath)) {
        assetName += '.png';
      }

      let assetKey = getAssetKey(assetName, platform);
      let asset = this._assets[assetKey];
      if (!asset) {
        assetKey = getAssetKey(assetName);
        asset = this._assets[assetKey];
      }

      // We arbitrarily grab the first one,
      // because scale selection is done client-side.
      if (asset) {
        return asset.files[0];
      }

      log.moat(1);
      log.red('Error: ');
      log.white(`Asset '${assetName}' does not exist!`);
      log.moat(1);
    }
  }
}

function getAssetKey(assetName, platform) {
  if (platform != null) {
    return `${assetName} : ${platform}`;
  } else {
    return assetName;
  }
}

module.exports = AssetMap;
