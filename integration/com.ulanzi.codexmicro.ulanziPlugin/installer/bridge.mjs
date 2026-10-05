import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __commonJS = (cb, mod) => function __require2() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// ../../node_modules/ws/lib/constants.js
var require_constants = __commonJS({
  "../../node_modules/ws/lib/constants.js"(exports, module) {
    "use strict";
    var BINARY_TYPES = ["nodebuffer", "arraybuffer", "fragments"];
    var hasBlob = typeof Blob !== "undefined";
    if (hasBlob) BINARY_TYPES.push("blob");
    module.exports = {
      BINARY_TYPES,
      CLOSE_TIMEOUT: 3e4,
      EMPTY_BUFFER: Buffer.alloc(0),
      GUID: "258EAFA5-E914-47DA-95CA-C5AB0DC85B11",
      hasBlob,
      kForOnEventAttribute: Symbol("kIsForOnEventAttribute"),
      kListener: Symbol("kListener"),
      kStatusCode: Symbol("status-code"),
      kWebSocket: Symbol("websocket"),
      NOOP: () => {
      }
    };
  }
});

// ../../node_modules/ws/lib/buffer-util.js
var require_buffer_util = __commonJS({
  "../../node_modules/ws/lib/buffer-util.js"(exports, module) {
    "use strict";
    var { EMPTY_BUFFER } = require_constants();
    var FastBuffer = Buffer[Symbol.species];
    function concat(list, totalLength) {
      if (list.length === 0) return EMPTY_BUFFER;
      if (list.length === 1) return list[0];
      const target = Buffer.allocUnsafe(totalLength);
      let offset = 0;
      for (let i = 0; i < list.length; i++) {
        const buf = list[i];
        target.set(buf, offset);
        offset += buf.length;
      }
      if (offset < totalLength) {
        return new FastBuffer(target.buffer, target.byteOffset, offset);
      }
      return target;
    }
    function _mask(source, mask, output, offset, length) {
      for (let i = 0; i < length; i++) {
        output[offset + i] = source[i] ^ mask[i & 3];
      }
    }
    function _unmask(buffer, mask) {
      for (let i = 0; i < buffer.length; i++) {
        buffer[i] ^= mask[i & 3];
      }
    }
    function toArrayBuffer(buf) {
      if (buf.length === buf.buffer.byteLength) {
        return buf.buffer;
      }
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
    }
    function toBuffer(data) {
      toBuffer.readOnly = true;
      if (Buffer.isBuffer(data)) return data;
      let buf;
      if (data instanceof ArrayBuffer) {
        buf = new FastBuffer(data);
      } else if (ArrayBuffer.isView(data)) {
        buf = new FastBuffer(data.buffer, data.byteOffset, data.byteLength);
      } else {
        buf = Buffer.from(data);
        toBuffer.readOnly = false;
      }
      return buf;
    }
    module.exports = {
      concat,
      mask: _mask,
      toArrayBuffer,
      toBuffer,
      unmask: _unmask
    };
    if (!process.env.WS_NO_BUFFER_UTIL) {
      try {
        const bufferUtil = __require("bufferutil");
        module.exports.mask = function(source, mask, output, offset, length) {
          if (length < 48) _mask(source, mask, output, offset, length);
          else bufferUtil.mask(source, mask, output, offset, length);
        };
        module.exports.unmask = function(buffer, mask) {
          if (buffer.length < 32) _unmask(buffer, mask);
          else bufferUtil.unmask(buffer, mask);
        };
      } catch (e) {
      }
    }
  }
});

// ../../node_modules/ws/lib/limiter.js
var require_limiter = __commonJS({
  "../../node_modules/ws/lib/limiter.js"(exports, module) {
    "use strict";
    var kDone = Symbol("kDone");
    var kRun = Symbol("kRun");
    var Limiter = class {
      /**
       * Creates a new `Limiter`.
       *
       * @param {Number} [concurrency=Infinity] The maximum number of jobs allowed
       *     to run concurrently
       */
      constructor(concurrency) {
        this[kDone] = () => {
          this.pending--;
          this[kRun]();
        };
        this.concurrency = concurrency || Infinity;
        this.jobs = [];
        this.pending = 0;
      }
      /**
       * Adds a job to the queue.
       *
       * @param {Function} job The job to run
       * @public
       */
      add(job) {
        this.jobs.push(job);
        this[kRun]();
      }
      /**
       * Removes a job from the queue and runs it if possible.
       *
       * @private
       */
      [kRun]() {
        if (this.pending === this.concurrency) return;
        if (this.jobs.length) {
          const job = this.jobs.shift();
          this.pending++;
          job(this[kDone]);
        }
      }
    };
    module.exports = Limiter;
  }
});

// ../../node_modules/ws/lib/permessage-deflate.js
var require_permessage_deflate = __commonJS({
  "../../node_modules/ws/lib/permessage-deflate.js"(exports, module) {
    "use strict";
    var zlib = __require("zlib");
    var bufferUtil = require_buffer_util();
    var Limiter = require_limiter();
    var { kStatusCode } = require_constants();
    var FastBuffer = Buffer[Symbol.species];
    var TRAILER = Buffer.from([0, 0, 255, 255]);
    var kPerMessageDeflate = Symbol("permessage-deflate");
    var kTotalLength = Symbol("total-length");
    var kCallback = Symbol("callback");
    var kBuffers = Symbol("buffers");
    var kError = Symbol("error");
    var zlibLimiter;
    var PerMessageDeflate2 = class {
      /**
       * Creates a PerMessageDeflate instance.
       *
       * @param {Object} [options] Configuration options
       * @param {(Boolean|Number)} [options.clientMaxWindowBits] Advertise support
       *     for, or request, a custom client window size
       * @param {Boolean} [options.clientNoContextTakeover=false] Advertise/
       *     acknowledge disabling of client context takeover
       * @param {Number} [options.concurrencyLimit=10] The number of concurrent
       *     calls to zlib
       * @param {Boolean} [options.isServer=false] Create the instance in either
       *     server or client mode
       * @param {Number} [options.maxPayload=0] The maximum allowed message length
       * @param {(Boolean|Number)} [options.serverMaxWindowBits] Request/confirm the
       *     use of a custom server window size
       * @param {Boolean} [options.serverNoContextTakeover=false] Request/accept
       *     disabling of server context takeover
       * @param {Number} [options.threshold=1024] Size (in bytes) below which
       *     messages should not be compressed if context takeover is disabled
       * @param {Object} [options.zlibDeflateOptions] Options to pass to zlib on
       *     deflate
       * @param {Object} [options.zlibInflateOptions] Options to pass to zlib on
       *     inflate
       */
      constructor(options) {
        this._options = options || {};
        this._threshold = this._options.threshold !== void 0 ? this._options.threshold : 1024;
        this._maxPayload = this._options.maxPayload | 0;
        this._isServer = !!this._options.isServer;
        this._deflate = null;
        this._inflate = null;
        this.params = null;
        if (!zlibLimiter) {
          const concurrency = this._options.concurrencyLimit !== void 0 ? this._options.concurrencyLimit : 10;
          zlibLimiter = new Limiter(concurrency);
        }
      }
      /**
       * @type {String}
       */
      static get extensionName() {
        return "permessage-deflate";
      }
      /**
       * Create an extension negotiation offer.
       *
       * @return {Object} Extension parameters
       * @public
       */
      offer() {
        const params = {};
        if (this._options.serverNoContextTakeover) {
          params.server_no_context_takeover = true;
        }
        if (this._options.clientNoContextTakeover) {
          params.client_no_context_takeover = true;
        }
        if (this._options.serverMaxWindowBits) {
          params.server_max_window_bits = this._options.serverMaxWindowBits;
        }
        if (this._options.clientMaxWindowBits) {
          params.client_max_window_bits = this._options.clientMaxWindowBits;
        } else if (this._options.clientMaxWindowBits == null) {
          params.client_max_window_bits = true;
        }
        return params;
      }
      /**
       * Accept an extension negotiation offer/response.
       *
       * @param {Array} configurations The extension negotiation offers/reponse
       * @return {Object} Accepted configuration
       * @public
       */
      accept(configurations) {
        configurations = this.normalizeParams(configurations);
        this.params = this._isServer ? this.acceptAsServer(configurations) : this.acceptAsClient(configurations);
        return this.params;
      }
      /**
       * Releases all resources used by the extension.
       *
       * @public
       */
      cleanup() {
        if (this._inflate) {
          this._inflate.close();
          this._inflate = null;
        }
        if (this._deflate) {
          const callback = this._deflate[kCallback];
          this._deflate.close();
          this._deflate = null;
          if (callback) {
            callback(
              new Error(
                "The deflate stream was closed while data was being processed"
              )
            );
          }
        }
      }
      /**
       *  Accept an extension negotiation offer.
       *
       * @param {Array} offers The extension negotiation offers
       * @return {Object} Accepted configuration
       * @private
       */
      acceptAsServer(offers) {
        const opts = this._options;
        const accepted = offers.find((params) => {
          if (opts.serverNoContextTakeover === false && params.server_no_context_takeover || params.server_max_window_bits && (opts.serverMaxWindowBits === false || typeof opts.serverMaxWindowBits === "number" && opts.serverMaxWindowBits > params.server_max_window_bits) || typeof opts.clientMaxWindowBits === "number" && !params.client_max_window_bits) {
            return false;
          }
          return true;
        });
        if (!accepted) {
          throw new Error("None of the extension offers can be accepted");
        }
        if (opts.serverNoContextTakeover) {
          accepted.server_no_context_takeover = true;
        }
        if (opts.clientNoContextTakeover) {
          accepted.client_no_context_takeover = true;
        }
        if (typeof opts.serverMaxWindowBits === "number") {
          accepted.server_max_window_bits = opts.serverMaxWindowBits;
        }
        if (typeof opts.clientMaxWindowBits === "number") {
          accepted.client_max_window_bits = opts.clientMaxWindowBits;
        } else if (accepted.client_max_window_bits === true || opts.clientMaxWindowBits === false) {
          delete accepted.client_max_window_bits;
        }
        return accepted;
      }
      /**
       * Accept the extension negotiation response.
       *
       * @param {Array} response The extension negotiation response
       * @return {Object} Accepted configuration
       * @private
       */
      acceptAsClient(response) {
        const params = response[0];
        if (this._options.clientNoContextTakeover === false && params.client_no_context_takeover) {
          throw new Error('Unexpected parameter "client_no_context_takeover"');
        }
        if (!params.client_max_window_bits) {
          if (typeof this._options.clientMaxWindowBits === "number") {
            params.client_max_window_bits = this._options.clientMaxWindowBits;
          }
        } else if (this._options.clientMaxWindowBits === false || typeof this._options.clientMaxWindowBits === "number" && params.client_max_window_bits > this._options.clientMaxWindowBits) {
          throw new Error(
            'Unexpected or invalid parameter "client_max_window_bits"'
          );
        }
        return params;
      }
      /**
       * Normalize parameters.
       *
       * @param {Array} configurations The extension negotiation offers/reponse
       * @return {Array} The offers/response with normalized parameters
       * @private
       */
      normalizeParams(configurations) {
        configurations.forEach((params) => {
          Object.keys(params).forEach((key) => {
            let value = params[key];
            if (value.length > 1) {
              throw new Error(`Parameter "${key}" must have only a single value`);
            }
            value = value[0];
            if (key === "client_max_window_bits") {
              if (value !== true) {
                const num = +value;
                if (!Number.isInteger(num) || num < 8 || num > 15) {
                  throw new TypeError(
                    `Invalid value for parameter "${key}": ${value}`
                  );
                }
                value = num;
              } else if (!this._isServer) {
                throw new TypeError(
                  `Invalid value for parameter "${key}": ${value}`
                );
              }
            } else if (key === "server_max_window_bits") {
              const num = +value;
              if (!Number.isInteger(num) || num < 8 || num > 15) {
                throw new TypeError(
                  `Invalid value for parameter "${key}": ${value}`
                );
              }
              value = num;
            } else if (key === "client_no_context_takeover" || key === "server_no_context_takeover") {
              if (value !== true) {
                throw new TypeError(
                  `Invalid value for parameter "${key}": ${value}`
                );
              }
            } else {
              throw new Error(`Unknown parameter "${key}"`);
            }
            params[key] = value;
          });
        });
        return configurations;
      }
      /**
       * Decompress data. Concurrency limited.
       *
       * @param {Buffer} data Compressed data
       * @param {Boolean} fin Specifies whether or not this is the last fragment
       * @param {Function} callback Callback
       * @public
       */
      decompress(data, fin, callback) {
        zlibLimiter.add((done) => {
          this._decompress(data, fin, (err, result) => {
            done();
            callback(err, result);
          });
        });
      }
      /**
       * Compress data. Concurrency limited.
       *
       * @param {(Buffer|String)} data Data to compress
       * @param {Boolean} fin Specifies whether or not this is the last fragment
       * @param {Function} callback Callback
       * @public
       */
      compress(data, fin, callback) {
        zlibLimiter.add((done) => {
          this._compress(data, fin, (err, result) => {
            done();
            callback(err, result);
          });
        });
      }
      /**
       * Decompress data.
       *
       * @param {Buffer} data Compressed data
       * @param {Boolean} fin Specifies whether or not this is the last fragment
       * @param {Function} callback Callback
       * @private
       */
      _decompress(data, fin, callback) {
        const endpoint = this._isServer ? "client" : "server";
        if (!this._inflate) {
          const key = `${endpoint}_max_window_bits`;
          const windowBits = typeof this.params[key] !== "number" ? zlib.Z_DEFAULT_WINDOWBITS : this.params[key];
          this._inflate = zlib.createInflateRaw({
            ...this._options.zlibInflateOptions,
            windowBits
          });
          this._inflate[kPerMessageDeflate] = this;
          this._inflate[kTotalLength] = 0;
          this._inflate[kBuffers] = [];
          this._inflate.on("error", inflateOnError);
          this._inflate.on("data", inflateOnData);
        }
        this._inflate[kCallback] = callback;
        this._inflate.write(data);
        if (fin) this._inflate.write(TRAILER);
        this._inflate.flush(() => {
          const err = this._inflate[kError];
          if (err) {
            this._inflate.close();
            this._inflate = null;
            callback(err);
            return;
          }
          const data2 = bufferUtil.concat(
            this._inflate[kBuffers],
            this._inflate[kTotalLength]
          );
          if (this._inflate._readableState.endEmitted) {
            this._inflate.close();
            this._inflate = null;
          } else {
            this._inflate[kTotalLength] = 0;
            this._inflate[kBuffers] = [];
            if (fin && this.params[`${endpoint}_no_context_takeover`]) {
              this._inflate.reset();
            }
          }
          callback(null, data2);
        });
      }
      /**
       * Compress data.
       *
       * @param {(Buffer|String)} data Data to compress
       * @param {Boolean} fin Specifies whether or not this is the last fragment
       * @param {Function} callback Callback
       * @private
       */
      _compress(data, fin, callback) {
        const endpoint = this._isServer ? "server" : "client";
        if (!this._deflate) {
          const key = `${endpoint}_max_window_bits`;
          const windowBits = typeof this.params[key] !== "number" ? zlib.Z_DEFAULT_WINDOWBITS : this.params[key];
          this._deflate = zlib.createDeflateRaw({
            ...this._options.zlibDeflateOptions,
            windowBits
          });
          this._deflate[kTotalLength] = 0;
          this._deflate[kBuffers] = [];
          this._deflate.on("data", deflateOnData);
        }
        this._deflate[kCallback] = callback;
        this._deflate.write(data);
        this._deflate.flush(zlib.Z_SYNC_FLUSH, () => {
          if (!this._deflate) {
            return;
          }
          let data2 = bufferUtil.concat(
            this._deflate[kBuffers],
            this._deflate[kTotalLength]
          );
          if (fin) {
            data2 = new FastBuffer(data2.buffer, data2.byteOffset, data2.length - 4);
          }
          this._deflate[kCallback] = null;
          this._deflate[kTotalLength] = 0;
          this._deflate[kBuffers] = [];
          if (fin && this.params[`${endpoint}_no_context_takeover`]) {
            this._deflate.reset();
          }
          callback(null, data2);
        });
      }
    };
    module.exports = PerMessageDeflate2;
    function deflateOnData(chunk) {
      this[kBuffers].push(chunk);
      this[kTotalLength] += chunk.length;
    }
    function inflateOnData(chunk) {
      this[kTotalLength] += chunk.length;
      if (this[kPerMessageDeflate]._maxPayload < 1 || this[kTotalLength] <= this[kPerMessageDeflate]._maxPayload) {
        this[kBuffers].push(chunk);
        return;
      }
      this[kError] = new RangeError("Max payload size exceeded");
      this[kError].code = "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH";
      this[kError][kStatusCode] = 1009;
      this.removeListener("data", inflateOnData);
      this.reset();
    }
    function inflateOnError(err) {
      this[kPerMessageDeflate]._inflate = null;
      if (this[kError]) {
        this[kCallback](this[kError]);
        return;
      }
      err[kStatusCode] = 1007;
      this[kCallback](err);
    }
  }
});

// ../../node_modules/ws/lib/validation.js
var require_validation = __commonJS({
  "../../node_modules/ws/lib/validation.js"(exports, module) {
    "use strict";
    var { isUtf8 } = __require("buffer");
    var { hasBlob } = require_constants();
    var tokenChars = [
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      // 0 - 15
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      // 16 - 31
      0,
      1,
      0,
      1,
      1,
      1,
      1,
      1,
      0,
      0,
      1,
      1,
      0,
      1,
      1,
      0,
      // 32 - 47
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      0,
      0,
      0,
      0,
      0,
      0,
      // 48 - 63
      0,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      // 64 - 79
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      0,
      0,
      0,
      1,
      1,
      // 80 - 95
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      // 96 - 111
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      0,
      1,
      0,
      1,
      0
      // 112 - 127
    ];
    function isValidStatusCode(code) {
      return code >= 1e3 && code <= 1014 && code !== 1004 && code !== 1005 && code !== 1006 || code >= 3e3 && code <= 4999;
    }
    function _isValidUTF8(buf) {
      const len = buf.length;
      let i = 0;
      while (i < len) {
        if ((buf[i] & 128) === 0) {
          i++;
        } else if ((buf[i] & 224) === 192) {
          if (i + 1 === len || (buf[i + 1] & 192) !== 128 || (buf[i] & 254) === 192) {
            return false;
          }
          i += 2;
        } else if ((buf[i] & 240) === 224) {
          if (i + 2 >= len || (buf[i + 1] & 192) !== 128 || (buf[i + 2] & 192) !== 128 || buf[i] === 224 && (buf[i + 1] & 224) === 128 || // Overlong
          buf[i] === 237 && (buf[i + 1] & 224) === 160) {
            return false;
          }
          i += 3;
        } else if ((buf[i] & 248) === 240) {
          if (i + 3 >= len || (buf[i + 1] & 192) !== 128 || (buf[i + 2] & 192) !== 128 || (buf[i + 3] & 192) !== 128 || buf[i] === 240 && (buf[i + 1] & 240) === 128 || // Overlong
          buf[i] === 244 && buf[i + 1] > 143 || buf[i] > 244) {
            return false;
          }
          i += 4;
        } else {
          return false;
        }
      }
      return true;
    }
    function isBlob(value) {
      return hasBlob && typeof value === "object" && typeof value.arrayBuffer === "function" && typeof value.type === "string" && typeof value.stream === "function" && (value[Symbol.toStringTag] === "Blob" || value[Symbol.toStringTag] === "File");
    }
    module.exports = {
      isBlob,
      isValidStatusCode,
      isValidUTF8: _isValidUTF8,
      tokenChars
    };
    if (isUtf8) {
      module.exports.isValidUTF8 = function(buf) {
        return buf.length < 24 ? _isValidUTF8(buf) : isUtf8(buf);
      };
    } else if (!process.env.WS_NO_UTF_8_VALIDATE) {
      try {
        const isValidUTF8 = __require("utf-8-validate");
        module.exports.isValidUTF8 = function(buf) {
          return buf.length < 32 ? _isValidUTF8(buf) : isValidUTF8(buf);
        };
      } catch (e) {
      }
    }
  }
});

