'use strict';

const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');

const originalLoad = Module._load;
const wrappedModules = new Map();
const tracePath = process.env.CODEX_MICRO_TRACE_LOG || path.join(
  process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
  'OpenCodexMicro',
  'diagnostics',
  'codex-micro-trace.ndjson'
);
const verbose = process.env.CODEX_MICRO_TRACE_VERBOSE === '1';

fs.mkdirSync(path.dirname(tracePath), { recursive: true });

function normalize(value, depth = 0, seen = new WeakSet()) {
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') {
    if (!verbose && /^(?:\\\\\?\\hid|hid#|com\d+$)/i.test(value)) return '[device-path]';
    return value.length > 2048 ? `${value.slice(0, 2048)}…` : value;
  }
  if (typeof value === 'bigint') return String(value);
  if (typeof value === 'function') return `[function ${value.name || 'anonymous'}]`;
  if (Buffer.isBuffer(value)) return { type: 'Buffer', length: value.length };
  if (value instanceof Error) {
    return { name: value.name, message: value.message, code: value.code ?? null };
  }
  if (depth >= 5) return '[max-depth]';
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  if (Array.isArray(value)) {
    return value.slice(0, 32).map(item => normalize(item, depth + 1, seen));
  }
  const result = {};
  for (const key of Object.keys(value).slice(0, 64)) {
    try {
      result[key] = normalize(value[key], depth + 1, seen);
    } catch (error) {
      result[key] = `[unreadable: ${error.message}]`;
    }
  }
  return result;
}

function record(event, data = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    pid: process.pid,
    event,
    data: normalize(data)
  };
  try {
    fs.appendFileSync(tracePath, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch {}
}

async function traceAsync(event, data, operation) {
  const startedAt = Date.now();
  record(`${event}.call`, data);
  try {
    const result = await operation();
    record(`${event}.return`, { durationMs: Date.now() - startedAt, result });
    return result;
  } catch (error) {
    record(`${event}.error`, { durationMs: Date.now() - startedAt, error });
    throw error;
  }
}

function traceSync(event, data, operation) {
  const startedAt = Date.now();
  record(`${event}.call`, data);
  try {
    const result = operation();
    record(`${event}.return`, { durationMs: Date.now() - startedAt, result });
    return result;
  } catch (error) {
    record(`${event}.error`, { durationMs: Date.now() - startedAt, error });
    throw error;
  }
}

function wrapCallback(event, callback) {
  if (typeof callback !== 'function') return callback;
  return (...args) => {
    record(event, { args });
    return Reflect.apply(callback, undefined, args);
  };
}

function replaceExport(exportsObject, name, value) {
  Object.defineProperty(exportsObject, name, {
    configurable: true,
    enumerable: true,
    writable: true,
    value
  });
}

function wrapDeviceKit(real) {
  if (wrappedModules.has(real)) return wrappedModules.get(real);
  const traced = Object.assign(Object.create(Object.getPrototypeOf(real)), real);

  if (typeof real.WLDeviceDiscovery === 'function') {
    class TracedDeviceDiscovery extends real.WLDeviceDiscovery {
      findWLDevices(...args) {
        return traceSync('deviceKit.discovery.findWLDevices', { args }, () => super.findWLDevices(...args));
      }

      async findWLBootloaderDevices(...args) {
        return traceAsync(
          'deviceKit.discovery.findWLBootloaderDevices',
          { args },
          () => super.findWLBootloaderDevices(...args)
        );
      }
    }
    replaceExport(traced, 'WLDeviceDiscovery', TracedDeviceDiscovery);
  }

  if (typeof real.WLDeviceCommImpl === 'function') {
    class TracedDeviceComm extends real.WLDeviceCommImpl {
      onConnectionEvent(callback) {
        record('deviceKit.comm.onConnectionEvent.subscribe');
        const unsubscribe = super.onConnectionEvent(wrapCallback('deviceKit.comm.connectionEvent', callback));
        return () => {
          record('deviceKit.comm.onConnectionEvent.unsubscribe');
          return unsubscribe?.();
        };
      }

      async connect(...args) {
        return traceAsync('deviceKit.comm.connect', { args }, () => super.connect(...args));
      }

      async disconnect(...args) {
        return traceAsync('deviceKit.comm.disconnect', { args }, () => super.disconnect(...args));
      }

      addNotifyHandler(method, handler) {
        record('deviceKit.comm.addNotifyHandler', { method });
        return super.addNotifyHandler(method, wrapCallback(`deviceKit.notify.${method}`, handler));
      }

      removeNotifyHandler(method) {
        record('deviceKit.comm.removeNotifyHandler', { method });
        return super.removeNotifyHandler(method);
      }

      async sendJsonRpcRequest(...args) {
        return traceAsync('deviceKit.comm.sendJsonRpcRequest', { args }, () => super.sendJsonRpcRequest(...args));
      }

      async sendLegacyRpcRequest(...args) {
        return traceAsync('deviceKit.comm.sendLegacyRpcRequest', { args }, () => super.sendLegacyRpcRequest(...args));
      }
    }
    replaceExport(traced, 'WLDeviceCommImpl', TracedDeviceComm);
  }

  if (typeof real.RPCApiOAI === 'function') {
    class TracedApi extends real.RPCApiOAI {
      onHidReceived(callback) {
        record('deviceKit.api.onHidReceived.subscribe');
        const unsubscribe = super.onHidReceived(wrapCallback('deviceKit.api.hidReceived', callback));
        return () => {
          record('deviceKit.api.onHidReceived.unsubscribe');
          return unsubscribe?.();
        };
      }

      onJoystickMove(callback) {
        record('deviceKit.api.onJoystickMove.subscribe');
        const unsubscribe = super.onJoystickMove(wrapCallback('deviceKit.api.joystickMove', callback));
        return () => {
          record('deviceKit.api.onJoystickMove.unsubscribe');
          return unsubscribe?.();
        };
      }

      async getFirmwareVersion(...args) {
        return traceAsync('deviceKit.api.getFirmwareVersion', { args }, () => super.getFirmwareVersion(...args));
      }

      async getDeviceStatus(...args) {
        return traceAsync('deviceKit.api.getDeviceStatus', { args }, () => super.getDeviceStatus(...args));
      }

      async sendLightingPreview(...args) {
        return traceAsync('deviceKit.api.sendLightingPreview', { args }, () => super.sendLightingPreview(...args));
      }

      async sendThreadsLighting(...args) {
        return traceAsync('deviceKit.api.sendThreadsLighting', { args }, () => super.sendThreadsLighting(...args));
      }

      async sendLightingConfig(...args) {
        return traceAsync('deviceKit.api.sendLightingConfig', { args }, () => super.sendLightingConfig(...args));
      }
    }
    replaceExport(traced, 'RPCApiOAI', TracedApi);
  }

  wrappedModules.set(real, traced);
  record('deviceKit.module.wrapped', {
    version: (() => {
      try {
        return require('@worklouder/device-kit-oai/package.json').version;
      } catch {
        return null;
      }
    })(),
    exports: Object.keys(real)
  });
  return traced;
}

function wrapTopologyAddon(real, request) {
  if (wrappedModules.has(real)) return wrappedModules.get(real);
  const traced = new Proxy(real, {
    get(target, property, receiver) {
      if (property === 'findCodexMicroInterfaces' && typeof target[property] === 'function') {
        return (...args) => traceSync(
          'topology.findCodexMicroInterfaces',
          { request, args },
          () => Reflect.apply(target[property], target, args)
        );
      }
      if (property === 'watch' && typeof target[property] === 'function') {
        return callback => {
          record('topology.watch.subscribe', { request });
          const watcher = Reflect.apply(target[property], target, [wrapCallback('topology.changed', callback)]);
          if (watcher && typeof watcher.dispose === 'function') {
            const originalDispose = watcher.dispose.bind(watcher);
            watcher.dispose = () => {
              record('topology.watch.dispose', { request });
              return originalDispose();
            };
          }
          return watcher;
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
  wrappedModules.set(real, traced);
  record('topology.module.wrapped', { request, exports: Object.keys(real) });
  return traced;
}

Module._load = function tracedModuleLoad(request, parent, isMain) {
  const isDeviceKit = request === '@worklouder/device-kit-oai';
  const isTopologyAddon = /hid[_-]topology[_-]watcher(?:-addon)?\.node$/i.test(String(request));
  if (isDeviceKit || isTopologyAddon) record('module.load.call', { request: String(request) });
  let loaded;
  try {
    loaded = Reflect.apply(originalLoad, this, [request, parent, isMain]);
  } catch (error) {
    if (isDeviceKit || isTopologyAddon) record('module.load.error', { request: String(request), error });
    throw error;
  }
  if (isDeviceKit) return wrapDeviceKit(loaded);
  if (isTopologyAddon) {
    return wrapTopologyAddon(loaded, String(request));
  }
  return loaded;
};

record('trace.started', {
  argv: process.argv,
  execPath: process.execPath,
  node: process.versions.node,
  electron: process.versions.electron ?? null,
  chrome: process.versions.chrome ?? null,
  codexVersion: process.env.CODEX_MICRO_CODEX_VERSION ?? null,
  tracePath,
  verbose
});
