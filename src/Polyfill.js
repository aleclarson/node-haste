'use strict';

const path = require('path');
const lotus = require('lotus-require');
const Module = require('./Module');

class Polyfill extends Module {
  constructor(options) {
    super(options);
    this._id = options.id;
    this._dependencies = options.dependencies;
  }

  isHaste() {
    return Promise(false);
  }

  getName() {
    return Promise.try(() => {
      if (path.isAbsolute(this._id)) {
        return lotus.relative(this._id);
      }
      return this._id;
    });
  }

  getPackage() {
    return null;
  }

  getDependencies() {
    return Promise(this._dependencies);
  }

  isJSON() {
    return false;
  }

  isPolyfill() {
    return true;
  }
}

module.exports = Polyfill;