// ../../node_modules/ws/lib/receiver.js
var require_receiver = __commonJS({
  "../../node_modules/ws/lib/receiver.js"(exports, module) {
    "use strict";
    var { Writable } = __require("stream");
    var PerMessageDeflate2 = require_permessage_deflate();
    var {
      BINARY_TYPES,
      EMPTY_BUFFER,
      kStatusCode,
      kWebSocket
    } = require_constants();
    var { concat, toArrayBuffer, unmask } = require_buffer_util();
    var { isValidStatusCode, isValidUTF8 } = require_validation();
    var FastBuffer = Buffer[Symbol.species];
    var GET_INFO = 0;
    var GET_PAYLOAD_LENGTH_16 = 1;
    var GET_PAYLOAD_LENGTH_64 = 2;
    var GET_MASK = 3;
    var GET_DATA = 4;
    var INFLATING = 5;
    var DEFER_EVENT = 6;
    var Receiver2 = class extends Writable {
      /**
       * Creates a Receiver instance.
       *
       * @param {Object} [options] Options object
       * @param {Boolean} [options.allowSynchronousEvents=true] Specifies whether
       *     any of the `'message'`, `'ping'`, and `'pong'` events can be emitted
       *     multiple times in the same tick
       * @param {String} [options.binaryType=nodebuffer] The type for binary data
       * @param {Object} [options.extensions] An object containing the negotiated
       *     extensions
       * @param {Boolean} [options.isServer=false] Specifies whether to operate in
       *     client or server mode
       * @param {Number} [options.maxBufferedChunks=0] The maximum number of
       *     buffered data chunks
       * @param {Number} [options.maxFragments=0] The maximum number of message
       *     fragments
       * @param {Number} [options.maxPayload=0] The maximum allowed message length
       * @param {Boolean} [options.skipUTF8Validation=false] Specifies whether or
       *     not to skip UTF-8 validation for text and close messages
       */
      constructor(options = {}) {
        super();
        this._allowSynchronousEvents = options.allowSynchronousEvents !== void 0 ? options.allowSynchronousEvents : true;
        this._binaryType = options.binaryType || BINARY_TYPES[0];
        this._extensions = options.extensions || {};
        this._isServer = !!options.isServer;
        this._maxBufferedChunks = options.maxBufferedChunks | 0;
        this._maxFragments = options.maxFragments | 0;
        this._maxPayload = options.maxPayload | 0;
        this._skipUTF8Validation = !!options.skipUTF8Validation;
        this[kWebSocket] = void 0;
        this._bufferedBytes = 0;
        this._buffers = [];
        this._compressed = false;
        this._payloadLength = 0;
        this._mask = void 0;
        this._fragmented = 0;
        this._masked = false;
        this._fin = false;
        this._opcode = 0;
        this._totalPayloadLength = 0;
        this._messageLength = 0;
        this._numFragments = 0;
        this._fragments = [];
        this._errored = false;
        this._loop = false;
        this._state = GET_INFO;
      }
      /**
       * Implements `Writable.prototype._write()`.
       *
       * @param {Buffer} chunk The chunk of data to write
       * @param {String} encoding The character encoding of `chunk`
       * @param {Function} cb Callback
       * @private
       */
      _write(chunk, encoding, cb) {
        if (this._opcode === 8 && this._state == GET_INFO) return cb();
        if (this._maxBufferedChunks > 0 && this._buffers.length >= this._maxBufferedChunks) {
          cb(
            this.createError(
              RangeError,
              "Too many buffered chunks",
              false,
              1008,
              "WS_ERR_TOO_MANY_BUFFERED_PARTS"
            )
          );
          return;
        }
        this._bufferedBytes += chunk.length;
        this._buffers.push(chunk);
        this.startLoop(cb);
      }
      /**
       * Consumes `n` bytes from the buffered data.
       *
       * @param {Number} n The number of bytes to consume
       * @return {Buffer} The consumed bytes
       * @private
       */
      consume(n) {
        this._bufferedBytes -= n;
        if (n === this._buffers[0].length) return this._buffers.shift();
        if (n < this._buffers[0].length) {
          const buf = this._buffers[0];
          this._buffers[0] = new FastBuffer(
            buf.buffer,
            buf.byteOffset + n,
            buf.length - n
          );
          return new FastBuffer(buf.buffer, buf.byteOffset, n);
        }
        const dst = Buffer.allocUnsafe(n);
        do {
          const buf = this._buffers[0];
          const offset = dst.length - n;
          if (n >= buf.length) {
            dst.set(this._buffers.shift(), offset);
          } else {
            dst.set(new Uint8Array(buf.buffer, buf.byteOffset, n), offset);
            this._buffers[0] = new FastBuffer(
              buf.buffer,
              buf.byteOffset + n,
              buf.length - n
            );
          }
          n -= buf.length;
        } while (n > 0);
        return dst;
      }
      /**
       * Starts the parsing loop.
       *
       * @param {Function} cb Callback
       * @private
       */
      startLoop(cb) {
        this._loop = true;
        do {
          switch (this._state) {
            case GET_INFO:
              this.getInfo(cb);
              break;
            case GET_PAYLOAD_LENGTH_16:
              this.getPayloadLength16(cb);
              break;
            case GET_PAYLOAD_LENGTH_64:
              this.getPayloadLength64(cb);
              break;
            case GET_MASK:
              this.getMask();
              break;
            case GET_DATA:
              this.getData(cb);
              break;
            case INFLATING:
            case DEFER_EVENT:
              this._loop = false;
              return;
          }
        } while (this._loop);
        if (!this._errored) cb();
      }
      /**
       * Reads the first two bytes of a frame.
       *
       * @param {Function} cb Callback
       * @private
       */
      getInfo(cb) {
        if (this._bufferedBytes < 2) {
          this._loop = false;
          return;
        }
        const buf = this.consume(2);
        if ((buf[0] & 48) !== 0) {
          const error = this.createError(
            RangeError,
            "RSV2 and RSV3 must be clear",
            true,
            1002,
            "WS_ERR_UNEXPECTED_RSV_2_3"
          );
          cb(error);
          return;
        }
        const compressed = (buf[0] & 64) === 64;
        if (compressed && !this._extensions[PerMessageDeflate2.extensionName]) {
          const error = this.createError(
            RangeError,
            "RSV1 must be clear",
            true,
            1002,
            "WS_ERR_UNEXPECTED_RSV_1"
          );
          cb(error);
          return;
        }
        this._fin = (buf[0] & 128) === 128;
        this._opcode = buf[0] & 15;
        this._payloadLength = buf[1] & 127;
        if (this._opcode === 0) {
          if (compressed) {
            const error = this.createError(
              RangeError,
              "RSV1 must be clear",
              true,
              1002,
              "WS_ERR_UNEXPECTED_RSV_1"
            );
            cb(error);
            return;
          }
          if (!this._fragmented) {
            const error = this.createError(
              RangeError,
              "invalid opcode 0",
              true,
              1002,
              "WS_ERR_INVALID_OPCODE"
            );
            cb(error);
            return;
          }
          this._opcode = this._fragmented;
        } else if (this._opcode === 1 || this._opcode === 2) {
          if (this._fragmented) {
            const error = this.createError(
              RangeError,
              `invalid opcode ${this._opcode}`,
              true,
              1002,
              "WS_ERR_INVALID_OPCODE"
            );
            cb(error);
            return;
          }
          this._compressed = compressed;
        } else if (this._opcode > 7 && this._opcode < 11) {
          if (!this._fin) {
            const error = this.createError(
              RangeError,
              "FIN must be set",
              true,
              1002,
              "WS_ERR_EXPECTED_FIN"
            );
            cb(error);
            return;
          }
          if (compressed) {
            const error = this.createError(
              RangeError,
              "RSV1 must be clear",
              true,
              1002,
              "WS_ERR_UNEXPECTED_RSV_1"
            );
            cb(error);
            return;
          }
          if (this._payloadLength > 125 || this._opcode === 8 && this._payloadLength === 1) {
            const error = this.createError(
              RangeError,
              `invalid payload length ${this._payloadLength}`,
              true,
              1002,
              "WS_ERR_INVALID_CONTROL_PAYLOAD_LENGTH"
            );
            cb(error);
            return;
          }
        } else {
          const error = this.createError(
            RangeError,
            `invalid opcode ${this._opcode}`,
            true,
            1002,
            "WS_ERR_INVALID_OPCODE"
          );
          cb(error);
          return;
        }
        if (!this._fin && !this._fragmented) this._fragmented = this._opcode;
        this._masked = (buf[1] & 128) === 128;
        if (this._isServer) {
          if (!this._masked) {
            const error = this.createError(
              RangeError,
              "MASK must be set",
              true,
              1002,
              "WS_ERR_EXPECTED_MASK"
            );
            cb(error);
            return;
          }
        } else if (this._masked) {
          const error = this.createError(
            RangeError,
            "MASK must be clear",
            true,
            1002,
            "WS_ERR_UNEXPECTED_MASK"
          );
          cb(error);
          return;
        }
        if (this._payloadLength === 126) this._state = GET_PAYLOAD_LENGTH_16;
        else if (this._payloadLength === 127) this._state = GET_PAYLOAD_LENGTH_64;
        else this.haveLength(cb);
      }
      /**
       * Gets extended payload length (7+16).
       *
       * @param {Function} cb Callback
       * @private
       */
      getPayloadLength16(cb) {
        if (this._bufferedBytes < 2) {
          this._loop = false;
          return;
        }
        this._payloadLength = this.consume(2).readUInt16BE(0);
        this.haveLength(cb);
      }
      /**
       * Gets extended payload length (7+64).
       *
       * @param {Function} cb Callback
       * @private
       */
      getPayloadLength64(cb) {
        if (this._bufferedBytes < 8) {
          this._loop = false;
          return;
        }
        const buf = this.consume(8);
        const num = buf.readUInt32BE(0);
        if (num > Math.pow(2, 53 - 32) - 1) {
          const error = this.createError(
            RangeError,
            "Unsupported WebSocket frame: payload length > 2^53 - 1",
            false,
            1009,
            "WS_ERR_UNSUPPORTED_DATA_PAYLOAD_LENGTH"
          );
          cb(error);
          return;
        }
        this._payloadLength = num * Math.pow(2, 32) + buf.readUInt32BE(4);
        this.haveLength(cb);
      }
      /**
       * Payload length has been read.
       *
       * @param {Function} cb Callback
       * @private
       */
      haveLength(cb) {
        if (this._payloadLength && this._opcode < 8) {
          this._totalPayloadLength += this._payloadLength;
          if (this._totalPayloadLength > this._maxPayload && this._maxPayload > 0) {
            const error = this.createError(
              RangeError,
              "Max payload size exceeded",
              false,
              1009,
              "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH"
            );
            cb(error);
            return;
          }
        }
        if (this._masked) this._state = GET_MASK;
        else this._state = GET_DATA;
      }
      /**
       * Reads mask bytes.
       *
       * @private
       */
      getMask() {
        if (this._bufferedBytes < 4) {
          this._loop = false;
          return;
        }
        this._mask = this.consume(4);
        this._state = GET_DATA;
      }
      /**
       * Reads data bytes.
       *
       * @param {Function} cb Callback
       * @private
       */
      getData(cb) {
        let data = EMPTY_BUFFER;
        if (this._payloadLength) {
          if (this._bufferedBytes < this._payloadLength) {
            this._loop = false;
            return;
          }
          data = this.consume(this._payloadLength);
          if (this._masked && (this._mask[0] | this._mask[1] | this._mask[2] | this._mask[3]) !== 0) {
            unmask(data, this._mask);
          }
        }
        if (this._opcode > 7) {
          this.controlMessage(data, cb);
          return;
        }
        if (this._maxFragments > 0 && ++this._numFragments > this._maxFragments) {
          const error = this.createError(
            RangeError,
            "Too many message fragments",
            false,
            1008,
            "WS_ERR_TOO_MANY_BUFFERED_PARTS"
          );
          cb(error);
          return;
        }
        if (this._compressed) {
          this._state = INFLATING;
          this.decompress(data, cb);
          return;
        }
        if (data.length) {
          this._messageLength = this._totalPayloadLength;
          this._fragments.push(data);
        }
        this.dataMessage(cb);
      }
      /**
       * Decompresses data.
       *
       * @param {Buffer} data Compressed data
       * @param {Function} cb Callback
       * @private
       */
      decompress(data, cb) {
        const perMessageDeflate = this._extensions[PerMessageDeflate2.extensionName];
        perMessageDeflate.decompress(data, this._fin, (err, buf) => {
          if (err) return cb(err);
          if (buf.length) {
            this._messageLength += buf.length;
            if (this._messageLength > this._maxPayload && this._maxPayload > 0) {
              const error = this.createError(
                RangeError,
                "Max payload size exceeded",
                false,
                1009,
                "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH"
              );
              cb(error);
              return;
            }
            this._fragments.push(buf);
          }
          this.dataMessage(cb);
          if (this._state === GET_INFO) this.startLoop(cb);
        });
      }
      /**
       * Handles a data message.
       *
       * @param {Function} cb Callback
       * @private
       */
      dataMessage(cb) {
        if (!this._fin) {
          this._state = GET_INFO;
          return;
        }
        const messageLength = this._messageLength;
        const fragments = this._fragments;
        this._totalPayloadLength = 0;
        this._messageLength = 0;
        this._fragmented = 0;
        this._numFragments = 0;
        this._fragments = [];
        if (this._opcode === 2) {
          let data;
          if (this._binaryType === "nodebuffer") {
            data = concat(fragments, messageLength);
          } else if (this._binaryType === "arraybuffer") {
            data = toArrayBuffer(concat(fragments, messageLength));
          } else if (this._binaryType === "blob") {
            data = new Blob(fragments);
          } else {
            data = fragments;
          }
          if (this._allowSynchronousEvents) {
            this.emit("message", data, true);
            this._state = GET_INFO;
          } else {
            this._state = DEFER_EVENT;
            setImmediate(() => {
              this.emit("message", data, true);
              this._state = GET_INFO;
              this.startLoop(cb);
            });
          }
        } else {
          const buf = concat(fragments, messageLength);
          if (!this._skipUTF8Validation && !isValidUTF8(buf)) {
            const error = this.createError(
              Error,
              "invalid UTF-8 sequence",
              true,
              1007,
              "WS_ERR_INVALID_UTF8"
            );
            cb(error);
            return;
          }
          if (this._state === INFLATING || this._allowSynchronousEvents) {
            this.emit("message", buf, false);
            this._state = GET_INFO;
          } else {
            this._state = DEFER_EVENT;
            setImmediate(() => {
              this.emit("message", buf, false);
              this._state = GET_INFO;
              this.startLoop(cb);
            });
          }
        }
      }
      /**
       * Handles a control message.
       *
       * @param {Buffer} data Data to handle
       * @return {(Error|RangeError|undefined)} A possible error
       * @private
       */
      controlMessage(data, cb) {
        if (this._opcode === 8) {
          if (data.length === 0) {
            this._loop = false;
            this.emit("conclude", 1005, EMPTY_BUFFER);
            this.end();
          } else {
            const code = data.readUInt16BE(0);
            if (!isValidStatusCode(code)) {
              const error = this.createError(
                RangeError,
                `invalid status code ${code}`,
                true,
                1002,
                "WS_ERR_INVALID_CLOSE_CODE"
              );
              cb(error);
              return;
            }
            const buf = new FastBuffer(
              data.buffer,
              data.byteOffset + 2,
              data.length - 2
            );
            if (!this._skipUTF8Validation && !isValidUTF8(buf)) {
              const error = this.createError(
                Error,
                "invalid UTF-8 sequence",
                true,
                1007,
                "WS_ERR_INVALID_UTF8"
              );
              cb(error);
              return;
            }
            this._loop = false;
            this.emit("conclude", code, buf);
            this.end();
          }
          this._state = GET_INFO;
          return;
        }
        if (this._allowSynchronousEvents) {
          this.emit(this._opcode === 9 ? "ping" : "pong", data);
          this._state = GET_INFO;
        } else {
          this._state = DEFER_EVENT;
          setImmediate(() => {
            this.emit(this._opcode === 9 ? "ping" : "pong", data);
            this._state = GET_INFO;
            this.startLoop(cb);
          });
        }
      }
      /**
       * Builds an error object.
       *
       * @param {function(new:Error|RangeError)} ErrorCtor The error constructor
       * @param {String} message The error message
       * @param {Boolean} prefix Specifies whether or not to add a default prefix to
       *     `message`
       * @param {Number} statusCode The status code
       * @param {String} errorCode The exposed error code
       * @return {(Error|RangeError)} The error
       * @private
       */
      createError(ErrorCtor, message, prefix, statusCode, errorCode) {
        this._loop = false;
        this._errored = true;
        const err = new ErrorCtor(
          prefix ? `Invalid WebSocket frame: ${message}` : message
        );
        Error.captureStackTrace(err, this.createError);
        err.code = errorCode;
        err[kStatusCode] = statusCode;
        return err;
      }
    };
    module.exports = Receiver2;
  }
});

