/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */
'use strict';

const Cache = require('./Cache');
const Fastfs = require('./fastfs');
const ModuleCache = require('./ModuleCache');
const Promise = require('Promise');
const PureObject = require('PureObject');
const Type = require('Type');

const assert = require('assert');
const crypto = require('crypto');
const docblock = require('./utils/docblock');
const emptyFunction = require('emptyFunction');
const extractRequires = require('./utils/extractRequires');
const fp = require('./fastpath');
const fromArgs = require('fromArgs');
const inArray = require('in-array');
const jsonStableStringify = require('json-stable-stringify');
const sync = require('sync');

const type = Type('Module')

type.defineOptions({
  file: String.isRequired,
  fastfs: Fastfs,
  moduleCache: ModuleCache,
  cache: Cache,
  extractor: Function.withDefault(extractRequires),
  transformCode: Function,
  options: Object,
})

type.initArguments(([options]) => {
  assert(!options.file.startsWith('.'), '\'options.file\' cannot be relative: ' + options.file);
})

type.defineValues({

  type: 'Module',

  path: fromArgs('file'),

  _fastfs: fromArgs('fastfs'),

  _moduleCache: fromArgs('moduleCache'),

  _cache: fromArgs('cache'),

  _extractor: fromArgs('extractor'),

  _transformCode: fromArgs('transformCode'),

  _options: fromArgs('options'),
})

type.defineMethods({

  get(key, factory = emptyFunction) {
    const entry = fp.isAbsolute(this.path)
      ? this.path : fp.sep + 'stub' + fp.sep + this.path;
    return this._cache.get(entry, key, factory);
  },

  isMain() {
    return this.get('isMain', () =>
      this.read().then(data => {
        const pkg = this.getPackage();
        return pkg.getMain()
        .then(mainPath => this.path === mainPath);
      })
    );
  },

  isHaste() {
    return this.get('isHaste', () =>
      this._readDocBlock().then(data => {
        if (!!data.id) {
          return true;
        }
        if (!this._isHasteCompatible()) {
          return false;
        }
        return this.isMain()
        .then(isMain => {
          if (!isMain) {
            return false;
          }
          return this.getPackage()
            .getName()
            .then(name => !!name);
        });
      })
    );
  },

  getCode(transformOptions) {
    return this.read(transformOptions).then(({code}) => code);
  },

  getMap(transformOptions) {
    return this.read(transformOptions).then(({map}) => map);
  },

  getName() {
    return this.get('name', () =>
      this._readDocBlock().then(({id}) => {
        if (id) {
          return id;
        }
        if (!this._isHasteCompatible()) {
          return fp.relative(lotus.path, this.path);
        }
        const pkg = this.getPackage();
        if (!pkg) {
          // Name is full path
          return this.path;
        }
        return this.isMain()
          .then(isMain => pkg.getName().then(name =>
            isMain ? name : fp.relative(lotus.path, this.path)));
      })
    )
  },

  getPackage() {
    return this._moduleCache.getPackageForModule(this);
  },

  readDependencies(transformOptions) {
    return this.read(transformOptions)
      .then(data => data.dependencies);
  },

  read(transformOptions) {
    return this.get(
      cacheKey('moduleData', transformOptions),
      () => {
        const fileContentPromise = this._fastfs.readFile(this.path);
        return Promise.map([
          fileContentPromise,
          this._readDocBlock(fileContentPromise),
        ]).then(([source, {id, moduleDocBlock}]) => {
          // Ignore requires in JSON files or generated code. An example of this
          // is prebuilt files like the SourceMap library.
          const extern = this.isJSON() || 'extern' in moduleDocBlock;
          if (extern) {
            transformOptions = {...transformOptions, extern};
          }
          const transformCode = this._transformCode;
          const codePromise = transformCode
              ? transformCode(this, source, transformOptions)
              : Promise({code: source});
          return codePromise.then(result => {
            const {
              code,
              dependencies = extern ? [] : this._extractor(code).deps.sync,
            } = result;
            if (this._options && this._options.cacheTransformResults === false) {
              return {dependencies};
            } else {
              return {...result, dependencies, id, source};
            }
          });
        });
      }
    );
  },

  hash() {
    return `Module : ${this.path}`;
  },

  isJSON() {
    return fp.extname(this.path) === '.json';
  },

  isAsset() {
    return false;
  },

  isPolyfill() {
    return false;
  },

  isNull() {
    return false;
  },

  toJSON() {
    return {
      hash: this.hash(),
      isJSON: this.isJSON(),
      isAsset: this.isAsset(),
      isAsset_DEPRECATED: this.isAsset_DEPRECATED(),
      type: this.type,
      path: this.path,
    };
  },

  _parseDocBlock(docBlock) {
    // Extract an id for the module if it's using @providesModule syntax
    // and if it's NOT in node_modules (and not a whitelisted node_module).
    // This handles the case where a project may have a dep that has @providesModule
    // docblock comments, but doesn't want it to conflict with whitelisted @providesModule
    // modules, such as react-haste, fbjs-haste, or react-native or with non-dependency,
    // project-specific code that is using @providesModule.
    const moduleDocBlock = docblock.parseAsObject(docBlock);
    const provides = moduleDocBlock.providesModule || moduleDocBlock.provides;

    const id = provides && !/node_modules/.test(this.path)
        ? /^\S+/.exec(provides)[0]
        : undefined;
    return {id, moduleDocBlock};
  },

  _readDocBlock(contentPromise) {
    if (!this._docBlock) {
      if (!contentPromise) {
        contentPromise = this._fastfs.readWhile(this.path, whileInDocBlock);
      }
      this._docBlock = contentPromise
        .then(docBlock => this._parseDocBlock(docBlock));
    }
    return this._docBlock;
  },

  // We don't want 'node_modules' to be haste paths
  // unless the package is a watcher root.
  _isHasteCompatible() {
    const pkg = this.getPackage();
    if (!pkg) {
      return false;
    }
    if (!/node_modules/.test(this.path)) {
      return true;
    }
    return inArray(this._fastfs._roots, pkg.root);
  },
})

module.exports = type.build()

//
// Helpers
//

function whileInDocBlock(chunk, i, result) {
  // consume leading whitespace
  if (!/\S/.test(result)) {
    return true;
  }

  // check for start of doc block
  if (!/^\s*\/(\*{2}|\*?$)/.test(result)) {
    return false;
  }

  // check for end of doc block
  return !/\*\//.test(result);
}

// use weak map to speed up hash creation of known objects
const knownHashes = new WeakMap();
function stableObjectHash(object) {
  let digest = knownHashes.get(object);
  if (!digest) {
    digest = crypto.createHash('md5')
      .update(jsonStableStringify(object))
      .digest('base64');
    knownHashes.set(object, digest);
  }

  return digest;
}

function cacheKey(field, transformOptions) {
  return transformOptions !== undefined
      ? stableObjectHash(transformOptions) + '\0' + field
      : field;
}
