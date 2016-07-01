'use strict';

const Promise = require('Promise');

const Module = require('./Module');
const getAssetDataFromName = require('./utils/getAssetDataFromName');

class AssetModule extends Module {
  constructor(args, platforms) {
    super(args);
    const { resolution, name, type } = getAssetDataFromName(this.path, platforms);
    this.resolution = resolution;
    this._name = name;
    this._type = type;
    this._dependencies = args.dependencies || [];
  }

  isHaste() {
    return Promise(false);
  }

  getDependencies() {
    return Promise(this._dependencies);
  }

  read() {
    return Promise({});
  }

  getName() {
    return super.getName().then(
      id => id.replace(/\/[^\/]+$/, `/${this._name}.${this._type}`)
    );
  }

  hash() {
    return `AssetModule : ${this.path}`;
  }

  isJSON() {
    return false;
  }

  isAsset() {
    return true;
  }
}

module.exports = AssetModule;