// ../../node_modules/ws/lib/sender.js
var require_sender = __commonJS({
  "../../node_modules/ws/lib/sender.js"(exports, module) {
    "use strict";
    var { Duplex } = __require("stream");
    var { randomFillSync } = __require("crypto");
    var {
      types: { isUint8Array }
    } = __require("util");
    var PerMessageDeflate2 = require_permessage_deflate();
    var { EMPTY_BUFFER, kWebSocket, NOOP } = require_constants();
    var { isBlob, isValidStatusCode } = require_validation();
    var { mask: applyMask, toBuffer } = require_buffer_util();
    var kByteLength = Symbol("kByteLength");
    var maskBuffer = Buffer.alloc(4);
    var RANDOM_POOL_SIZE = 8 * 1024;
    var randomPool;
    var randomPoolPointer = RANDOM_POOL_SIZE;
    var DEFAULT = 0;
    var DEFLATING = 1;
    var GET_BLOB_DATA = 2;
    var Sender2 = class _Sender {
      /**
       * Creates a Sender instance.
       *
       * @param {Duplex} socket The connection socket
       * @param {Object} [extensions] An object containing the negotiated extensions
       * @param {Function} [generateMask] The function used to generate the masking
       *     key
       */
      constructor(socket, extensions, generateMask) {
        this._extensions = extensions || {};
        if (generateMask) {
          this._generateMask = generateMask;
          this._maskBuffer = Buffer.alloc(4);
        }
        this._socket = socket;
        this._firstFragment = true;
        this._compress = false;
        this._bufferedBytes = 0;
        this._queue = [];
        this._state = DEFAULT;
        this.onerror = NOOP;
        this[kWebSocket] = void 0;
      }
      /**
       * Frames a piece of data according to the HyBi WebSocket protocol.
       *
       * @param {(Buffer|String)} data The data to frame
       * @param {Object} options Options object
       * @param {Boolean} [options.fin=false] Specifies whether or not to set the
       *     FIN bit
       * @param {Function} [options.generateMask] The function used to generate the
       *     masking key
       * @param {Boolean} [options.mask=false] Specifies whether or not to mask
       *     `data`
       * @param {Buffer} [options.maskBuffer] The buffer used to store the masking
       *     key
       * @param {Number} options.opcode The opcode
       * @param {Boolean} [options.readOnly=false] Specifies whether `data` can be
       *     modified
       * @param {Boolean} [options.rsv1=false] Specifies whether or not to set the
       *     RSV1 bit
       * @return {(Buffer|String)[]} The framed data
       * @public
       */
      static frame(data, options) {
        let mask;
        let merge = false;
        let offset = 2;
        let skipMasking = false;
        if (options.mask) {
          mask = options.maskBuffer || maskBuffer;
          if (options.generateMask) {
            options.generateMask(mask);
          } else {
            if (randomPoolPointer === RANDOM_POOL_SIZE) {
              if (randomPool === void 0) {
                randomPool = Buffer.alloc(RANDOM_POOL_SIZE);
              }
              randomFillSync(randomPool, 0, RANDOM_POOL_SIZE);
              randomPoolPointer = 0;
            }
            mask[0] = randomPool[randomPoolPointer++];
            mask[1] = randomPool[randomPoolPointer++];
            mask[2] = randomPool[randomPoolPointer++];
            mask[3] = randomPool[randomPoolPointer++];
          }
          skipMasking = (mask[0] | mask[1] | mask[2] | mask[3]) === 0;
          offset = 6;
        }
        let dataLength;
        if (typeof data === "string") {
          if ((!options.mask || skipMasking) && options[kByteLength] !== void 0) {
            dataLength = options[kByteLength];
          } else {
            data = Buffer.from(data);
            dataLength = data.length;
          }
        } else {
          dataLength = data.length;
          merge = options.mask && options.readOnly && !skipMasking;
        }
        let payloadLength = dataLength;
        if (dataLength >= 65536) {
          offset += 8;
          payloadLength = 127;
        } else if (dataLength > 125) {
          offset += 2;
          payloadLength = 126;
        }
        const target = Buffer.allocUnsafe(merge ? dataLength + offset : offset);
        target[0] = options.fin ? options.opcode | 128 : options.opcode;
        if (options.rsv1) target[0] |= 64;
        target[1] = payloadLength;
        if (payloadLength === 126) {
          target.writeUInt16BE(dataLength, 2);
        } else if (payloadLength === 127) {
          target[2] = target[3] = 0;
          target.writeUIntBE(dataLength, 4, 6);
        }
        if (!options.mask) return [target, data];
        target[1] |= 128;
        target[offset - 4] = mask[0];
        target[offset - 3] = mask[1];
        target[offset - 2] = mask[2];
        target[offset - 1] = mask[3];
        if (skipMasking) return [target, data];
        if (merge) {
          applyMask(data, mask, target, offset, dataLength);
          return [target];
        }
        applyMask(data, mask, data, 0, dataLength);
        return [target, data];
      }
      /**
       * Sends a close message to the other peer.
       *
       * @param {Number} [code] The status code component of the body
       * @param {(String|Buffer)} [data] The message component of the body
       * @param {Boolean} [mask=false] Specifies whether or not to mask the message
       * @param {Function} [cb] Callback
       * @public
       */
      close(code, data, mask, cb) {
        let buf;
        if (code === void 0) {
          buf = EMPTY_BUFFER;
        } else if (typeof code !== "number" || !isValidStatusCode(code)) {
          throw new TypeError("First argument must be a valid error code number");
        } else if (data === void 0 || !data.length) {
          buf = Buffer.allocUnsafe(2);
          buf.writeUInt16BE(code, 0);
        } else {
          const length = Buffer.byteLength(data);
          if (length > 123) {
            throw new RangeError("The message must not be greater than 123 bytes");
          }
          buf = Buffer.allocUnsafe(2 + length);
          buf.writeUInt16BE(code, 0);
          if (typeof data === "string") {
            buf.write(data, 2);
          } else if (isUint8Array(data)) {
            buf.set(data, 2);
          } else {
            throw new TypeError("Second argument must be a string or a Uint8Array");
          }
        }
        const options = {
          [kByteLength]: buf.length,
          fin: true,
          generateMask: this._generateMask,
          mask,
          maskBuffer: this._maskBuffer,
          opcode: 8,
          readOnly: false,
          rsv1: false
        };
        if (this._state !== DEFAULT) {
          this.enqueue([this.dispatch, buf, false, options, cb]);
        } else {
          this.sendFrame(_Sender.frame(buf, options), cb);
        }
      }
      /**
       * Sends a ping message to the other peer.
       *
       * @param {*} data The message to send
       * @param {Boolean} [mask=false] Specifies whether or not to mask `data`
       * @param {Function} [cb] Callback
       * @public
       */
      ping(data, mask, cb) {
        let byteLength;
        let readOnly;
        if (typeof data === "string") {
          byteLength = Buffer.byteLength(data);
          readOnly = false;
        } else if (isBlob(data)) {
          byteLength = data.size;
          readOnly = false;
        } else {
          data = toBuffer(data);
          byteLength = data.length;
          readOnly = toBuffer.readOnly;
        }
        if (byteLength > 125) {
          throw new RangeError("The data size must not be greater than 125 bytes");
        }
        const options = {
          [kByteLength]: byteLength,
          fin: true,
          generateMask: this._generateMask,
          mask,
          maskBuffer: this._maskBuffer,
          opcode: 9,
          readOnly,
          rsv1: false
        };
        if (isBlob(data)) {
          if (this._state !== DEFAULT) {
            this.enqueue([this.getBlobData, data, false, options, cb]);
          } else {
            this.getBlobData(data, false, options, cb);
          }
        } else if (this._state !== DEFAULT) {
          this.enqueue([this.dispatch, data, false, options, cb]);
        } else {
          this.sendFrame(_Sender.frame(data, options), cb);
        }
      }
      /**
       * Sends a pong message to the other peer.
       *
       * @param {*} data The message to send
       * @param {Boolean} [mask=false] Specifies whether or not to mask `data`
       * @param {Function} [cb] Callback
       * @public
       */
      pong(data, mask, cb) {
        let byteLength;
        let readOnly;
        if (typeof data === "string") {
          byteLength = Buffer.byteLength(data);
          readOnly = false;
        } else if (isBlob(data)) {
          byteLength = data.size;
          readOnly = false;
        } else {
          data = toBuffer(data);
          byteLength = data.length;
          readOnly = toBuffer.readOnly;
        }
        if (byteLength > 125) {
          throw new RangeError("The data size must not be greater than 125 bytes");
        }
        const options = {
          [kByteLength]: byteLength,
          fin: true,
          generateMask: this._generateMask,
          mask,
          maskBuffer: this._maskBuffer,
          opcode: 10,
          readOnly,
          rsv1: false
        };
        if (isBlob(data)) {
          if (this._state !== DEFAULT) {
            this.enqueue([this.getBlobData, data, false, options, cb]);
          } else {
            this.getBlobData(data, false, options, cb);
          }
        } else if (this._state !== DEFAULT) {
          this.enqueue([this.dispatch, data, false, options, cb]);
        } else {
          this.sendFrame(_Sender.frame(data, options), cb);
        }
      }
      /**
       * Sends a data message to the other peer.
       *
       * @param {*} data The message to send
       * @param {Object} options Options object
       * @param {Boolean} [options.binary=false] Specifies whether `data` is binary
       *     or text
       * @param {Boolean} [options.compress=false] Specifies whether or not to
       *     compress `data`
       * @param {Boolean} [options.fin=false] Specifies whether the fragment is the
       *     last one
       * @param {Boolean} [options.mask=false] Specifies whether or not to mask
       *     `data`
       * @param {Function} [cb] Callback
       * @public
       */
      send(data, options, cb) {
        const perMessageDeflate = this._extensions[PerMessageDeflate2.extensionName];
        let opcode = options.binary ? 2 : 1;
        let rsv1 = options.compress;
        let byteLength;
        let readOnly;
        if (typeof data === "string") {
          byteLength = Buffer.byteLength(data);
          readOnly = false;
        } else if (isBlob(data)) {
          byteLength = data.size;
          readOnly = false;
        } else {
          data = toBuffer(data);
          byteLength = data.length;
          readOnly = toBuffer.readOnly;
        }
        if (this._firstFragment) {
          this._firstFragment = false;
          if (rsv1 && perMessageDeflate && perMessageDeflate.params[perMessageDeflate._isServer ? "server_no_context_takeover" : "client_no_context_takeover"]) {
            rsv1 = byteLength >= perMessageDeflate._threshold;
          }
          this._compress = rsv1;
        } else {
          rsv1 = false;
          opcode = 0;
        }
        if (options.fin) this._firstFragment = true;
        const opts = {
          [kByteLength]: byteLength,
          fin: options.fin,
          generateMask: this._generateMask,
          mask: options.mask,
          maskBuffer: this._maskBuffer,
          opcode,
          readOnly,
          rsv1
        };
        if (isBlob(data)) {
          if (this._state !== DEFAULT) {
            this.enqueue([this.getBlobData, data, this._compress, opts, cb]);
          } else {
            this.getBlobData(data, this._compress, opts, cb);
          }
        } else if (this._state !== DEFAULT) {
          this.enqueue([this.dispatch, data, this._compress, opts, cb]);
        } else {
          this.dispatch(data, this._compress, opts, cb);
        }
      }
      /**
       * Gets the contents of a blob as binary data.
       *
       * @param {Blob} blob The blob
       * @param {Boolean} [compress=false] Specifies whether or not to compress
       *     the data
       * @param {Object} options Options object
       * @param {Boolean} [options.fin=false] Specifies whether or not to set the
       *     FIN bit
       * @param {Function} [options.generateMask] The function used to generate the
       *     masking key
       * @param {Boolean} [options.mask=false] Specifies whether or not to mask
       *     `data`
       * @param {Buffer} [options.maskBuffer] The buffer used to store the masking
       *     key
       * @param {Number} options.opcode The opcode
       * @param {Boolean} [options.readOnly=false] Specifies whether `data` can be
       *     modified
       * @param {Boolean} [options.rsv1=false] Specifies whether or not to set the
       *     RSV1 bit
       * @param {Function} [cb] Callback
       * @private
       */
      getBlobData(blob, compress, options, cb) {
        this._bufferedBytes += options[kByteLength];
        this._state = GET_BLOB_DATA;
        blob.arrayBuffer().then((arrayBuffer) => {
          if (this._socket.destroyed) {
            const err = new Error(
              "The socket was closed while the blob was being read"
            );
            process.nextTick(callCallbacks, this, err, cb);
            return;
          }
          this._bufferedBytes -= options[kByteLength];
          const data = toBuffer(arrayBuffer);
          if (!compress) {
            this._state = DEFAULT;
            this.sendFrame(_Sender.frame(data, options), cb);
            this.dequeue();
          } else {
            this.dispatch(data, compress, options, cb);
          }
        }).catch((err) => {
          process.nextTick(onError, this, err, cb);
        });
      }
      /**
       * Dispatches a message.
       *
       * @param {(Buffer|String)} data The message to send
       * @param {Boolean} [compress=false] Specifies whether or not to compress
       *     `data`
       * @param {Object} options Options object
       * @param {Boolean} [options.fin=false] Specifies whether or not to set the
       *     FIN bit
       * @param {Function} [options.generateMask] The function used to generate the
       *     masking key
       * @param {Boolean} [options.mask=false] Specifies whether or not to mask
       *     `data`
       * @param {Buffer} [options.maskBuffer] The buffer used to store the masking
       *     key
       * @param {Number} options.opcode The opcode
       * @param {Boolean} [options.readOnly=false] Specifies whether `data` can be
       *     modified
       * @param {Boolean} [options.rsv1=false] Specifies whether or not to set the
       *     RSV1 bit
       * @param {Function} [cb] Callback
       * @private
       */
      dispatch(data, compress, options, cb) {
        if (!compress) {
          this.sendFrame(_Sender.frame(data, options), cb);
          return;
        }
        const perMessageDeflate = this._extensions[PerMessageDeflate2.extensionName];
        this._bufferedBytes += options[kByteLength];
        this._state = DEFLATING;
        perMessageDeflate.compress(data, options.fin, (_, buf) => {
          if (this._socket.destroyed) {
            const err = new Error(
              "The socket was closed while data was being compressed"
            );
            callCallbacks(this, err, cb);
            return;
          }
          this._bufferedBytes -= options[kByteLength];
          this._state = DEFAULT;
          options.readOnly = false;
          this.sendFrame(_Sender.frame(buf, options), cb);
          this.dequeue();
        });
      }
      /**
       * Executes queued send operations.
       *
       * @private
       */
      dequeue() {
        while (this._state === DEFAULT && this._queue.length) {
          const params = this._queue.shift();
          this._bufferedBytes -= params[3][kByteLength];
          Reflect.apply(params[0], this, params.slice(1));
        }
      }
      /**
       * Enqueues a send operation.
       *
       * @param {Array} params Send operation parameters.
       * @private
       */
      enqueue(params) {
        this._bufferedBytes += params[3][kByteLength];
        this._queue.push(params);
      }
      /**
       * Sends a frame.
       *
       * @param {(Buffer | String)[]} list The frame to send
       * @param {Function} [cb] Callback
       * @private
       */
      sendFrame(list, cb) {
        if (list.length === 2) {
          this._socket.cork();
          this._socket.write(list[0]);
          this._socket.write(list[1], cb);
          this._socket.uncork();
        } else {
          this._socket.write(list[0], cb);
        }
      }
    };
    module.exports = Sender2;
    function callCallbacks(sender, err, cb) {
      if (typeof cb === "function") cb(err);
      for (let i = 0; i < sender._queue.length; i++) {
        const params = sender._queue[i];
        const callback = params[params.length - 1];
        if (typeof callback === "function") callback(err);
      }
    }
    function onError(sender, err, cb) {
      callCallbacks(sender, err, cb);
      sender.onerror(err);
    }
  }
});

// ../../node_modules/ws/lib/event-target.js
var require_event_target = __commonJS({
  "../../node_modules/ws/lib/event-target.js"(exports, module) {
    "use strict";
    var { kForOnEventAttribute, kListener } = require_constants();
    var kCode = Symbol("kCode");
    var kData = Symbol("kData");
    var kError = Symbol("kError");
    var kMessage = Symbol("kMessage");
    var kReason = Symbol("kReason");
    var kTarget = Symbol("kTarget");
    var kType = Symbol("kType");
    var kWasClean = Symbol("kWasClean");
    var Event = class {
      /**
       * Create a new `Event`.
       *
       * @param {String} type The name of the event
       * @throws {TypeError} If the `type` argument is not specified
       */
      constructor(type) {
        this[kTarget] = null;
        this[kType] = type;
      }
      /**
       * @type {*}
       */
      get target() {
        return this[kTarget];
      }
      /**
       * @type {String}
       */
      get type() {
        return this[kType];
      }
    };
    Object.defineProperty(Event.prototype, "target", { enumerable: true });
    Object.defineProperty(Event.prototype, "type", { enumerable: true });
    var CloseEvent = class extends Event {
      /**
       * Create a new `CloseEvent`.
       *
       * @param {String} type The name of the event
       * @param {Object} [options] A dictionary object that allows for setting
       *     attributes via object members of the same name
       * @param {Number} [options.code=0] The status code explaining why the
       *     connection was closed
       * @param {String} [options.reason=''] A human-readable string explaining why
       *     the connection was closed
       * @param {Boolean} [options.wasClean=false] Indicates whether or not the
       *     connection was cleanly closed
       */
      constructor(type, options = {}) {
        super(type);
        this[kCode] = options.code === void 0 ? 0 : options.code;
        this[kReason] = options.reason === void 0 ? "" : options.reason;
        this[kWasClean] = options.wasClean === void 0 ? false : options.wasClean;
      }
      /**
       * @type {Number}
       */
      get code() {
        return this[kCode];
      }
      /**
       * @type {String}
       */
      get reason() {
        return this[kReason];
      }
      /**
       * @type {Boolean}
       */
      get wasClean() {
        return this[kWasClean];
      }
    };
    Object.defineProperty(CloseEvent.prototype, "code", { enumerable: true });
    Object.defineProperty(CloseEvent.prototype, "reason", { enumerable: true });
    Object.defineProperty(CloseEvent.prototype, "wasClean", { enumerable: true });
    var ErrorEvent = class extends Event {
      /**
       * Create a new `ErrorEvent`.
       *
       * @param {String} type The name of the event
       * @param {Object} [options] A dictionary object that allows for setting
       *     attributes via object members of the same name
       * @param {*} [options.error=null] The error that generated this event
       * @param {String} [options.message=''] The error message
       */
      constructor(type, options = {}) {
        super(type);
        this[kError] = options.error === void 0 ? null : options.error;
        this[kMessage] = options.message === void 0 ? "" : options.message;
      }
      /**
       * @type {*}
       */
      get error() {
        return this[kError];
      }
      /**
       * @type {String}
       */
      get message() {
        return this[kMessage];
      }
    };
    Object.defineProperty(ErrorEvent.prototype, "error", { enumerable: true });
    Object.defineProperty(ErrorEvent.prototype, "message", { enumerable: true });
    var MessageEvent = class extends Event {
      /**
       * Create a new `MessageEvent`.
       *
       * @param {String} type The name of the event
       * @param {Object} [options] A dictionary object that allows for setting
       *     attributes via object members of the same name
       * @param {*} [options.data=null] The message content
       */
      constructor(type, options = {}) {
        super(type);
        this[kData] = options.data === void 0 ? null : options.data;
      }
      /**
       * @type {*}
       */
      get data() {
        return this[kData];
      }
    };
    Object.defineProperty(MessageEvent.prototype, "data", { enumerable: true });
    var EventTarget = {
      /**
       * Register an event listener.
       *
       * @param {String} type A string representing the event type to listen for
       * @param {(Function|Object)} handler The listener to add
       * @param {Object} [options] An options object specifies characteristics about
       *     the event listener
       * @param {Boolean} [options.once=false] A `Boolean` indicating that the
       *     listener should be invoked at most once after being added. If `true`,
       *     the listener would be automatically removed when invoked.
       * @public
       */
      addEventListener(type, handler, options = {}) {
        for (const listener of this.listeners(type)) {
          if (!options[kForOnEventAttribute] && listener[kListener] === handler && !listener[kForOnEventAttribute]) {
            return;
          }
        }
        let wrapper;
        if (type === "message") {
          wrapper = function onMessage(data, isBinary) {
            const event = new MessageEvent("message", {
              data: isBinary ? data : data.toString()
            });
            event[kTarget] = this;
            callListener(handler, this, event);
          };
        } else if (type === "close") {
          wrapper = function onClose(code, message) {
            const event = new CloseEvent("close", {
              code,
              reason: message.toString(),
              wasClean: this._closeFrameReceived && this._closeFrameSent
            });
            event[kTarget] = this;
            callListener(handler, this, event);
          };
        } else if (type === "error") {
          wrapper = function onError(error) {
            const event = new ErrorEvent("error", {
              error,
              message: error.message
            });
            event[kTarget] = this;
            callListener(handler, this, event);
          };
        } else if (type === "open") {
          wrapper = function onOpen() {
            const event = new Event("open");
            event[kTarget] = this;
            callListener(handler, this, event);
          };
        } else {
          return;
        }
        wrapper[kForOnEventAttribute] = !!options[kForOnEventAttribute];
        wrapper[kListener] = handler;
        if (options.once) {
          this.once(type, wrapper);
        } else {
          this.on(type, wrapper);
        }
      },
      /**
       * Remove an event listener.
       *
       * @param {String} type A string representing the event type to remove
       * @param {(Function|Object)} handler The listener to remove
       * @public
       */
      removeEventListener(type, handler) {
        for (const listener of this.listeners(type)) {
          if (listener[kListener] === handler && !listener[kForOnEventAttribute]) {
            this.removeListener(type, listener);
            break;
          }
        }
      }
    };
    module.exports = {
      CloseEvent,
      ErrorEvent,
      Event,
      EventTarget,
      MessageEvent
    };
    function callListener(listener, thisArg, event) {
      if (typeof listener === "object" && listener.handleEvent) {
        listener.handleEvent.call(listener, event);
      } else {
        listener.call(thisArg, event);
      }
    }
  }
});

// ../../node_modules/ws/lib/extension.js
var require_extension = __commonJS({
  "../../node_modules/ws/lib/extension.js"(exports, module) {
    "use strict";
    var { tokenChars } = require_validation();
    function push(dest, name, elem) {
      if (dest[name] === void 0) dest[name] = [elem];
      else dest[name].push(elem);
    }
    function parse(header) {
      const offers = /* @__PURE__ */ Object.create(null);
      let params = /* @__PURE__ */ Object.create(null);
      let mustUnescape = false;
      let isEscaping = false;
      let inQuotes = false;
      let extensionName;
      let paramName;
      let start = -1;
      let code = -1;
      let end = -1;
      let i = 0;
      for (; i < header.length; i++) {
        code = header.charCodeAt(i);
        if (extensionName === void 0) {
          if (end === -1 && tokenChars[code] === 1) {
            if (start === -1) start = i;
          } else if (i !== 0 && (code === 32 || code === 9)) {
            if (end === -1 && start !== -1) end = i;
          } else if (code === 59 || code === 44) {
            if (start === -1) {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
            if (end === -1) end = i;
            const name = header.slice(start, end);
            if (code === 44) {
              push(offers, name, params);
              params = /* @__PURE__ */ Object.create(null);
            } else {
              extensionName = name;
            }
            start = end = -1;
          } else {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
        } else if (paramName === void 0) {
          if (end === -1 && tokenChars[code] === 1) {
            if (start === -1) start = i;
          } else if (code === 32 || code === 9) {
            if (end === -1 && start !== -1) end = i;
          } else if (code === 59 || code === 44) {
            if (start === -1) {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
            if (end === -1) end = i;
            push(params, header.slice(start, end), true);
            if (code === 44) {
              push(offers, extensionName, params);
              params = /* @__PURE__ */ Object.create(null);
              extensionName = void 0;
            }
            start = end = -1;
          } else if (code === 61 && start !== -1 && end === -1) {
            paramName = header.slice(start, i);
            start = end = -1;
          } else {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
        } else {
          if (isEscaping) {
            if (tokenChars[code] !== 1) {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
            if (start === -1) start = i;
            else if (!mustUnescape) mustUnescape = true;
            isEscaping = false;
          } else if (inQuotes) {
            if (tokenChars[code] === 1) {
              if (start === -1) start = i;
            } else if (code === 34 && start !== -1) {
              inQuotes = false;
              end = i;
            } else if (code === 92) {
              isEscaping = true;
            } else {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
          } else if (code === 34 && header.charCodeAt(i - 1) === 61) {
            inQuotes = true;
          } else if (end === -1 && tokenChars[code] === 1) {
            if (start === -1) start = i;
          } else if (start !== -1 && (code === 32 || code === 9)) {
            if (end === -1) end = i;
          } else if (code === 59 || code === 44) {
            if (start === -1) {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
            if (end === -1) end = i;
            let value = header.slice(start, end);
            if (mustUnescape) {
              value = value.replace(/\\/g, "");
              mustUnescape = false;
            }
            push(params, paramName, value);
            if (code === 44) {
              push(offers, extensionName, params);
              params = /* @__PURE__ */ Object.create(null);
              extensionName = void 0;
            }
            paramName = void 0;
            start = end = -1;
          } else {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
        }
      }
      if (start === -1 || inQuotes || code === 32 || code === 9) {
        throw new SyntaxError("Unexpected end of input");
      }
      if (end === -1) end = i;
      const token = header.slice(start, end);
      if (extensionName === void 0) {
        push(offers, token, params);
      } else {
        if (paramName === void 0) {
          push(params, token, true);
        } else if (mustUnescape) {
          push(params, paramName, token.replace(/\\/g, ""));
        } else {
          push(params, paramName, token);
        }
        push(offers, extensionName, params);
      }
      return offers;
    }
    function format(extensions) {
      return Object.keys(extensions).map((extension2) => {
        let configurations = extensions[extension2];
        if (!Array.isArray(configurations)) configurations = [configurations];
        return configurations.map((params) => {
          return [extension2].concat(
            Object.keys(params).map((k) => {
              let values = params[k];
              if (!Array.isArray(values)) values = [values];
              return values.map((v) => v === true ? k : `${k}=${v}`).join("; ");
            })
          ).join("; ");
        }).join(", ");
      }).join(", ");
    }
    module.exports = { format, parse };
  }
});

// ../../node_modules/ws/lib/websocket.js
var require_websocket = __commonJS({
  "../../node_modules/ws/lib/websocket.js"(exports, module) {
    "use strict";
    var EventEmitter = __require("events");
    var https = __require("https");
    var http = __require("http");
    var net = __require("net");
    var tls = __require("tls");
    var { randomBytes: randomBytes2, createHash } = __require("crypto");
    var { Duplex, Readable } = __require("stream");
    var { URL: URL2 } = __require("url");
    var PerMessageDeflate2 = require_permessage_deflate();
    var Receiver2 = require_receiver();
    var Sender2 = require_sender();
    var { isBlob } = require_validation();
    var {
      BINARY_TYPES,
      CLOSE_TIMEOUT,
      EMPTY_BUFFER,
      GUID,
      kForOnEventAttribute,
      kListener,
      kStatusCode,
      kWebSocket,
      NOOP
    } = require_constants();
    var {
      EventTarget: { addEventListener, removeEventListener }
    } = require_event_target();
    var { format, parse } = require_extension();
    var { toBuffer } = require_buffer_util();
    var kAborted = Symbol("kAborted");
    var protocolVersions = [8, 13];
    var readyStates = ["CONNECTING", "OPEN", "CLOSING", "CLOSED"];
    var subprotocolRegex = /^[!#$%&'*+\-.0-9A-Z^_`|a-z~]+$/;
    var WebSocket2 = class _WebSocket extends EventEmitter {
      /**
       * Create a new `WebSocket`.
       *
       * @param {(String|URL)} address The URL to which to connect
       * @param {(String|String[])} [protocols] The subprotocols
       * @param {Object} [options] Connection options
       */
      constructor(address, protocols, options) {
        super();
        this._binaryType = BINARY_TYPES[0];
        this._closeCode = 1006;
        this._closeFrameReceived = false;
        this._closeFrameSent = false;
        this._closeMessage = EMPTY_BUFFER;
        this._closeTimer = null;
        this._errorEmitted = false;
        this._extensions = {};
        this._paused = false;
        this._protocol = "";
        this._readyState = _WebSocket.CONNECTING;
        this._receiver = null;
        this._sender = null;
        this._socket = null;
        if (address !== null) {
          this._bufferedAmount = 0;
          this._isServer = false;
          this._redirects = 0;
          if (protocols === void 0) {
            protocols = [];
          } else if (!Array.isArray(protocols)) {
            if (typeof protocols === "object" && protocols !== null) {
              options = protocols;
              protocols = [];
            } else {
              protocols = [protocols];
            }
          }
          initAsClient(this, address, protocols, options);
        } else {
          this._autoPong = options.autoPong;
          this._closeTimeout = options.closeTimeout;
          this._isServer = true;
        }
      }
      /**
       * For historical reasons, the custom "nodebuffer" type is used by the default
       * instead of "blob".
       *
       * @type {String}
       */
      get binaryType() {
        return this._binaryType;
      }
      set binaryType(type) {
        if (!BINARY_TYPES.includes(type)) return;
        this._binaryType = type;
        if (this._receiver) this._receiver._binaryType = type;
      }
      /**
       * @type {Number}
       */
      get bufferedAmount() {
        if (!this._socket) return this._bufferedAmount;
        return this._socket._writableState.length + this._sender._bufferedBytes;
      }
      /**
       * @type {String}
       */
      get extensions() {
        return Object.keys(this._extensions).join();
      }
      /**
       * @type {Boolean}
       */
      get isPaused() {
        return this._paused;
      }
      /**
       * @type {Function}
       */
      /* istanbul ignore next */
      get onclose() {
        return null;
      }
      /**
       * @type {Function}
       */
      /* istanbul ignore next */
      get onerror() {
        return null;
      }
      /**
       * @type {Function}
       */
      /* istanbul ignore next */
      get onopen() {
        return null;
      }
      /**
       * @type {Function}
       */
      /* istanbul ignore next */
      get onmessage() {
        return null;
      }
      /**
       * @type {String}
       */
      get protocol() {
        return this._protocol;
      }
      /**
       * @type {Number}
       */
      get readyState() {
        return this._readyState;
      }
      /**
       * @type {String}
       */
      get url() {
        return this._url;
      }
      /**
       * Set up the socket and the internal resources.
       *
       * @param {Duplex} socket The network socket between the server and client
       * @param {Buffer} head The first packet of the upgraded stream
       * @param {Object} options Options object
       * @param {Boolean} [options.allowSynchronousEvents=false] Specifies whether
       *     any of the `'message'`, `'ping'`, and `'pong'` events can be emitted
       *     multiple times in the same tick
       * @param {Function} [options.generateMask] The function used to generate the
       *     masking key
       * @param {Number} [options.maxBufferedChunks=0] The maximum number of
       *     buffered data chunks
       * @param {Number} [options.maxFragments=0] The maximum number of message
       *     fragments
       * @param {Number} [options.maxPayload=0] The maximum allowed message size
       * @param {Boolean} [options.skipUTF8Validation=false] Specifies whether or
       *     not to skip UTF-8 validation for text and close messages
       * @private
       */
      setSocket(socket, head, options) {
        const receiver = new Receiver2({
          allowSynchronousEvents: options.allowSynchronousEvents,
          binaryType: this.binaryType,
          extensions: this._extensions,
          isServer: this._isServer,
          maxBufferedChunks: options.maxBufferedChunks,
          maxFragments: options.maxFragments,
          maxPayload: options.maxPayload,
          skipUTF8Validation: options.skipUTF8Validation
        });
        const sender = new Sender2(socket, this._extensions, options.generateMask);
        this._receiver = receiver;
        this._sender = sender;
        this._socket = socket;
        receiver[kWebSocket] = this;
        sender[kWebSocket] = this;
        socket[kWebSocket] = this;
        receiver.on("conclude", receiverOnConclude);
        receiver.on("drain", receiverOnDrain);
        receiver.on("error", receiverOnError);
        receiver.on("message", receiverOnMessage);
        receiver.on("ping", receiverOnPing);
        receiver.on("pong", receiverOnPong);
        sender.onerror = senderOnError;
        if (socket.setTimeout) socket.setTimeout(0);
        if (socket.setNoDelay) socket.setNoDelay();
        if (head.length > 0) socket.unshift(head);
        socket.on("close", socketOnClose);
        socket.on("data", socketOnData);
        socket.on("end", socketOnEnd);
        socket.on("error", socketOnError);
        this._readyState = _WebSocket.OPEN;
        this.emit("open");
      }
      /**
       * Emit the `'close'` event.
       *
       * @private
       */
      emitClose() {
        if (!this._socket) {
          this._readyState = _WebSocket.CLOSED;
          this.emit("close", this._closeCode, this._closeMessage);
          return;
        }
        if (this._extensions[PerMessageDeflate2.extensionName]) {
          this._extensions[PerMessageDeflate2.extensionName].cleanup();
        }
        this._receiver.removeAllListeners();
        this._readyState = _WebSocket.CLOSED;
        this.emit("close", this._closeCode, this._closeMessage);
      }
      /**
       * Start a closing handshake.
       *
       *          +----------+   +-----------+   +----------+
       *     - - -|ws.close()|-->|close frame|-->|ws.close()|- - -
       *    |     +----------+   +-----------+   +----------+     |
       *          +----------+   +-----------+         |
       * CLOSING  |ws.close()|<--|close frame|<--+-----+       CLOSING
       *          +----------+   +-----------+   |
       *    |           |                        |   +---+        |
       *                +------------------------+-->|fin| - - - -
       *    |         +---+                      |   +---+
       *     - - - - -|fin|<---------------------+
       *              +---+
       *
       * @param {Number} [code] Status code explaining why the connection is closing
       * @param {(String|Buffer)} [data] The reason why the connection is
       *     closing
       * @public
       */
      close(code, data) {
        if (this.readyState === _WebSocket.CLOSED) return;
        if (this.readyState === _WebSocket.CONNECTING) {
          const msg = "WebSocket was closed before the connection was established";
          abortHandshake(this, this._req, msg);
          return;
        }
        if (this.readyState === _WebSocket.CLOSING) {
          if (this._closeFrameSent && (this._closeFrameReceived || this._receiver._writableState.errorEmitted)) {
            this._socket.end();
          }
          return;
        }
        this._readyState = _WebSocket.CLOSING;
        this._sender.close(code, data, !this._isServer, (err) => {
          if (err) return;
          this._closeFrameSent = true;
          if (this._closeFrameReceived || this._receiver._writableState.errorEmitted) {
            this._socket.end();
          }
        });
        setCloseTimer(this);
      }
      /**
       * Pause the socket.
       *
       * @public
       */
      pause() {
        if (this.readyState === _WebSocket.CONNECTING || this.readyState === _WebSocket.CLOSED) {
          return;
        }
        this._paused = true;
        this._socket.pause();
      }
      /**
       * Send a ping.
       *
       * @param {*} [data] The data to send
       * @param {Boolean} [mask] Indicates whether or not to mask `data`
       * @param {Function} [cb] Callback which is executed when the ping is sent
       * @public
       */
      ping(data, mask, cb) {
        if (this.readyState === _WebSocket.CONNECTING) {
          throw new Error("WebSocket is not open: readyState 0 (CONNECTING)");
        }
        if (typeof data === "function") {
          cb = data;
          data = mask = void 0;
        } else if (typeof mask === "function") {
          cb = mask;
          mask = void 0;
        }
        if (typeof data === "number") data = data.toString();
        if (this.readyState !== _WebSocket.OPEN) {
          sendAfterClose(this, data, cb);
          return;
        }
        if (mask === void 0) mask = !this._isServer;
        this._sender.ping(data || EMPTY_BUFFER, mask, cb);
      }
      /**
       * Send a pong.
       *
       * @param {*} [data] The data to send
       * @param {Boolean} [mask] Indicates whether or not to mask `data`
       * @param {Function} [cb] Callback which is executed when the pong is sent
       * @public
       */
      pong(data, mask, cb) {
        if (this.readyState === _WebSocket.CONNECTING) {
          throw new Error("WebSocket is not open: readyState 0 (CONNECTING)");
        }
        if (typeof data === "function") {
          cb = data;
          data = mask = void 0;
        } else if (typeof mask === "function") {
          cb = mask;
          mask = void 0;
        }
        if (typeof data === "number") data = data.toString();
        if (this.readyState !== _WebSocket.OPEN) {
          sendAfterClose(this, data, cb);
          return;
        }
        if (mask === void 0) mask = !this._isServer;
        this._sender.pong(data || EMPTY_BUFFER, mask, cb);
      }
      /**
       * Resume the socket.
       *
       * @public
       */
      resume() {
        if (this.readyState === _WebSocket.CONNECTING || this.readyState === _WebSocket.CLOSED) {
          return;
        }
        this._paused = false;
        if (!this._receiver._writableState.needDrain) this._socket.resume();
      }
      /**
       * Send a data message.
       *
       * @param {*} data The message to send
       * @param {Object} [options] Options object
       * @param {Boolean} [options.binary] Specifies whether `data` is binary or
       *     text
       * @param {Boolean} [options.compress] Specifies whether or not to compress
       *     `data`
       * @param {Boolean} [options.fin=true] Specifies whether the fragment is the
       *     last one
       * @param {Boolean} [options.mask] Specifies whether or not to mask `data`
       * @param {Function} [cb] Callback which is executed when data is written out
       * @public
       */
      send(data, options, cb) {
        if (this.readyState === _WebSocket.CONNECTING) {
          throw new Error("WebSocket is not open: readyState 0 (CONNECTING)");
        }
        if (typeof options === "function") {
          cb = options;
          options = {};
        }
        if (typeof data === "number") data = data.toString();
        if (this.readyState !== _WebSocket.OPEN) {
          sendAfterClose(this, data, cb);
          return;
        }
        const opts = {
          binary: typeof data !== "string",
          mask: !this._isServer,
          compress: true,
          fin: true,
          ...options
        };
        if (!this._extensions[PerMessageDeflate2.extensionName]) {
          opts.compress = false;
        }
        this._sender.send(data || EMPTY_BUFFER, opts, cb);
      }
      /**
       * Forcibly close the connection.
       *
       * @public
       */
      terminate() {
        if (this.readyState === _WebSocket.CLOSED) return;
        if (this.readyState === _WebSocket.CONNECTING) {
          const msg = "WebSocket was closed before the connection was established";
          abortHandshake(this, this._req, msg);
          return;
        }
        if (this._socket) {
          this._readyState = _WebSocket.CLOSING;
          this._socket.destroy();
        }
      }
    };
    Object.defineProperty(WebSocket2, "CONNECTING", {
      enumerable: true,
      value: readyStates.indexOf("CONNECTING")
    });
    Object.defineProperty(WebSocket2.prototype, "CONNECTING", {
      enumerable: true,
      value: readyStates.indexOf("CONNECTING")
    });
    Object.defineProperty(WebSocket2, "OPEN", {
      enumerable: true,
      value: readyStates.indexOf("OPEN")
    });
    Object.defineProperty(WebSocket2.prototype, "OPEN", {
      enumerable: true,
      value: readyStates.indexOf("OPEN")
    });
    Object.defineProperty(WebSocket2, "CLOSING", {
      enumerable: true,
      value: readyStates.indexOf("CLOSING")
    });
    Object.defineProperty(WebSocket2.prototype, "CLOSING", {
      enumerable: true,
      value: readyStates.indexOf("CLOSING")
    });
    Object.defineProperty(WebSocket2, "CLOSED", {
      enumerable: true,
      value: readyStates.indexOf("CLOSED")
    });
    Object.defineProperty(WebSocket2.prototype, "CLOSED", {
      enumerable: true,
      value: readyStates.indexOf("CLOSED")
    });
    [
      "binaryType",
      "bufferedAmount",
      "extensions",
      "isPaused",
      "protocol",
      "readyState",
      "url"
    ].forEach((property) => {
      Object.defineProperty(WebSocket2.prototype, property, { enumerable: true });
    });
    ["open", "error", "close", "message"].forEach((method) => {
      Object.defineProperty(WebSocket2.prototype, `on${method}`, {
        enumerable: true,
        get() {
          for (const listener of this.listeners(method)) {
            if (listener[kForOnEventAttribute]) return listener[kListener];
          }
          return null;
        },
        set(handler) {
          for (const listener of this.listeners(method)) {
            if (listener[kForOnEventAttribute]) {
              this.removeListener(method, listener);
              break;
            }
          }
          if (typeof handler !== "function") return;
          this.addEventListener(method, handler, {
            [kForOnEventAttribute]: true
          });
        }
      });
    });
    WebSocket2.prototype.addEventListener = addEventListener;
    WebSocket2.prototype.removeEventListener = removeEventListener;
    module.exports = WebSocket2;
    function initAsClient(websocket, address, protocols, options) {
      const opts = {
        allowSynchronousEvents: true,
        autoPong: true,
        closeTimeout: CLOSE_TIMEOUT,
        protocolVersion: protocolVersions[1],
        maxBufferedChunks: 256 * 1024,
        maxFragments: 16 * 1024,
        maxPayload: 100 * 1024 * 1024,
        skipUTF8Validation: false,
        perMessageDeflate: true,
        followRedirects: false,
        maxRedirects: 10,
        ...options,
        socketPath: void 0,
        hostname: void 0,
        protocol: void 0,
        timeout: void 0,
        method: "GET",
        host: void 0,
        path: void 0,
        port: void 0
      };
      websocket._autoPong = opts.autoPong;
      websocket._closeTimeout = opts.closeTimeout;
      if (!protocolVersions.includes(opts.protocolVersion)) {
        throw new RangeError(
          `Unsupported protocol version: ${opts.protocolVersion} (supported versions: ${protocolVersions.join(", ")})`
        );
      }
      let parsedUrl;
      if (address instanceof URL2) {
        parsedUrl = address;
      } else {
        try {
          parsedUrl = new URL2(address);
        } catch {
          throw new SyntaxError(`Invalid URL: ${address}`);
        }
      }
      if (parsedUrl.protocol === "http:") {
        parsedUrl.protocol = "ws:";
      } else if (parsedUrl.protocol === "https:") {
        parsedUrl.protocol = "wss:";
      }
      websocket._url = parsedUrl.href;
      const isSecure = parsedUrl.protocol === "wss:";
      const isIpcUrl = parsedUrl.protocol === "ws+unix:";
      let invalidUrlMessage;
      if (parsedUrl.protocol !== "ws:" && !isSecure && !isIpcUrl) {
        invalidUrlMessage = `The URL's protocol must be one of "ws:", "wss:", "http:", "https:", or "ws+unix:"`;
      } else if (isIpcUrl && !parsedUrl.pathname) {
        invalidUrlMessage = "The URL's pathname is empty";
      } else if (parsedUrl.hash) {
        invalidUrlMessage = "The URL contains a fragment identifier";
      }
      if (invalidUrlMessage) {
        const err = new SyntaxError(invalidUrlMessage);
        if (websocket._redirects === 0) {
          throw err;
        } else {
          emitErrorAndClose(websocket, err);
          return;
        }
      }
      const defaultPort = isSecure ? 443 : 80;
      const key = randomBytes2(16).toString("base64");
      const request = isSecure ? https.request : http.request;
      const protocolSet = /* @__PURE__ */ new Set();
      let perMessageDeflate;
      opts.createConnection = opts.createConnection || (isSecure ? tlsConnect : netConnect);
      opts.defaultPort = opts.defaultPort || defaultPort;
      opts.port = parsedUrl.port || defaultPort;
      opts.host = parsedUrl.hostname.startsWith("[") ? parsedUrl.hostname.slice(1, -1) : parsedUrl.hostname;
      opts.headers = {
        ...opts.headers,
        "Sec-WebSocket-Version": opts.protocolVersion,
        "Sec-WebSocket-Key": key,
        Connection: "Upgrade",
        Upgrade: "websocket"
      };
      opts.path = parsedUrl.pathname + parsedUrl.search;
      opts.timeout = opts.handshakeTimeout;
      if (opts.perMessageDeflate) {
        perMessageDeflate = new PerMessageDeflate2({
          ...opts.perMessageDeflate,
          isServer: false,
          maxPayload: opts.maxPayload
        });
        opts.headers["Sec-WebSocket-Extensions"] = format({
          [PerMessageDeflate2.extensionName]: perMessageDeflate.offer()
        });
      }
      if (protocols.length) {
        for (const protocol of protocols) {
          if (typeof protocol !== "string" || !subprotocolRegex.test(protocol) || protocolSet.has(protocol)) {
            throw new SyntaxError(
              "An invalid or duplicated subprotocol was specified"
            );
          }
          protocolSet.add(protocol);
        }
        opts.headers["Sec-WebSocket-Protocol"] = protocols.join(",");
      }
      if (opts.origin) {
        if (opts.protocolVersion < 13) {
          opts.headers["Sec-WebSocket-Origin"] = opts.origin;
        } else {
          opts.headers.Origin = opts.origin;
        }
      }
      if (parsedUrl.username || parsedUrl.password) {
        opts.auth = `${parsedUrl.username}:${parsedUrl.password}`;
      }
      if (isIpcUrl) {
        const parts = opts.path.split(":");
        opts.socketPath = parts[0];
        opts.path = parts[1];
      }
      let req;
      if (opts.followRedirects) {
        if (websocket._redirects === 0) {
          websocket._originalIpc = isIpcUrl;
          websocket._originalSecure = isSecure;
          websocket._originalHostOrSocketPath = isIpcUrl ? opts.socketPath : parsedUrl.host;
          const headers = options && options.headers;
          options = { ...options, headers: {} };
          if (headers) {
            for (const [key2, value] of Object.entries(headers)) {
              options.headers[key2.toLowerCase()] = value;
            }
          }
        } else if (websocket.listenerCount("redirect") === 0) {
          const isSameHost = isIpcUrl ? websocket._originalIpc ? opts.socketPath === websocket._originalHostOrSocketPath : false : websocket._originalIpc ? false : parsedUrl.host === websocket._originalHostOrSocketPath;
          if (!isSameHost || websocket._originalSecure && !isSecure) {
            delete opts.headers.authorization;
            delete opts.headers.cookie;
            if (!isSameHost) delete opts.headers.host;
            opts.auth = void 0;
          }
        }
        if (opts.auth && !options.headers.authorization) {
          options.headers.authorization = "Basic " + Buffer.from(opts.auth).toString("base64");
        }
        req = websocket._req = request(opts);
        if (websocket._redirects) {
          websocket.emit("redirect", websocket.url, req);
        }
      } else {
        req = websocket._req = request(opts);
      }
      if (opts.timeout) {
        req.on("timeout", () => {
          abortHandshake(websocket, req, "Opening handshake has timed out");
        });
      }
      req.on("error", (err) => {
        if (req === null || req[kAborted]) return;
        req = websocket._req = null;
        emitErrorAndClose(websocket, err);
      });
      req.on("response", (res) => {
        const location = res.headers.location;
        const statusCode = res.statusCode;
        if (location && opts.followRedirects && statusCode >= 300 && statusCode < 400) {
          if (++websocket._redirects > opts.maxRedirects) {
            abortHandshake(websocket, req, "Maximum redirects exceeded");
            return;
          }
          req.abort();
          let addr;
          try {
            addr = new URL2(location, address);
          } catch (e) {
            const err = new SyntaxError(`Invalid URL: ${location}`);
            emitErrorAndClose(websocket, err);
            return;
          }
          initAsClient(websocket, addr, protocols, options);
        } else if (!websocket.emit("unexpected-response", req, res)) {
          abortHandshake(
            websocket,
            req,
            `Unexpected server response: ${res.statusCode}`
          );
        }
      });
      req.on("upgrade", (res, socket, head) => {
        websocket.emit("upgrade", res);
        if (websocket.readyState !== WebSocket2.CONNECTING) return;
        req = websocket._req = null;
        const upgrade = res.headers.upgrade;
        if (upgrade === void 0 || upgrade.toLowerCase() !== "websocket") {
          abortHandshake(websocket, socket, "Invalid Upgrade header");
          return;
        }
        const digest = createHash("sha1").update(key + GUID).digest("base64");
        if (res.headers["sec-websocket-accept"] !== digest) {
          abortHandshake(websocket, socket, "Invalid Sec-WebSocket-Accept header");
          return;
        }
        const serverProt = res.headers["sec-websocket-protocol"];
        let protError;
        if (serverProt !== void 0) {
          if (!protocolSet.size) {
            protError = "Server sent a subprotocol but none was requested";
          } else if (!protocolSet.has(serverProt)) {
            protError = "Server sent an invalid subprotocol";
          }
        } else if (protocolSet.size) {
          protError = "Server sent no subprotocol";
        }
        if (protError) {
          abortHandshake(websocket, socket, protError);
          return;
        }
        if (serverProt) websocket._protocol = serverProt;
        const secWebSocketExtensions = res.headers["sec-websocket-extensions"];
        if (secWebSocketExtensions !== void 0) {
          if (!perMessageDeflate) {
            const message = "Server sent a Sec-WebSocket-Extensions header but no extension was requested";
            abortHandshake(websocket, socket, message);
            return;
          }
          let extensions;
          try {
            extensions = parse(secWebSocketExtensions);
          } catch (err) {
            const message = "Invalid Sec-WebSocket-Extensions header";
            abortHandshake(websocket, socket, message);
            return;
          }
          const extensionNames = Object.keys(extensions);
          if (extensionNames.length !== 1 || extensionNames[0] !== PerMessageDeflate2.extensionName) {
            const message = "Server indicated an extension that was not requested";
            abortHandshake(websocket, socket, message);
            return;
          }
          try {
            perMessageDeflate.accept(extensions[PerMessageDeflate2.extensionName]);
          } catch (err) {
            const message = "Invalid Sec-WebSocket-Extensions header";
            abortHandshake(websocket, socket, message);
            return;
          }
          websocket._extensions[PerMessageDeflate2.extensionName] = perMessageDeflate;
        }
        websocket.setSocket(socket, head, {
          allowSynchronousEvents: opts.allowSynchronousEvents,
          generateMask: opts.generateMask,
          maxBufferedChunks: opts.maxBufferedChunks,
          maxFragments: opts.maxFragments,
          maxPayload: opts.maxPayload,
          skipUTF8Validation: opts.skipUTF8Validation
        });
      });
      if (opts.finishRequest) {
        opts.finishRequest(req, websocket);
      } else {
        req.end();
      }
    }
    function emitErrorAndClose(websocket, err) {
      websocket._readyState = WebSocket2.CLOSING;
      websocket._errorEmitted = true;
      websocket.emit("error", err);
      websocket.emitClose();
    }
    function netConnect(options) {
      options.path = options.socketPath;
      return net.connect(options);
    }
    function tlsConnect(options) {
      options.path = void 0;
      if (!options.servername && options.servername !== "") {
        options.servername = net.isIP(options.host) ? "" : options.host;
      }
      return tls.connect(options);
    }
    function abortHandshake(websocket, stream, message) {
      websocket._readyState = WebSocket2.CLOSING;
      const err = new Error(message);
      Error.captureStackTrace(err, abortHandshake);
      if (stream.setHeader) {
        stream[kAborted] = true;
        stream.abort();
        if (stream.socket && !stream.socket.destroyed) {
          stream.socket.destroy();
        }
        process.nextTick(emitErrorAndClose, websocket, err);
      } else {
        stream.destroy(err);
        stream.once("error", websocket.emit.bind(websocket, "error"));
        stream.once("close", websocket.emitClose.bind(websocket));
      }
    }
    function sendAfterClose(websocket, data, cb) {
      if (data) {
        const length = isBlob(data) ? data.size : toBuffer(data).length;
        if (websocket._socket) websocket._sender._bufferedBytes += length;
        else websocket._bufferedAmount += length;
      }
      if (cb) {
        const err = new Error(
          `WebSocket is not open: readyState ${websocket.readyState} (${readyStates[websocket.readyState]})`
        );
        process.nextTick(cb, err);
      }
    }
    function receiverOnConclude(code, reason) {
      const websocket = this[kWebSocket];
      websocket._closeFrameReceived = true;
      websocket._closeMessage = reason;
      websocket._closeCode = code;
      if (websocket._socket[kWebSocket] === void 0) return;
      websocket._socket.removeListener("data", socketOnData);
      process.nextTick(resume, websocket._socket);
      if (code === 1005) websocket.close();
      else websocket.close(code, reason);
    }
    function receiverOnDrain() {
      const websocket = this[kWebSocket];
      if (!websocket.isPaused) websocket._socket.resume();
    }
    function receiverOnError(err) {
      const websocket = this[kWebSocket];
      if (websocket._socket[kWebSocket] !== void 0) {
        websocket._socket.removeListener("data", socketOnData);
        process.nextTick(resume, websocket._socket);
        websocket.close(err[kStatusCode]);
      }
      if (!websocket._errorEmitted) {
        websocket._errorEmitted = true;
        websocket.emit("error", err);
      }
    }
    function receiverOnFinish() {
      this[kWebSocket].emitClose();
    }
    function receiverOnMessage(data, isBinary) {
      this[kWebSocket].emit("message", data, isBinary);
    }
    function receiverOnPing(data) {
      const websocket = this[kWebSocket];
      if (websocket._autoPong) websocket.pong(data, !this._isServer, NOOP);
      websocket.emit("ping", data);
    }
    function receiverOnPong(data) {
      this[kWebSocket].emit("pong", data);
    }
    function resume(stream) {
      stream.resume();
    }
    function senderOnError(err) {
      const websocket = this[kWebSocket];
      if (websocket.readyState === WebSocket2.CLOSED) return;
      if (websocket.readyState === WebSocket2.OPEN) {
        websocket._readyState = WebSocket2.CLOSING;
        setCloseTimer(websocket);
      }
      this._socket.end();
      if (!websocket._errorEmitted) {
        websocket._errorEmitted = true;
        websocket.emit("error", err);
      }
    }
    function setCloseTimer(websocket) {
      websocket._closeTimer = setTimeout(
        websocket._socket.destroy.bind(websocket._socket),
        websocket._closeTimeout
      );
    }
    function socketOnClose() {
      const websocket = this[kWebSocket];
      this.removeListener("close", socketOnClose);
      this.removeListener("data", socketOnData);
      this.removeListener("end", socketOnEnd);
      websocket._readyState = WebSocket2.CLOSING;
      if (!this._readableState.endEmitted && !websocket._closeFrameReceived && !websocket._receiver._writableState.errorEmitted && this._readableState.length !== 0) {
        const chunk = this.read(this._readableState.length);
        websocket._receiver.write(chunk);
      }
      websocket._receiver.end();
      this[kWebSocket] = void 0;
      clearTimeout(websocket._closeTimer);
      if (websocket._receiver._writableState.finished || websocket._receiver._writableState.errorEmitted) {
        websocket.emitClose();
      } else {
        websocket._receiver.on("error", receiverOnFinish);
        websocket._receiver.on("finish", receiverOnFinish);
      }
    }
    function socketOnData(chunk) {
      if (!this[kWebSocket]._receiver.write(chunk)) {
        this.pause();
      }
    }
    function socketOnEnd() {
      const websocket = this[kWebSocket];
      websocket._readyState = WebSocket2.CLOSING;
      websocket._receiver.end();
      this.end();
    }
    function socketOnError() {
      const websocket = this[kWebSocket];
      this.removeListener("error", socketOnError);
      this.on("error", NOOP);
      if (websocket) {
        websocket._readyState = WebSocket2.CLOSING;
        this.destroy();
      }
    }
  }
});

// ../../node_modules/ws/lib/stream.js
var require_stream = __commonJS({
  "../../node_modules/ws/lib/stream.js"(exports, module) {
    "use strict";
    var WebSocket2 = require_websocket();
    var { Duplex } = __require("stream");
    function emitClose(stream) {
      stream.emit("close");
    }
    function duplexOnEnd() {
      if (!this.destroyed && this._writableState.finished) {
        this.destroy();
      }
    }
    function duplexOnError(err) {
      this.removeListener("error", duplexOnError);
      this.destroy();
      if (this.listenerCount("error") === 0) {
        this.emit("error", err);
      }
    }
    function createWebSocketStream2(ws, options) {
      let terminateOnDestroy = true;
      const duplex = new Duplex({
        ...options,
        autoDestroy: false,
        emitClose: false,
        objectMode: false,
        writableObjectMode: false
      });
      ws.on("message", function message(msg, isBinary) {
        const data = !isBinary && duplex._readableState.objectMode ? msg.toString() : msg;
        if (!duplex.push(data)) ws.pause();
      });
      ws.once("error", function error(err) {
        if (duplex.destroyed) return;
        terminateOnDestroy = false;
        duplex.destroy(err);
      });
      ws.once("close", function close() {
        if (duplex.destroyed) return;
        duplex.push(null);
      });
      duplex._destroy = function(err, callback) {
        if (ws.readyState === ws.CLOSED) {
          callback(err);
          process.nextTick(emitClose, duplex);
          return;
        }
        let called = false;
        ws.once("error", function error(err2) {
          called = true;
          callback(err2);
        });
        ws.once("close", function close() {
          if (!called) callback(err);
          process.nextTick(emitClose, duplex);
        });
        if (terminateOnDestroy) ws.terminate();
      };
      duplex._final = function(callback) {
        if (ws.readyState === ws.CONNECTING) {
          ws.once("open", function open() {
            duplex._final(callback);
          });
          return;
        }
        if (ws._socket === null) return;
        if (ws._socket._writableState.finished) {
          callback();
          if (duplex._readableState.endEmitted) duplex.destroy();
        } else {
          ws._socket.once("finish", function finish() {
            callback();
          });
          ws.close();
        }
      };
      duplex._read = function() {
        if (ws.isPaused) ws.resume();
      };
      duplex._write = function(chunk, encoding, callback) {
        if (ws.readyState === ws.CONNECTING) {
          ws.once("open", function open() {
            duplex._write(chunk, encoding, callback);
          });
          return;
        }
        ws.send(chunk, callback);
      };
      duplex.on("end", duplexOnEnd);
      duplex.on("error", duplexOnError);
      return duplex;
    }
    module.exports = createWebSocketStream2;
  }
});

// ../../node_modules/ws/lib/subprotocol.js
var require_subprotocol = __commonJS({
  "../../node_modules/ws/lib/subprotocol.js"(exports, module) {
    "use strict";
    var { tokenChars } = require_validation();
    function parse(header) {
      const protocols = /* @__PURE__ */ new Set();
      let start = -1;
      let end = -1;
      let i = 0;
      for (i; i < header.length; i++) {
        const code = header.charCodeAt(i);
        if (end === -1 && tokenChars[code] === 1) {
          if (start === -1) start = i;
        } else if (i !== 0 && (code === 32 || code === 9)) {
          if (end === -1 && start !== -1) end = i;
        } else if (code === 44) {
          if (start === -1) {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
          if (end === -1) end = i;
          const protocol2 = header.slice(start, end);
          if (protocols.has(protocol2)) {
            throw new SyntaxError(`The "${protocol2}" subprotocol is duplicated`);
          }
          protocols.add(protocol2);
          start = end = -1;
        } else {
          throw new SyntaxError(`Unexpected character at index ${i}`);
        }
      }
      if (start === -1 || end !== -1) {
        throw new SyntaxError("Unexpected end of input");
      }
      const protocol = header.slice(start, i);
      if (protocols.has(protocol)) {
        throw new SyntaxError(`The "${protocol}" subprotocol is duplicated`);
      }
      protocols.add(protocol);
      return protocols;
    }
    module.exports = { parse };
  }
});

// ../../node_modules/ws/lib/websocket-server.js
var require_websocket_server = __commonJS({
  "../../node_modules/ws/lib/websocket-server.js"(exports, module) {
    "use strict";
    var EventEmitter = __require("events");
    var http = __require("http");
    var { Duplex } = __require("stream");
    var { createHash } = __require("crypto");
    var extension2 = require_extension();
    var PerMessageDeflate2 = require_permessage_deflate();
    var subprotocol2 = require_subprotocol();
    var WebSocket2 = require_websocket();
    var { CLOSE_TIMEOUT, GUID, kWebSocket } = require_constants();
    var keyRegex = /^[+/0-9A-Za-z]{22}==$/;
    var RUNNING = 0;
    var CLOSING = 1;
    var CLOSED = 2;
    var WebSocketServer2 = class extends EventEmitter {
      /**
       * Create a `WebSocketServer` instance.
       *
       * @param {Object} options Configuration options
       * @param {Boolean} [options.allowSynchronousEvents=true] Specifies whether
       *     any of the `'message'`, `'ping'`, and `'pong'` events can be emitted
       *     multiple times in the same tick
       * @param {Boolean} [options.autoPong=true] Specifies whether or not to
       *     automatically send a pong in response to a ping
       * @param {Number} [options.backlog=511] The maximum length of the queue of
       *     pending connections
       * @param {Boolean} [options.clientTracking=true] Specifies whether or not to
       *     track clients
       * @param {Number} [options.closeTimeout=30000] Duration in milliseconds to
       *     wait for the closing handshake to finish after `websocket.close()` is
       *     called
       * @param {Function} [options.handleProtocols] A hook to handle protocols
       * @param {String} [options.host] The hostname where to bind the server
       * @param {Number} [options.maxBufferedChunks=262144] The maximum number of
       *     buffered data chunks
       * @param {Number} [options.maxFragments=16384] The maximum number of message
       *     fragments
       * @param {Number} [options.maxPayload=104857600] The maximum allowed message
       *     size
       * @param {Boolean} [options.noServer=false] Enable no server mode
       * @param {String} [options.path] Accept only connections matching this path
       * @param {(Boolean|Object)} [options.perMessageDeflate=false] Enable/disable
       *     permessage-deflate
       * @param {Number} [options.port] The port where to bind the server
       * @param {(http.Server|https.Server)} [options.server] A pre-created HTTP/S
       *     server to use
       * @param {Boolean} [options.skipUTF8Validation=false] Specifies whether or
       *     not to skip UTF-8 validation for text and close messages
       * @param {Function} [options.verifyClient] A hook to reject connections
       * @param {Function} [options.WebSocket=WebSocket] Specifies the `WebSocket`
       *     class to use. It must be the `WebSocket` class or class that extends it
       * @param {Function} [callback] A listener for the `listening` event
       */
      constructor(options, callback) {
        super();
        options = {
          allowSynchronousEvents: true,
          autoPong: true,
          maxBufferedChunks: 256 * 1024,
          maxFragments: 16 * 1024,
          maxPayload: 100 * 1024 * 1024,
          skipUTF8Validation: false,
          perMessageDeflate: false,
          handleProtocols: null,
          clientTracking: true,
          closeTimeout: CLOSE_TIMEOUT,
          verifyClient: null,
          noServer: false,
          backlog: null,
          // use default (511 as implemented in net.js)
          server: null,
          host: null,
          path: null,
          port: null,
          WebSocket: WebSocket2,
          ...options
        };
        if (options.port == null && !options.server && !options.noServer || options.port != null && (options.server || options.noServer) || options.server && options.noServer) {
          throw new TypeError(
            'One and only one of the "port", "server", or "noServer" options must be specified'
          );
        }
        if (options.port != null) {
          this._server = http.createServer((req, res) => {
            const body = http.STATUS_CODES[426];
            res.writeHead(426, {
              "Content-Length": body.length,
              "Content-Type": "text/plain"
            });
            res.end(body);
          });
          this._server.listen(
            options.port,
            options.host,
            options.backlog,
            callback
          );
        } else if (options.server) {
          this._server = options.server;
        }
        if (this._server) {
          const emitConnection = this.emit.bind(this, "connection");
          this._removeListeners = addListeners(this._server, {
            listening: this.emit.bind(this, "listening"),
            error: this.emit.bind(this, "error"),
            upgrade: (req, socket, head) => {
              this.handleUpgrade(req, socket, head, emitConnection);
            }
          });
        }
        if (options.perMessageDeflate === true) options.perMessageDeflate = {};
        if (options.clientTracking) {
          this.clients = /* @__PURE__ */ new Set();
          this._shouldEmitClose = false;
        }
        this.options = options;
        this._state = RUNNING;
      }
      /**
       * Returns the bound address, the address family name, and port of the server
       * as reported by the operating system if listening on an IP socket.
       * If the server is listening on a pipe or UNIX domain socket, the name is
       * returned as a string.
       *
       * @return {(Object|String|null)} The address of the server
       * @public
       */
      address() {
        if (this.options.noServer) {
          throw new Error('The server is operating in "noServer" mode');
        }
        if (!this._server) return null;
        return this._server.address();
      }
      /**
       * Stop the server from accepting new connections and emit the `'close'` event
       * when all existing connections are closed.
       *
       * @param {Function} [cb] A one-time listener for the `'close'` event
       * @public
       */
      close(cb) {
        if (this._state === CLOSED) {
          if (cb) {
            this.once("close", () => {
              cb(new Error("The server is not running"));
            });
          }
          process.nextTick(emitClose, this);
          return;
        }
        if (cb) this.once("close", cb);
        if (this._state === CLOSING) return;
        this._state = CLOSING;
        if (this.options.noServer || this.options.server) {
          if (this._server) {
            this._removeListeners();
            this._removeListeners = this._server = null;
          }
          if (this.clients) {
            if (!this.clients.size) {
              process.nextTick(emitClose, this);
            } else {
              this._shouldEmitClose = true;
            }
          } else {
            process.nextTick(emitClose, this);
          }
        } else {
          const server2 = this._server;
          this._removeListeners();
          this._removeListeners = this._server = null;
          server2.close(() => {
            emitClose(this);
          });
        }
      }
      /**
       * See if a given request should be handled by this server instance.
       *
       * @param {http.IncomingMessage} req Request object to inspect
       * @return {Boolean} `true` if the request is valid, else `false`
       * @public
       */
      shouldHandle(req) {
        if (this.options.path) {
          const index = req.url.indexOf("?");
          const pathname = index !== -1 ? req.url.slice(0, index) : req.url;
          if (pathname !== this.options.path) return false;
        }
        return true;
      }
      /**
       * Handle a HTTP Upgrade request.
       *
       * @param {http.IncomingMessage} req The request object
       * @param {Duplex} socket The network socket between the server and client
       * @param {Buffer} head The first packet of the upgraded stream
       * @param {Function} cb Callback
       * @public
       */
      handleUpgrade(req, socket, head, cb) {
        socket.on("error", socketOnError);
        const key = req.headers["sec-websocket-key"];
        const upgrade = req.headers.upgrade;
        const version = +req.headers["sec-websocket-version"];
        if (req.method !== "GET") {
          const message = "Invalid HTTP method";
          abortHandshakeOrEmitwsClientError(this, req, socket, 405, message);
          return;
        }
        if (upgrade === void 0 || upgrade.toLowerCase() !== "websocket") {
          const message = "Invalid Upgrade header";
          abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
          return;
        }
        if (key === void 0 || !keyRegex.test(key)) {
          const message = "Missing or invalid Sec-WebSocket-Key header";
          abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
          return;
        }
        if (version !== 13 && version !== 8) {
          const message = "Missing or invalid Sec-WebSocket-Version header";
          abortHandshakeOrEmitwsClientError(this, req, socket, 400, message, {
            "Sec-WebSocket-Version": "13, 8"
          });
          return;
        }
        if (!this.shouldHandle(req)) {
          abortHandshake(socket, 400);
          return;
        }
        const secWebSocketProtocol = req.headers["sec-websocket-protocol"];
        let protocols = /* @__PURE__ */ new Set();
        if (secWebSocketProtocol !== void 0) {
          try {
            protocols = subprotocol2.parse(secWebSocketProtocol);
          } catch (err) {
            const message = "Invalid Sec-WebSocket-Protocol header";
            abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
            return;
          }
        }
        const secWebSocketExtensions = req.headers["sec-websocket-extensions"];
        const extensions = {};
        if (this.options.perMessageDeflate && secWebSocketExtensions !== void 0) {
          const perMessageDeflate = new PerMessageDeflate2({
            ...this.options.perMessageDeflate,
            isServer: true,
            maxPayload: this.options.maxPayload
          });
          try {
            const offers = extension2.parse(secWebSocketExtensions);
            if (offers[PerMessageDeflate2.extensionName]) {
              perMessageDeflate.accept(offers[PerMessageDeflate2.extensionName]);
              extensions[PerMessageDeflate2.extensionName] = perMessageDeflate;
            }
          } catch (err) {
            const message = "Invalid or unacceptable Sec-WebSocket-Extensions header";
            abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
            return;
          }
        }
        if (this.options.verifyClient) {
          const info = {
            origin: req.headers[`${version === 8 ? "sec-websocket-origin" : "origin"}`],
            secure: !!(req.socket.authorized || req.socket.encrypted),
            req
          };
          if (this.options.verifyClient.length === 2) {
            this.options.verifyClient(info, (verified, code, message, headers) => {
              if (!verified) {
                return abortHandshake(socket, code || 401, message, headers);
              }
              this.completeUpgrade(
                extensions,
                key,
                protocols,
                req,
                socket,
                head,
                cb
              );
            });
            return;
          }
          if (!this.options.verifyClient(info)) return abortHandshake(socket, 401);
        }
        this.completeUpgrade(extensions, key, protocols, req, socket, head, cb);
      }
      /**
       * Upgrade the connection to WebSocket.
       *
       * @param {Object} extensions The accepted extensions
       * @param {String} key The value of the `Sec-WebSocket-Key` header
       * @param {Set} protocols The subprotocols
       * @param {http.IncomingMessage} req The request object
       * @param {Duplex} socket The network socket between the server and client
       * @param {Buffer} head The first packet of the upgraded stream
       * @param {Function} cb Callback
       * @throws {Error} If called more than once with the same socket
       * @private
       */
      completeUpgrade(extensions, key, protocols, req, socket, head, cb) {
        if (!socket.readable || !socket.writable) return socket.destroy();
        if (socket[kWebSocket]) {
          throw new Error(
            "server.handleUpgrade() was called more than once with the same socket, possibly due to a misconfiguration"
          );
        }
        if (this._state > RUNNING) return abortHandshake(socket, 503);
        const digest = createHash("sha1").update(key + GUID).digest("base64");
        const headers = [
          "HTTP/1.1 101 Switching Protocols",
          "Upgrade: websocket",
          "Connection: Upgrade",
          `Sec-WebSocket-Accept: ${digest}`
        ];
        const ws = new this.options.WebSocket(null, void 0, this.options);
        if (protocols.size) {
          const protocol = this.options.handleProtocols ? this.options.handleProtocols(protocols, req) : protocols.values().next().value;
          if (protocol) {
            headers.push(`Sec-WebSocket-Protocol: ${protocol}`);
            ws._protocol = protocol;
          }
        }
        if (extensions[PerMessageDeflate2.extensionName]) {
          const params = extensions[PerMessageDeflate2.extensionName].params;
          const value = extension2.format({
            [PerMessageDeflate2.extensionName]: [params]
          });
          headers.push(`Sec-WebSocket-Extensions: ${value}`);
          ws._extensions = extensions;
        }
        this.emit("headers", headers, req);
        socket.write(headers.concat("\r\n").join("\r\n"));
        socket.removeListener("error", socketOnError);
        ws.setSocket(socket, head, {
          allowSynchronousEvents: this.options.allowSynchronousEvents,
          maxBufferedChunks: this.options.maxBufferedChunks,
          maxFragments: this.options.maxFragments,
          maxPayload: this.options.maxPayload,
          skipUTF8Validation: this.options.skipUTF8Validation
        });
        if (this.clients) {
          this.clients.add(ws);
          ws.on("close", () => {
            this.clients.delete(ws);
            if (this._shouldEmitClose && !this.clients.size) {
              process.nextTick(emitClose, this);
            }
          });
        }
        cb(ws, req);
      }
    };
    module.exports = WebSocketServer2;
    function addListeners(server2, map) {
      for (const event of Object.keys(map)) server2.on(event, map[event]);
      return function removeListeners() {
        for (const event of Object.keys(map)) {
          server2.removeListener(event, map[event]);
        }
      };
    }
    function emitClose(server2) {
      server2._state = CLOSED;
      server2.emit("close");
    }
    function socketOnError() {
      this.destroy();
    }
    function abortHandshake(socket, code, message, headers) {
      message = message || http.STATUS_CODES[code];
      headers = {
        Connection: "close",
        "Content-Type": "text/html",
        "Content-Length": Buffer.byteLength(message),
        ...headers
      };
      socket.once("finish", socket.destroy);
      socket.end(
        `HTTP/1.1 ${code} ${http.STATUS_CODES[code]}\r
` + Object.keys(headers).map((h) => `${h}: ${headers[h]}`).join("\r\n") + "\r\n\r\n" + message
      );
    }
    function abortHandshakeOrEmitwsClientError(server2, req, socket, code, message, headers) {
      if (server2.listenerCount("wsClientError")) {
        const err = new Error(message);
        Error.captureStackTrace(err, abortHandshakeOrEmitwsClientError);
        server2.emit("wsClientError", err, socket, req);
      } else {
        abortHandshake(socket, code, message, headers);
      }
    }
  }
});

// ../../src/shared/local-api.mjs
import { mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";
function localHeaders(component) {
  if (!/^[a-z-]+$/.test(component)) throw new Error("Invalid component");
  const root = process.env.ULANZI_AUTH_DIR || join(homedir(), ".local/share/ulanzi-bridges");
  mkdirSync(root, { recursive: true, mode: 448 });
  chmodSync(root, 448);
  const file = join(root, `${component}.token`);
  try {
    writeFileSync(file, randomBytes(32).toString("hex"), { flag: "wx", mode: 384 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  chmodSync(file, 384);
  const token = readFileSync(file, "utf8").trim();
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error("Invalid local bridge credential; remove the component token file to regenerate it");
  return { Authorization: `Bearer ${token}` };
}
function allowedRequest(request, component, port, { oauthCallback = false } = {}) {
  if (![`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`].includes(request.headers.host)) return false;
  if (oauthCallback && request.method === "GET" && new URL(request.url, "http://localhost").pathname === "/callback") return true;
  if (request.headers.origin || request.headers["sec-fetch-site"] && request.headers["sec-fetch-site"] !== "none") return false;
  const actual = Buffer.from(request.headers.authorization || "");
  const expected = Buffer.from(localHeaders(component).Authorization);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
function json(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(payload));
}
function secureHandler(component, port, handler, options = {}) {
  return async (request, response) => {
    try {
      if (!allowedRequest(request, component, port, options)) return json(response, 403, { ok: false, error: "Unauthorized local client" });
      await handler(request, response);
    } catch (error) {
      if (!response.headersSent) json(response, error.status || 500, { ok: false, error: error.message });
      else response.end();
    }
  };
}
async function readJson(request, limit = 65536) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += Buffer.byteLength(chunk);
    if (size > limit) throw Object.assign(new Error("Request body too large"), { status: 413 });
    chunks.push(Buffer.from(chunk));
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw Object.assign(new Error("Expected a JSON object"), { status: 400 });
  }
}

// ../../node_modules/ws/wrapper.mjs
var import_stream = __toESM(require_stream(), 1);
var import_extension = __toESM(require_extension(), 1);
var import_permessage_deflate = __toESM(require_permessage_deflate(), 1);
var import_receiver = __toESM(require_receiver(), 1);
var import_sender = __toESM(require_sender(), 1);
var import_subprotocol = __toESM(require_subprotocol(), 1);
var import_websocket = __toESM(require_websocket(), 1);
var import_websocket_server = __toESM(require_websocket_server(), 1);
var wrapper_default = import_websocket.default;

// ../../src/shared/plugin-runtime.mjs
function stateDigest(state) {
  const { updatedAt, bridgeSnapshot, ...publicState } = state;
  return JSON.stringify(publicState, (key, value) => key === "observedAt" ? void 0 : value);
}

// ../../src/bridge/server.mjs
import { createServer } from "node:http";
import { execFile as execFile2 } from "node:child_process";
import { promisify as promisify2 } from "node:util";

// ../../src/shared/token-metrics.mjs
function contextPercent(usage) {
  if (!usage || typeof usage !== "object") return null;
  const direct = usage.usedPercent ?? usage.used_percent ?? usage.percentage ?? usage.percent;
  if (Number.isFinite(direct)) return Math.min(100, Math.max(0, Math.round(direct)));
  const window = usage.modelContextWindow ?? usage.model_context_window ?? usage.contextWindow ?? usage.context_window;
  let tokens = usage.contextTokens ?? usage.context_tokens ?? usage.last?.totalTokens ?? usage.last?.total_tokens;
  if (tokens == null) {
    const input = usage.last?.inputTokens ?? usage.last?.input_tokens;
    const output = usage.last?.outputTokens ?? usage.last?.output_tokens;
    if (Number.isFinite(input) && Number.isFinite(output)) tokens = input + output;
  }
  if (!Number.isFinite(window) || window <= 0 || !Number.isFinite(tokens) || tokens < 0) return null;
  return Math.min(100, Math.max(0, Math.round(tokens / window * 100)));
}

// ../../src/bridge/model-picker.mjs
function readNativeModelPicker(document) {
  const triggers = [...document.querySelectorAll("button[data-codex-intelligence-trigger]")].filter((button) => button.offsetParent !== null && !button.closest('[inert], [hidden], [aria-hidden="true"], [role="dialog"], [aria-modal="true"]'));
  if (triggers.length !== 1) throw new Error("No unique model selector is available for this task");
  const trigger = triggers[0];
  const key = Object.getOwnPropertyNames(trigger).find((key2) => key2.startsWith("__reactFiber$"));
  let root = key && trigger[key];
  while (root?.return) root = root.return;
  const queue = [root?.stateNode?.current];
  const seen = /* @__PURE__ */ new Set();
  let mounted = null;
  while (queue.length) {
    const node = queue.pop();
    if (!node || seen.has(node)) continue;
    seen.add(node);
    if (node.stateNode === trigger) {
      mounted = node;
      break;
    }
    queue.push(node.child, node.sibling);
  }
  for (let node = mounted; node; node = node.return) {
    const props = node.memoizedProps;
    if (Array.isArray(props?.models) && Array.isArray(props?.modelOptions) && typeof props.onSelectModel === "function" && typeof props.onSelectReasoningEffort === "function") {
      return { trigger, props };
    }
  }
  throw new Error("Native model picker is unavailable in this Codex version");
}
function cycleNativeModelPicker(picker, action) {
  const { trigger, props } = picker;
  if (trigger.disabled || trigger.getAttribute("aria-disabled") === "true" || props.disabled || props.daybreak?.disabled || props.daybreak?.isSaving) {
    throw new Error("Model settings are currently disabled");
  }
  const effortIds = /* @__PURE__ */ new Set(["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]);
  const effortsFor = (model) => [...new Set((model?.supportedReasoningEfforts || []).map((option) => option.reasoningEffort).filter((effort2) => effortIds.has(effort2)))];
  if (action === "model") {
    if (props.modelOptionsDisabled || props.modelLabelOnly) throw new Error("Model selection is locked");
    const models = props.modelOptions.filter((option) => option.disabledReason == null && option.model?.model !== props.lockedModelSlug && typeof option.model?.model === "string");
    const index2 = models.findIndex((option) => option.model.model === props.model);
    if (index2 < 0) throw new Error("The current model is not in the available model list");
    if (models.length < 2) throw new Error("No other model is available");
    const next = models[(index2 + 1) % models.length].model;
    const efforts2 = effortsFor(next);
    const effort2 = efforts2.includes(props.reasoningEffort) ? props.reasoningEffort : next.defaultReasoningEffort;
    if (!efforts2.includes(effort2)) throw new Error("The next model has no supported reasoning effort");
    if (props.onBeforeSelectModel?.(next.model) === false) throw new Error("Codex did not allow this model selection");
    props.onSelectModel(next.model, effort2);
    props.onSelectModelOption?.();
    return { model: next.model, reasoningEffort: effort2 };
  }
  if (action !== "reasoning") throw new Error("Unsupported model picker action");
  if (props.reasoningEffortDisabled || props.showReasoningEffortControls === false) {
    throw new Error("Reasoning effort selection is disabled");
  }
  const current = props.models.find((model) => model.model === props.model);
  const efforts = effortsFor(current);
  const index = efforts.indexOf(props.reasoningEffort);
  if (index < 0) throw new Error("The current reasoning effort is unavailable");
  if (efforts.length < 2) throw new Error("No other reasoning effort is available");
  const effort = efforts[(index + 1) % efforts.length];
  props.onSelectReasoningEffort(effort);
  return { model: props.model, reasoningEffort: effort };
}

// ../../src/bridge/codex-cdp.mjs
import { execFile } from "node:child_process";
import { promisify } from "node:util";

// ../../src/bridge/thread-key.mjs
var UUID_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
var THREAD_KEY_PATTERN = new RegExp(
  `^(?:${UUID_PATTERN}|client-new-thread:${UUID_PATTERN})$`,
  "i"
);
function validateThreadId(value) {
  const normalized = String(value ?? "").replace(/^local:/, "");
  if (!THREAD_KEY_PATTERN.test(normalized)) {
    throw new Error("Invalid Codex thread id");
  }
  return normalized;
}
function decodeThreadPathSegment(segment) {
  let decoded;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    throw new Error("Invalid encoded Codex thread id");
  }
  return validateThreadId(decoded);
}
function localThreadKey(value) {
  return `local:${validateThreadId(value)}`;
}

// ../../src/bridge/task-attention.mjs
function readNativeTaskAttention(source, slots) {
  const threadIds = /* @__PURE__ */ new Map();
  const asyncQuestionThreads = /* @__PURE__ */ new Set();
  const nodes = /* @__PURE__ */ new Set([source?.node, ...source?.contextMap?.values?.() ?? []]);
  const threadKeys = slots.map((slot) => slot?.threadKey).filter((key) => typeof key === "string");
  for (const node of nodes) {
    if (!(node?.familyBindings instanceof Map)) continue;
    const read = (binding) => {
      const signal = binding?.value;
      if (typeof signal?.get === "function") return signal.get();
      if (typeof signal?.resolve === "function" && node.store?.get) {
        return node.store.get(signal.resolve(node, source.contextMap));
      }
      return null;
    };
    for (const members of node.familyBindings.values()) {
      if (!(members instanceof Map)) continue;
      try {
        const groups = read(members.get("local"));
        if (groups instanceof Map) {
          for (const [threadId, group] of groups) {
            const key = group?.selectedQuestionKey;
            if (typeof threadId !== "string" || key?.hostId !== "local" || key.threadId !== threadId || !Array.isArray(group.questionIds) || !group.questionIds.includes(key.itemId)) continue;
            let item;
            try {
              item = JSON.parse(key.itemId);
            } catch {
              continue;
            }
            if (Array.isArray(item) && item[0] === "request_user_input_async") asyncQuestionThreads.add(threadId);
          }
        }
      } catch {
      }
      for (const threadKey of threadKeys) {
        try {
          const task = read(members.get(threadKey));
          if (task?.kind !== "local" || task.key !== threadKey || task.conversation?.hostId !== "local") continue;
          if (typeof task.conversation.id === "string") threadIds.set(threadKey, task.conversation.id);
        } catch {
        }
      }
    }
  }
  return { threadIds, asyncQuestionThreads };
}
function taskAttentionStatus(status, hasAsyncQuestion) {
  const value = String(status ?? "idle").toLowerCase();
  if (!hasAsyncQuestion || ["approval", "awaiting-approval", "error", "failed", "failure", "off"].includes(value)) {
    return status ?? "idle";
  }
  return "awaiting-response";
}

// ../../src/bridge/codex-cdp.mjs
var execFileAsync = promisify(execFile);
var USAGE_REFRESH_MS = Math.max(
  15e3,
  Number(process.env.CODEX_KEYBOARD_USAGE_REFRESH_SECONDS || 600) * 1e3
);
var DEVICE_STATE = {
  type: "codex-micro-device-state-changed",
  state: { status: "connected", error: null, battery: { percentage: 100, isCharging: true } }
};
var MICRO_ACTION_KEYS = Object.freeze({
  fast: "ACT06",
  approve: "ACT07",
  reject: "ACT08",
  fork: "ACT09",
  mic: "ACT10",
  submit: "ACT12"
});
var RENDERER_ACTIONS = /* @__PURE__ */ new Set(["pin", "new", "approve", "reject", "stop", "model", "reasoning", "goal", "subagents", "plan"]);
var PIN_ACTION_LABELS = Object.freeze([
  "Pin chat",
  "Unpin chat",
  "\u7F6E\u9876\u804A\u5929",
  "\u53D6\u6D88\u7F6E\u9876\u804A\u5929",
  "\u91D8\u9078\u804A\u5929",
  "\u53D6\u6D88\u91D8\u9078\u804A\u5929"
]);
var NEW_ACTION_LABELS = Object.freeze([
  "New task",
  "New chat",
  "New conversation",
  "\u65B0\u5BF9\u8BDD",
  "\u65B0\u5C0D\u8A71",
  "\u65B0\u5EFA\u4EFB\u52A1",
  "\u65B0\u5EFA\u804A\u5929",
  "\u65B0\u589E\u4EFB\u52D9",
  "\u65B0\u589E\u804A\u5929"
]);
var STEER_ACTION_LABELS = Object.freeze([
  "Steer",
  "\u8C03\u6574\u65B9\u5411",
  "\u8ABF\u6574\u65B9\u5411",
  "\u5F15\u5C0E"
]);
var APPROVE_ACTION_LABELS = Object.freeze([
  "Approve",
  "Allow",
  "Run",
  "Accept",
  "Confirm",
  "Yes",
  "Proceed",
  "Aprovar",
  "Permitir",
  "Executar",
  "Aceitar",
  "Confirmar",
  "Sim",
  "Prosseguir",
  "\u6279\u51C6",
  "\u5141\u8BB8",
  "\u8FD0\u884C",
  "\u63A5\u53D7",
  "\u786E\u8BA4",
  "\u662F",
  "\u7EE7\u7EED",
  "\u627F\u8A8D",
  "\u8A31\u53EF",
  "\u5B9F\u884C",
  "\u540C\u610F",
  "\u78BA\u8A8D",
  "\u306F\u3044",
  "\u7D9A\u884C",
  "Genehmigen",
  "Zulassen",
  "Ausf\xFChren",
  "Best\xE4tigen"
]);
var REJECT_ACTION_LABELS = Object.freeze([
  "Reject",
  "Deny",
  "Cancel",
  "Decline",
  "No",
  "Dismiss",
  "Stop",
  "Rejeitar",
  "Negar",
  "Cancelar",
  "Recusar",
  "N\xE3o",
  "Dispensar",
  "Parar",
  "\u62D2\u7EDD",
  "\u5426\u8BA4",
  "\u53D6\u6D88",
  "\u5426",
  "\u5173\u95ED",
  "\u505C\u6B62",
  "\u62D2\u5426",
  "\u5374\u4E0B",
  "\u30AD\u30E3\u30F3\u30BB\u30EB",
  "\u8F9E\u9000",
  "\u3044\u3044\u3048",
  "\u9589\u3058\u308B",
  "Ablehnen",
  "Verweigern",
  "Abbrechen"
]);
function threadGuardExpression(threadId) {
  return `const expectedThread = ${JSON.stringify(threadId)};
    if (expectedThread !== undefined) {
      const actualThread = document.querySelector('[data-above-composer-conversation-id]')?.getAttribute('data-above-composer-conversation-id')
        ?? document.querySelector('[data-app-action-sidebar-thread-id][data-app-action-sidebar-thread-active=true]')?.getAttribute('data-app-action-sidebar-thread-id') ?? null;
      const normalizeThread = value => value == null ? null : String(value).replace(/^local:/, '');
      if (normalizeThread(actualThread) !== normalizeThread(expectedThread)) throw new Error('Codex task changed; refresh the deck and try again');
    }`;
}
function findNativePlanControl(document) {
  const labels = /* @__PURE__ */ new Set(["Open plan in side panel", "Abrir plano no painel lateral", "Plan im Seitenbereich \xF6ffnen", "Abrir plan en el panel lateral", "\u30B5\u30A4\u30C9\u30D1\u30CD\u30EB\u3067\u30D7\u30E9\u30F3\u3092\u958B\u304F", "\uC0AC\uC774\uB4DC \uD328\uB110\uC5D0\uC11C \uACC4\uD68D \uC5F4\uAE30", "\u5728\u4FA7\u8FB9\u9762\u677F\u4E2D\u6253\u5F00\u5957\u9910", "\u5728\u5074\u908A\u9762\u677F\u4E2D\u958B\u555F\u8A08\u5283", "\u5728\u5074\u908A\u9762\u677F\u958B\u555F\u65B9\u6848"]);
  const matches = [...document.querySelectorAll("button[aria-label]")].filter((button) => button.offsetParent !== null && !button.disabled && button.getAttribute("aria-disabled") !== "true" && !button.closest?.('[role="dialog"], [aria-modal="true"], [inert], [aria-hidden="true"]') && labels.has(button.getAttribute("aria-label")));
  return matches.length === 1 ? matches[0] : null;
}
function rendererActionExpression(action, threadId) {
  if (action === "model" || action === "reasoning") {
    return `(async () => {
      const guard = () => { ${threadGuardExpression(threadId)} };
      const readPicker = () => (${readNativeModelPicker.toString()})(document);
      guard();
      const expected = (${cycleNativeModelPicker.toString()})(readPicker(), ${JSON.stringify(action)});
      for (let attempt = 0; attempt < 40; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 50));
        guard();
        const { props } = readPicker();
        if (props.model === expected.model && props.reasoningEffort === expected.reasoningEffort) return true;
      }
      throw new Error('Codex did not confirm the model settings change');
    })()`;
  }
  return `(() => {
    ${threadGuardExpression(threadId)}
    const action = ${JSON.stringify(action)};
    const visible = (element) => element && element.offsetParent !== null;
    let target = null;
    if (action === "pin") {
      const active = document.querySelector(
        "[data-app-action-sidebar-thread-active=true]"
      ) ?? document.querySelector(
        "[data-app-action-sidebar-thread-id][aria-current=page]"
      );
      const labels = new Set(${JSON.stringify(PIN_ACTION_LABELS)});
      target = active && [...active.querySelectorAll("button")].find(
        (button) => visible(button) && labels.has(button.getAttribute("aria-label"))
      );
    } else if (action === "new") {
      const sidebarAnchor = document.querySelector(
        "[data-app-action-sidebar-project-create]"
      ) ?? document.querySelector("[data-app-action-sidebar-thread-id]");
      const sidebar = sidebarAnchor?.closest("nav");
      const structuralCandidates = [...(
        sidebar?.querySelectorAll(
          ".sidebar-item.relative > button.sidebar-item"
        ) ?? []
      )].filter(visible);
      if (structuralCandidates.length === 1) {
        target = structuralCandidates[0];
      } else {
        const labels = new Set(${JSON.stringify(NEW_ACTION_LABELS)});
        const buttons = [...document.querySelectorAll("button")].filter(visible);
        target = buttons.find((button) => [
          button.getAttribute("aria-label"),
          button.getAttribute("title"),
          (button.innerText || "").trim()
        ].some((label) => labels.has(label)));
      }
    } else if (action === "approve") {
      const labels = new Set(${JSON.stringify(APPROVE_ACTION_LABELS)});
      const buttons = [...document.querySelectorAll("button, [role=button]")].filter(visible);
      target = buttons.find((button) => [
        button.getAttribute("aria-label"),
        button.getAttribute("title"),
        (button.innerText || "").trim()
      ].some((label) => labels.has(label))) ?? buttons.find((button) =>
        button.matches?.('[data-testid*="approve"],[data-testid*="allow"],[data-testid*="run"]')
      );
    } else if (action === "reject") {
      const stopLabels = ["Stop", "Stop generating", "Cancel", "Parar", "Cancelar", "Interromper", "\u505C\u6B62", "\u505C\u6B62\u751F\u6210", "\u53D6\u6D88", "\u4E2D\u6B62", "Abbrechen", "Stoppen"];
      const rejectLabels = new Set(${JSON.stringify(REJECT_ACTION_LABELS)});
      const buttons = [...document.querySelectorAll("button, [role=button]")].filter(visible);
      target = buttons.find((button) => {
        const aria = button.getAttribute("aria-label") || "";
        const title = button.getAttribute("title") || "";
        const text = (button.innerText || "").trim();
        return stopLabels.some((l) => aria.includes(l) || title.includes(l) || text.includes(l)) ||
               rejectLabels.has(aria) || rejectLabels.has(title) || rejectLabels.has(text);
      }) ?? buttons.find((button) =>
        button.matches?.('[data-testid*="stop"],[data-testid*="cancel"],[data-testid*="reject"],[data-testid*="deny"]')
      );
    } else if (action === "stop") {
      const labels = new Set(["Stop", "Stop generating", "Parar", "Interromper", "\u505C\u6B62", "\u505C\u6B62\u751F\u6210", "\u4E2D\u6B62", "Stoppen"]);
      const matches = [...document.querySelectorAll("button, [role=button]")].filter(button =>
        visible(button) && !button.disabled && button.getAttribute("aria-disabled") !== "true" &&
        !button.closest?.('[role="dialog"], [aria-modal="true"]') &&
        [button.getAttribute("aria-label"), button.getAttribute("title"), (button.innerText || "").trim()].some(label => labels.has(label))
      );
      if (matches.length !== 1) throw new Error("No unique stop control is available for this task");
      target = matches[0];
    } else if (action === "plan") {
      target = (${findNativePlanControl.toString()})(document);
      if (!target) throw new Error("No unique plan control is available for this task");
    } else if (action === "goal" || action === "subagents") {
      const labels = action === "goal" ? ["Pause goal", "Resume goal", "Pausar objetivo", "Retomar objetivo"] : ["Open subagents", "Abrir subagentes"];
      const matches = [...document.querySelectorAll("button")].filter(button => visible(button) && !button.disabled && labels.includes(button.getAttribute("aria-label")));
      if (matches.length !== 1) throw new Error("No unique " + action + " control is available for this task");
      target = matches[0];
    }
    if (!target) return false;
    target.click();
    return true;
  })()`;
}
function composerSteerExpression(threadId) {
  return `(() => {
    ${threadGuardExpression(threadId)}
    const editor = [...document.querySelectorAll('[contenteditable="true"][role="textbox"]')]
      .find((element) => element.offsetParent !== null);
    if (!editor) throw new Error("Codex composer is not available");
    editor.focus();
    const labels = new Set(${JSON.stringify(STEER_ACTION_LABELS)});
    const steer = [...document.querySelectorAll('button')]
      .find((element) =>
        element.offsetParent !== null && [
          element.getAttribute("aria-label"),
          element.getAttribute("title"),
          (element.innerText || "").trim()
        ].some((label) => labels.has(label))
      );
    if (!steer) return false;
    steer.click();
    return true;
  })()`;
}
function composerPromptExpression(text, threadId) {
  return `(() => {
    ${threadGuardExpression(threadId)}
    const editor = [...document.querySelectorAll('[contenteditable="true"][role="textbox"]')]
      .find((element) => element.offsetParent !== null);
    if (!editor) throw new Error("Codex composer is not available");
    if (editor.textContent?.trim()) throw new Error("Composer already contains a draft; send or clear it in Codex first");
    editor.focus();
    if (!document.execCommand("insertText", false, ${JSON.stringify(text)})) throw new Error("Could not insert prompt");
    return true;
  })()`;
}
var ENABLE_EXPRESSION = `(async () => {
  const gateName = "3207467860";
  const statsig = globalThis.__STATSIG__;
  const clients = [...new Set([statsig?.firstInstance, ...Object.values(statsig?.instances ?? {})].filter(Boolean))];
  for (const client of clients) {
    if (client.overrideAdapter?.__codexKeyboardGate !== gateName) {
      const original = client.overrideAdapter ?? {};
      client.overrideAdapter = new Proxy(original, {
        get(target, property) {
          if (property === "__codexKeyboardGate") return gateName;
          if (property === "getGateOverride") return (gate, user, options) => {
            if (gate?.name === gateName) return { ...gate, value: true };
            const fallback = Reflect.get(target, property, target);
            return typeof fallback === "function" ? fallback.call(target, gate, user, options) : gate;
          };
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        }
      });
    }
    client._memoCache = {};
    client.$emt?.({ name: "values_updated" });
  }
  const urls = [...new Set([
    ...[...document.querySelectorAll("link[href],script[src]")].map((el) => el.href || el.src),
    ...performance.getEntriesByType("resource").map((entry) => entry.name)
  ])].filter((url) => url.includes("/assets/") && url.endsWith(".js"));
  for (const url of urls.filter((url) => /vscode-api|codex-micro|app-initial/.test(url)).slice(0, 120)) {
    try {
      const namespace = await import(url);
      const bus = Object.values(namespace).find((candidate) =>
        candidate && typeof candidate === "object" &&
        candidate.handlers instanceof Map &&
        (typeof candidate.dispatchHostMessage === "function" || typeof candidate.dispatchMessage === "function")
      );
      if (!bus) continue;
      globalThis[Symbol.for("codex-keyboard-micro-bus")] = bus;
      const dispatch = bus.dispatchHostMessage ?? bus.dispatchMessage;
      dispatch.call(bus, ${JSON.stringify(DEVICE_STATE)});
      return { ready: true, clients: clients.length };
    } catch {}
  }
  return { ready: clients.length > 0, clients: clients.length };
})()`;
var SNAPSHOT_EXPRESSION = `(async () => {
  const startedAt = performance.now();
  const root = document.getElementById("root");
  const reactKey = root && Object.getOwnPropertyNames(root).find((key) => key.startsWith("__reactContainer$"));
  if (!root || !reactKey) throw new Error("Codex React root was not found");
  const sourceKey = Symbol.for("codex-keyboard-micro-snapshot-source");
  const validSlots = (slots) =>
    Array.isArray(slots) && slots.length === 6 &&
    slots.every((slot, index) => slot?.id === index);
  const readSource = (source) => {
    if (!source || source.root !== root || !source.node?.store) {
      throw new Error("Cached Codex Micro source is stale");
    }
    const slots = source.node.store.get(
      source.resolver.resolve(source.node, source.contextMap)
    );
    if (!validSlots(slots)) throw new Error("Cached Codex Micro slots are stale");
    return slots;
  };

  let source = globalThis[sourceKey];
  let found = null;
  let queryClients = new Set();
  let cacheHit = false;
  if (source) {
    try {
      found = readSource(source);
      queryClients = new Set(source.queryClients ?? []);
      cacheHit = true;
    } catch {
      delete globalThis[sourceKey];
      source = null;
    }
  }

  if (!found) {
    const urls = [...new Set([
      ...[...document.querySelectorAll("link[href],script[src]")].map((el) => el.href || el.src),
      ...performance.getEntriesByType("resource").map((entry) => entry.name)
    ])].filter((url) => url.includes("/assets/") && url.endsWith(".js"));
    const slotSignalsUrl = urls.find((url) => url.includes("/assets/codex-micro-slot-signals-"));
    if (!slotSignalsUrl) throw new Error("Codex Micro slot signals are not loaded");

    const namespaces = [];
    for (const url of urls) {
      try { namespaces.push(await import(url)); } catch {}
    }
    const exportedValues = namespaces.flatMap((namespace) => Object.values(namespace));
    const bus = exportedValues.find((candidate) =>
      candidate && typeof candidate === "object" && candidate.handlers instanceof Map &&
      (typeof candidate.dispatchHostMessage === "function" || typeof candidate.dispatchMessage === "function")
    );
    if (bus) {
      globalThis[Symbol.for("codex-keyboard-micro-bus")] = bus;
      if ((bus.handlers.get("codex-micro-hid-event")?.size ?? 0) === 0) {
        (bus.dispatchHostMessage ?? bus.dispatchMessage).call(bus, ${JSON.stringify(DEVICE_STATE)});
      }
    }

    const signals = await import(slotSignalsUrl);
    const resolvers = Object.values(signals).filter((candidate) =>
      candidate && typeof candidate === "object" &&
      typeof candidate.resolve === "function" && typeof candidate.createSubscriberAtom === "function"
    );
    const queue = [root[reactKey]];
    const seen = new Set();
    queryClients = new Set();
    while (queue.length && seen.size < 30000 && !found) {
      const fiber = queue.pop();
      if (!fiber || seen.has(fiber)) continue;
      seen.add(fiber);
      const values = [fiber.memoizedProps?.value];
      let dependency = fiber.dependencies?.firstContext;
      while (dependency) { values.push(dependency.memoizedValue); dependency = dependency.next; }
      for (const value of values) {
        if (
          value && typeof value.getQueryCache === "function" &&
          typeof value.getQueryData === "function"
        ) queryClients.add(value);
        if (!(value instanceof Map)) continue;
        for (const node of value.values()) {
          if (!node?.store || typeof node.store.get !== "function") continue;
          for (const resolver of resolvers) {
            try {
              const slots = node.store.get(resolver.resolve(node, value));
              if (validSlots(slots)) {
                found = slots;
                source = {
                  root,
                  node,
                  resolver,
                  contextMap: value,
                  queryClients: [...queryClients]
                };
                globalThis[sourceKey] = source;
                break;
              }
            } catch {}
          }
          if (found) break;
        }
        if (found) break;
      }
      queue.push(fiber.child, fiber.sibling);
    }
    if (!found) throw new Error("Codex Micro slot store was not found");
  }
  let usage = null;
  for (const queryClient of queryClients) {
    try {
      const query = queryClient.getQueryCache().getAll().find((candidate) =>
        JSON.stringify(candidate.queryKey) === '["rate-limit-status"]'
      );
      const now = Date.now();
      const updatedAt = Number(query?.state?.dataUpdatedAt) || 0;
      const refreshKey = Symbol.for("codex-keyboard-rate-limit-refresh-at");
      const lastAttempt = Number(globalThis[refreshKey]) || 0;
      if (
        query && typeof query.fetch === "function" &&
        now - updatedAt >= ${USAGE_REFRESH_MS} && now - lastAttempt >= ${USAGE_REFRESH_MS}
      ) {
        globalThis[refreshKey] = now;
        try { Promise.resolve(query.fetch()).catch(() => {}); } catch {}
      }
      const data = query?.state?.data;
      const rateLimit = data?.rate_limit;
      if (!rateLimit || typeof rateLimit !== "object") continue;
      const parseResetTimestamp = (win, nowTime) => {
        if (!win || typeof win !== "object") return null;
        const raw = win.reset_at ?? win.resets_at ?? win.reset_time ?? win.resetAt ?? win.resetsAt;
        if (raw != null) {
          if (typeof raw === "number" && Number.isFinite(raw)) {
            return raw > 1e11 ? raw : raw * 1000;
          }
          if (typeof raw === "string") {
            const parsed = Date.parse(raw);
            if (Number.isFinite(parsed)) return parsed;
            const num = Number(raw);
            if (Number.isFinite(num)) return num > 1e11 ? num : num * 1000;
          }
        }
        const relSec = Number(win.reset_after_seconds ?? win.reset_in_seconds ?? win.resets_in ?? win.reset_in ?? win.reset_after);
        if (Number.isFinite(relSec) && relSec > 0) {
          return nowTime + relSec * 1000;
        }
        return null;
      };
      const normalizeWindow = (window, role) => {
        if (!window || typeof window !== "object") return null;
        const usedPercent = Number(window.used_percent);
        if (!Number.isFinite(usedPercent)) return null;
        const seconds = Number(window.limit_window_seconds);
        const minutes = Number.isFinite(seconds) && seconds > 0 ? seconds / 60 : null;
        const kind = minutes != null && Math.abs(minutes - 300) <= 1 ? "five-hour"
          : minutes != null && Math.abs(minutes - 10080) <= 1 ? "weekly"
            : "other";
        const used = Math.min(100, Math.max(0, usedPercent));
        const parsedReset = parseResetTimestamp(window, now);
        const defaultWindowMs = kind === "weekly" ? 7 * 86400 * 1000 : 5 * 3600 * 1000;
        const fallbackReset = (updatedAt || now) + defaultWindowMs;
        return {
          id: kind === "other" ? role : kind,
          kind,
          usedPercent: used,
          remainingPercent: 100 - used,
          resetsAt: parsedReset || fallbackReset
        };
      };
      usage = {
        windows: [
          normalizeWindow(rateLimit.primary_window, "primary"),
          normalizeWindow(rateLimit.secondary_window, "secondary")
        ].filter(Boolean),
        observedAt: updatedAt || now
      };
      break;
    } catch {}
  }
  const conversationsMeta = new Map();
  for (const queryClient of queryClients) {
    try {
      const queries = queryClient.getQueryCache().getAll();
      for (const query of queries) {
        if (JSON.stringify(query.queryKey).includes("recent-conversations-meta")) {
          const items = query.state?.data?.items || query.state?.data || [];
          const list = Array.isArray(items) ? items : (items.conversations || []);
          for (const item of list) {
            if (item && item.id && !conversationsMeta.has(item.id)) {
              conversationsMeta.set(item.id, item);
            }
          }
        }
      }
    } catch {}
  }

  const isWorkTask = (item) => {
    if (!item) return false;
    const originator = String(item.originator || "").toLowerCase();
    const serviceName = String(item.serviceName || "").toLowerCase();
    return originator.includes("work") || serviceName.includes("work");
  };

  const formatModel = (raw) => {
    if (!raw) return "DEFAULT";
    const str = String(raw).trim();
    if (/luna/i.test(str)) return /5.6/i.test(str) ? "5.6 LUNA" : "LUNA";
    if (/terra/i.test(str)) return /5.6/i.test(str) ? "5.6 TERRA" : "TERRA";
    if (/daybreak/i.test(str)) return "DAYBREAK";
    if (/gpt-5.5/i.test(str)) return "GPT-5.5";
    if (/gpt-5/i.test(str)) return "GPT-5";
    if (/gpt-4o/i.test(str)) return "GPT-4o";
    if (/o1/i.test(str)) return "o1";
    if (/o3/i.test(str)) return "o3";
    if (/claude/i.test(str)) return "CLAUDE";
    return str.replace(/^gpt-/i, "").replace(/-latest$/i, "").toUpperCase();
  };

  const active = document.querySelector("[data-app-action-sidebar-thread-id][data-app-action-sidebar-thread-active=true]")
    ?? document.querySelector("[data-app-action-sidebar-thread-id][aria-current=page]");
  const activeThreadKey = document.querySelector("[data-above-composer-conversation-id]")
    ?.getAttribute("data-above-composer-conversation-id")
    ?? active?.getAttribute("data-app-action-sidebar-thread-id")
    ?? null;
  const normalizeThreadKey = (value) => String(value ?? "").replace(/^local:/, "");

  const computeCtxPct = ${contextPercent.toString()};
  const { threadIds, asyncQuestionThreads } = (${readNativeTaskAttention.toString()})(source, found);
  const attentionStatus = ${taskAttentionStatus.toString()};

  const enrichedSlots = found.map((slot) => {
    const threadId = threadIds.get(slot.threadKey) ?? normalizeThreadKey(slot.threadKey);
    const meta = threadId ? conversationsMeta.get(threadId) : null;
    const rawModel = meta?.latestModel || meta?.latestThreadSettings?.model || meta?.previousTurnModel || null;
    const isSlotRunning = ["working", "thinking", "running", "in_progress"].includes(String(slot.status || "").toLowerCase());
    const isMetaRunning = ["working", "thinking", "running", "in_progress"].includes(String(meta?.threadRuntimeStatus?.type || "").toLowerCase());
    const running = isSlotRunning || isMetaRunning;
    const taskType = isWorkTask(meta) ? "WORK" : "CODEX";
    const model = formatModel(rawModel);
    const tokenUsage = meta?.latestTokenUsageInfo || meta?.tokenUsageInfo || meta?.tokenUsage || null;
    const ctxPct = computeCtxPct(tokenUsage);
    return {
      id: slot.id,
      threadKey: slot.threadKey ?? null,
      threadId: threadId || null,
      title: slot.title ?? slot.thread?.title ?? slot.task?.title ?? meta?.title ?? null,
      status: attentionStatus(slot.status ?? meta?.threadRuntimeStatus?.type, asyncQuestionThreads.has(threadId)),
      running,
      taskType,
      model,
      rawModel,
      tokenUsage,
      ctxPct,
      selected: Boolean(slot.selected) || Boolean(
        activeThreadKey && threadId === normalizeThreadKey(activeThreadKey)
      )
    };
  });

  const activeTasks = [];
  const seenRunningKeys = new Set();
  for (const slot of enrichedSlots) {
    if (slot.running && slot.threadKey) {
      activeTasks.push({
        threadKey: slot.threadKey,
        threadId: slot.threadId,
        slot: slot.id,
        title: slot.title,
        status: slot.status,
        taskType: slot.taskType,
        model: slot.model,
        rawModel: slot.rawModel,
        tokenUsage: slot.tokenUsage,
        ctxPct: slot.ctxPct
      });
      seenRunningKeys.add(slot.threadId);
    }
  }

  for (const [id, meta] of conversationsMeta.entries()) {
    if (!seenRunningKeys.has(id)) {
      const isMetaRunning = ["working", "thinking", "running", "in_progress"].includes(String(meta?.threadRuntimeStatus?.type || "").toLowerCase());
      if (isMetaRunning) {
        const rawModel = meta?.latestModel || meta?.latestThreadSettings?.model || meta?.previousTurnModel || null;
        const tokenUsage = meta?.latestTokenUsageInfo || meta?.tokenUsageInfo || meta?.tokenUsage || null;
        activeTasks.push({
          threadKey: "local:" + id,
          threadId: id,
          slot: null,
          title: meta.title || "Untitled",
          status: attentionStatus(meta.threadRuntimeStatus?.type || "working", asyncQuestionThreads.has(id)),
          taskType: isWorkTask(meta) ? "WORK" : "CODEX",
          model: formatModel(rawModel),
          rawModel,
          tokenUsage,
          ctxPct: computeCtxPct(tokenUsage)
        });
        seenRunningKeys.add(id);
      }
    }
  }

  let lastTask = null;
  if (activeTasks.length > 0) {
    lastTask = activeTasks[0];
  } else if (activeThreadKey && conversationsMeta.has(normalizeThreadKey(activeThreadKey))) {
    const meta = conversationsMeta.get(normalizeThreadKey(activeThreadKey));
    const rawModel = meta?.latestModel || meta?.latestThreadSettings?.model || meta?.previousTurnModel || null;
    const tokenUsage = meta?.latestTokenUsageInfo || meta?.tokenUsageInfo || meta?.tokenUsage || null;
    lastTask = {
      threadKey: "local:" + meta.id,
      threadId: meta.id,
      slot: null,
      title: meta.title,
      status: attentionStatus(meta.threadRuntimeStatus?.type, asyncQuestionThreads.has(meta.id)),
      taskType: isWorkTask(meta) ? "WORK" : "CODEX",
      model: formatModel(rawModel),
      rawModel,
      tokenUsage,
      ctxPct: computeCtxPct(tokenUsage)
    };
  } else if (enrichedSlots[0]?.threadKey) {
    lastTask = enrichedSlots[0];
  }

  const activeMeta = (activeThreadKey && conversationsMeta.get(normalizeThreadKey(activeThreadKey))) || null;
  const tokenUsage = activeMeta?.latestTokenUsageInfo || activeMeta?.tokenUsageInfo || activeMeta?.tokenUsage || null;
  let modelPicker = null;
  try { modelPicker = (${readNativeModelPicker.toString()})(document).props; } catch {}
  
  const detectLiveReasoningEffort = () => {
    if (modelPicker?.reasoningEffort) return modelPicker.reasoningEffort;
    const srEffort = document.querySelector("[class*='ModelPickerTriggerEffortLabel'] .sr-only")?.textContent?.trim()?.toLowerCase();
    if (srEffort) return srEffort;
    const activeEffortEl = document.querySelector("[data-reasoning-effort][style*='opacity: 1']")
      ?? document.querySelector("[data-reasoning-effort]:not([style*='opacity: 0'])");
    if (activeEffortEl) {
      return activeEffortEl.getAttribute("data-reasoning-effort") || activeEffortEl.textContent?.trim()?.toLowerCase();
    }
    return activeMeta?.latestReasoningEffort || activeMeta?.reasoningEffort || null;
  };
  const reasoningEffort = detectLiveReasoningEffort();

  return {
    activeThreadKey,
    planAvailable: Boolean((${findNativePlanControl.toString()})(document)),
    model: modelPicker?.model || activeMeta?.latestModel || activeMeta?.latestThreadSettings?.model || activeMeta?.previousTurnModel || null,
    goalState: [...document.querySelectorAll('button')].some(b => b.offsetParent !== null && ['Pause goal', 'Pausar objetivo'].includes(b.getAttribute('aria-label'))) ? 'active'
      : [...document.querySelectorAll('button')].some(b => b.offsetParent !== null && ['Resume goal', 'Retomar objetivo'].includes(b.getAttribute('aria-label'))) ? 'paused' : null,
    subagentsSummary: [...document.querySelectorAll('button')].find(b => b.offsetParent !== null && ['Open subagents', 'Abrir subagentes'].includes(b.getAttribute('aria-label')))?.innerText?.trim() || null,
    slots: enrichedSlots,
    activeTasks,
    lastTask,
    tokenUsage,
    reasoningEffort,
    usage,
    bridgeSnapshot: {
      source: cacheHit ? "cache" : "discovery",
      durationMs: performance.now() - startedAt
    }
  };
})()`;
function selectMainTarget(targets) {
  const pages = targets.filter(
    (target) => target.type === "page" && target.webSocketDebuggerUrl && target.url?.startsWith("app://")
  );
  return pages.find((target) => {
    try {
      return new URL(target.url).pathname === "/index.html" && !new URL(target.url).search;
    } catch {
      return false;
    }
  }) ?? pages.find((target) => !/avatar-overlay|composition-surface/i.test(target.url || ""));
}
async function fetchJson(url, timeout = 1200) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeout) });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.json();
}
async function discoverDebugPort() {
  const { stdout } = await execFileAsync("/bin/ps", ["-axo", "command="], { timeout: 4e3 });
  for (const line of stdout.split("\n")) {
    if (!line.includes("--remote-debugging-address=127.0.0.1")) continue;
    const port = Number(line.match(/--remote-debugging-port(?:=|\s+)(\d+)/)?.[1]);
    if (!Number.isInteger(port)) continue;
    try {
      await fetchJson(`http://127.0.0.1:${port}/json/version`, 500);
      return port;
    } catch {
    }
  }
  throw new Error("Codex is not running with the local debug bridge");
}
var CodexCdpClient = class {
  socket = null;
  nextId = 0;
  pending = /* @__PURE__ */ new Map();
  lastSnapshot = null;
  modelActionQueue = Promise.resolve();
  async connect() {
    if (this.socket?.readyState === wrapper_default.OPEN) return;
    const port = await discoverDebugPort();
    const target = selectMainTarget(await fetchJson(`http://127.0.0.1:${port}/json/list`));
    if (!target?.webSocketDebuggerUrl) throw new Error("Codex main renderer was not found");
    const socket = new wrapper_default(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      const timer2 = setTimeout(() => reject(new Error("Timed out connecting to Codex")), 3e3);
      socket.once("open", () => {
        clearTimeout(timer2);
        resolve();
      });
      socket.once("error", reject);
    });
    socket.on("message", (raw) => this.handleMessage(String(raw)));
    socket.on("close", () => this.disconnect());
    socket.on("error", () => this.disconnect());
    this.socket = socket;
    await this.evaluate(ENABLE_EXPRESSION);
  }
  async snapshot() {
    await this.connect();
    try {
      this.lastSnapshot = await this.evaluate(SNAPSHOT_EXPRESSION);
      return this.lastSnapshot;
    } catch (error) {
      this.disconnect();
      throw error;
    }
  }
  async clickAgent(slot) {
    await this.connect();
    const snapshot = this.lastSnapshot ?? await this.snapshot();
    const agent = snapshot.slots[slot];
    if (!agent?.threadKey) throw new Error(`Agent slot ${slot + 1} is empty`);
    return this.clickThreadKey(agent.threadKey, slot);
  }
  async clickThread(threadId, slot = 0) {
    await this.connect();
    return this.clickThreadKey(localThreadKey(threadId), slot);
  }
  async clickThreadKey(threadKey, slot) {
    try {
      await this.dispatchAgent(slot, threadKey, 1);
      void (async () => {
        await new Promise((resolve) => setTimeout(resolve, 35));
        await this.dispatchAgent(slot, threadKey, 0);
        await this.activateThread(threadKey);
      })().catch(() => {
      });
    } catch {
      await this.activateThread(threadKey);
    }
  }
  async dispatchAgent(slot, threadKey, act) {
    return this.dispatchMicroMessage({
      type: "codex-micro-hid-event",
      event: { key: `AG0${slot}`, act, slot, threadKey }
    }, "codex-micro-hid-event");
  }
  async dispatchAction(key, act, threadId) {
    return this.dispatchMicroMessage({
      type: "codex-micro-hid-event",
      event: { key, act, slot: null, threadKey: null }
    }, "codex-micro-hid-event", act === 1 ? threadId : void 0);
  }
  async dispatchNamedAction(action, pressed, threadId) {
    const key = MICRO_ACTION_KEYS[action];
    if (key) {
      return this.dispatchAction(key, pressed ? 1 : 0, threadId);
    }
    if (!RENDERER_ACTIONS.has(action)) {
      throw new Error(`Unsupported Codex bridge action: ${action}`);
    }
    if (!pressed) return true;
    if (action === "model" || action === "reasoning") {
      const pending = this.modelActionQueue.catch(() => {
      }).then(() => this.dispatchRendererAction(action, threadId));
      this.modelActionQueue = pending;
      return pending;
    }
    return this.dispatchRendererAction(action, threadId);
  }
  async dispatchRendererAction(action, threadId) {
    await this.connect();
    const invoked = await this.evaluate(rendererActionExpression(action, threadId));
    if (!invoked) throw new Error(`Codex ${action} action is not available`);
    return true;
  }
  async dispatchComposerSteer(threadId) {
    await this.connect();
    const clicked = await this.evaluate(composerSteerExpression(threadId));
    if (!clicked) throw new Error("Codex Steer action is not available");
  }
  async submitPrompt(text, threadId) {
    await this.connect();
    await this.evaluate(composerPromptExpression(text, threadId));
    await new Promise((resolve) => setTimeout(resolve, 60));
    await this.dispatchAction(MICRO_ACTION_KEYS.submit, 1, threadId);
    await new Promise((resolve) => setTimeout(resolve, 35));
    await this.dispatchAction(MICRO_ACTION_KEYS.submit, 0);
    return true;
  }
  async dispatchJoystick(direction, distance, threadId) {
    const angle = { up: 0.75, right: 0, down: 0.25, left: 0.5 }[direction];
    if (angle === void 0) throw new Error(`Unknown joystick direction: ${direction}`);
    return this.dispatchMicroMessage({
      type: "codex-micro-joystick-event",
      event: { angle, distance }
    }, "codex-micro-joystick-event", distance ? threadId : void 0);
  }
  async dispatchMicroMessage(message, requiredHandler, threadId) {
    return this.evaluate(`(async () => {
      const cacheKey = Symbol.for("codex-keyboard-micro-bus");
      const isMicroBus = (candidate) =>
        candidate && candidate.handlers instanceof Map &&
        (
          candidate.handlers.has(${JSON.stringify(requiredHandler)}) ||
          [...candidate.handlers.keys()].some((key) => String(key).startsWith("codex-micro-"))
        ) &&
        (
          typeof candidate.dispatchHostMessage === "function" ||
          typeof candidate.dispatchMessage === "function"
        );
      let bus = globalThis[cacheKey];
      if (!isMicroBus(bus)) {
        const urls = [...new Set([
          ...[...document.querySelectorAll("link[href],script[src]")].map((element) => element.href || element.src),
          ...performance.getEntriesByType("resource").map((entry) => entry.name)
        ])]
          .filter((url) => url.includes("/assets/") && url.endsWith(".js"));
        bus = null;
        for (const url of urls) {
          try {
            const namespace = await import(url);
            bus = Object.values(namespace).find(isMicroBus);
            if (bus) {
              globalThis[cacheKey] = bus;
              break;
            }
          } catch {}
        }
      }
      if (!bus) throw new Error("Codex Micro event bus was not found");
      const dispatch = bus.dispatchHostMessage ?? bus.dispatchMessage;
      if ((bus.handlers.get(${JSON.stringify(requiredHandler)})?.size ?? 0) === 0) {
        dispatch.call(bus, ${JSON.stringify(DEVICE_STATE)});
        for (let attempt = 0; attempt < 3 && !(bus.handlers.get(${JSON.stringify(requiredHandler)})?.size > 0); attempt++) {
          await new Promise(resolve => setTimeout(resolve, 35));
        }
      }
      if (!(bus.handlers.get(${JSON.stringify(requiredHandler)})?.size > 0)) throw new Error("Codex has no handler for this control");
      ${threadGuardExpression(threadId)}
      dispatch.call(bus, ${JSON.stringify(message)});
      return true;
    })()`);
  }
  async activateThread(threadKey) {
    return this.evaluate(`(async () => {
      const key = ${JSON.stringify(threadKey)};
      const normalize = (value) => String(value ?? "").replace(/^local:/, "");
      const current = () => document.querySelector("[data-above-composer-conversation-id]")
        ?.getAttribute("data-above-composer-conversation-id")
        ?? document.querySelector("[data-app-action-sidebar-thread-id][data-app-action-sidebar-thread-active=true]")
          ?.getAttribute("data-app-action-sidebar-thread-id");
      if (normalize(current()) === normalize(key)) return true;
      const item = [...document.querySelectorAll("[data-app-action-sidebar-thread-id]")]
        .find((el) => normalize(el.getAttribute("data-app-action-sidebar-thread-id")) === normalize(key));
      if (!item) throw new Error("Task is not loaded in the Codex sidebar");
      const pinLabels = new Set(${JSON.stringify(PIN_ACTION_LABELS)});
      const isPinControl = (element) =>
        element.matches(
          "[data-app-action-sidebar-thread-pin],[data-app-action-sidebar-thread-unpin]"
        ) || [
          element.getAttribute("aria-label"),
          element.getAttribute("title")
        ].some((label) => pinLabels.has(label));
      const isTaskNavigation =
        item.matches("[data-app-action-sidebar-thread-id][role=button]") ||
        item.matches("a[data-app-action-sidebar-thread-id][href]");
      if (!isTaskNavigation || isPinControl(item)) {
        throw new Error("Task navigation control is not available");
      }
      item.click();
      return true;
    })()`);
  }
  evaluate(expression) {
    if (!this.socket || this.socket.readyState !== wrapper_default.OPEN) {
      return Promise.reject(new Error("Codex bridge is disconnected"));
    }
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer2 = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Codex runtime response timed out"));
      }, 7e3);
      this.pending.set(id, { resolve, reject, timer: timer2 });
      this.socket.send(JSON.stringify({
        id,
        method: "Runtime.evaluate",
        params: { expression, awaitPromise: true, returnByValue: true }
      }));
    });
  }
  handleMessage(raw) {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) return pending.reject(new Error(message.error.message));
    if (message.result?.exceptionDetails) {
      return pending.reject(new Error(
        message.result.exceptionDetails.exception?.description ?? message.result.exceptionDetails.text ?? "Codex evaluation failed"
      ));
    }
    pending.resolve(message.result?.result?.value);
  }
  disconnect() {
    const socket = this.socket;
    this.socket = null;
    if (socket?.readyState === wrapper_default.OPEN) socket.close();
    for (const { reject, timer: timer2 } of this.pending.values()) {
      clearTimeout(timer2);
      reject(new Error("Codex bridge disconnected"));
    }
    this.pending.clear();
  }
};

// ../../src/bridge/server.mjs
var execFileAsync2 = promisify2(execFile2);
var HOST = "127.0.0.1";
var PORT = Number(process.env.CODEX_KEYBOARD_PORT || 17373);
var configuredRefreshMs = Number(process.env.CODEX_KEYBOARD_REFRESH_MS || 500);
var REFRESH_MS = Number.isFinite(configuredRefreshMs) ? Math.max(250, configuredRefreshMs) : 500;
var client = new CodexCdpClient();
var cached = {
  connected: false,
  slots: Array.from({ length: 6 }, (_, id) => ({
    id,
    threadKey: null,
    title: null,
    status: "off",
    selected: false
  })),
  activeTasks: [],
  lastTask: null,
  error: "Waiting for Codex",
  updatedAt: Date.now()
};
var rememberedLastTask = null;
var refreshPromise = null;
var nextReconnectAt = 0;
var lastBroadcastDigest = "";
var wss = new import_websocket_server.default({ noServer: true });
var wsClients = /* @__PURE__ */ new Set();
function broadcastState() {
  const digest = stateDigest(cached);
  if (digest === lastBroadcastDigest && wsClients.size > 0) return;
  lastBroadcastDigest = digest;
  const payload = JSON.stringify(cached);
  for (const ws of wsClients) {
    if (ws.readyState === 1) {
      try {
        ws.send(payload);
      } catch {
      }
    }
  }
}
wss.on("connection", (ws) => {
  wsClients.add(ws);
  try {
    ws.send(JSON.stringify(cached));
  } catch {
  }
  ws.on("close", () => wsClients.delete(ws));
  ws.on("error", () => wsClients.delete(ws));
});
async function focusCodex() {
  await execFileAsync2("/usr/bin/open", ["-b", "com.openai.codex"], {
    timeout: 3e3
  });
}
async function refresh(force = false) {
  if (refreshPromise) return refreshPromise;
  if (!force && Date.now() < nextReconnectAt) return;
  refreshPromise = (async () => {
    try {
      const snapshot = await client.snapshot();
      if (Array.isArray(snapshot.activeTasks) && snapshot.activeTasks.length > 0) {
        rememberedLastTask = snapshot.activeTasks[0];
      } else if (snapshot.lastTask) {
        rememberedLastTask = snapshot.lastTask;
      }
      cached = {
        connected: true,
        ...snapshot,
        lastTask: rememberedLastTask || snapshot.lastTask || null,
        error: null,
        updatedAt: Date.now()
      };
      nextReconnectAt = 0;
      broadcastState();
    } catch (error) {
      if (cached.connected !== false || cached.error !== error.message) {
        cached = { ...cached, connected: false, error: error.message, updatedAt: Date.now() };
        broadcastState();
      }
      nextReconnectAt = Date.now() + 2e3;
    }
  })();
  try {
    await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}
function json2(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(`${JSON.stringify(body)}
`);
}
var server = createServer(secureHandler("codex", PORT, async (request, response) => {
  const url = new URL(request.url || "/", `http://${HOST}:${PORT}`);
  const body = request.method === "POST" ? await readJson(request) : {};
  if (request.method === "GET" && url.pathname === "/health") {
    await refresh(true);
    return json2(response, 200, { ok: true, codexConnected: cached.connected, updatedAt: cached.updatedAt });
  }
  if (request.method === "GET" && url.pathname === "/state") {
    return json2(response, 200, cached);
  }
  if (request.method === "POST" && url.pathname === "/focus") {
    try {
      await focusCodex();
      return json2(response, 200, { ok: true });
    } catch (error) {
      return json2(response, 503, { ok: false, error: error.message });
    }
  }
  const match = request.method === "POST" && url.pathname.match(/^\/agent\/([0-5])\/click$/);
  if (match) {
    try {
      await Promise.all([
        client.clickAgent(Number(match[1])),
        focusCodex()
      ]);
      return json2(response, 200, { ok: true });
    } catch (error) {
      return json2(response, 503, { ok: false, error: error.message });
    }
  }
  const threadMatch = request.method === "POST" && url.pathname.match(
    /^\/thread\/([^/]+)\/click$/
  );
  if (threadMatch) {
    try {
      const threadId = decodeThreadPathSegment(threadMatch[1]);
      const slot = Number(url.searchParams.get("slot") || 0);
      if (!Number.isInteger(slot) || slot < 0 || slot > 5) {
        throw new Error("Invalid Codex Micro slot");
      }
      await Promise.all([
        client.clickThread(threadId, slot),
        focusCodex()
      ]);
      return json2(response, 200, { ok: true, bridge: true });
    } catch (error) {
      return json2(response, 503, {
        ok: false,
        bridge: false,
        error: error.message
      });
    }
  }
  const action = request.method === "POST" && url.pathname.match(
    /^\/action\/(fast|approve|reject|pin|new|fork|mic|steer|submit|stop|model|reasoning|goal|subagents|plan)\/(down|up)$/
  );
  if (action) {
    try {
      if (action[1] === "steer") {
        if (action[2] === "down") {
          await focusCodex();
          await client.dispatchComposerSteer(body.threadId ?? null);
        }
        return json2(response, 200, { ok: true });
      }
      await client.dispatchNamedAction(action[1], action[2] === "down", body.threadId ?? null);
      return json2(response, 200, { ok: true, bridge: true });
    } catch (error) {
      return json2(response, 503, { ok: false, error: error.message });
    }
  }
  if (request.method === "POST" && url.pathname === "/prompt") {
    try {
      const { text } = body;
      if (typeof text !== "string" || !text.trim() || text.length > 16e3) throw new Error("Prompt must contain 1\u201316000 characters");
      await focusCodex();
      await client.submitPrompt(text, body.threadId ?? null);
      return json2(response, 200, { ok: true });
    } catch (error) {
      return json2(response, 500, { ok: false, error: error.message });
    }
  }
  const joystick = request.method === "POST" && url.pathname.match(
    /^\/joystick\/(up|right|down|left)\/(down|up)$/
  );
  if (joystick) {
    try {
      await client.dispatchJoystick(joystick[1], joystick[2] === "down" ? 1 : 0, body.threadId ?? null);
      return json2(response, 200, { ok: true });
    } catch (error) {
      return json2(response, 503, { ok: false, error: error.message });
    }
  }
  return json2(response, 404, { ok: false, error: "Not found" });
}));
server.on("upgrade", (request, socket, head) => {
  if (!allowedRequest(request, "codex", PORT)) {
    socket.destroy();
    return;
  }
  const { pathname } = new URL(request.url || "/", `http://${HOST}:${PORT}`);
  if (pathname === "/events" || pathname === "/ws") {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  } else {
    socket.destroy();
  }
});
server.listen(PORT, HOST, () => {
  console.log(`Codex Keyboard bridge listening on http://${HOST}:${PORT}`);
  void refresh();
});
var timer = setInterval(() => void refresh(), REFRESH_MS);
timer.unref();
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    clearInterval(timer);
    client.disconnect();
    server.close(() => process.exit(0));
  });
}
