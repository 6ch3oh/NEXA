'use strict';

const fs = require('node:fs');
const path = require('node:path');
const chokidar = require('chokidar');
const {
  buildExpenseSnapshot,
  clearExpenseDocument,
  ingestInboxFile,
  mergeRecords,
  normalizeExpenseDocument,
  previewCsvImport,
  readExpenseDocument,
  recordShape,
  writeExpenseDocument
} = require('../shared/expense');

const DEFAULT_INBOX_NAME = 'expense-inbox';

// Local read/write runtime for the expense module. Holds the in-memory document,
// owns the inbox watcher (chokidar, same as the collector), and exposes the
// operations the renderer calls over IPC. No network, no credentials, no arbitrary
// path access — inbox root and records file are both anchored under the expense dir.
function createExpenseRuntime(options = {}) {
  let root = options.root || '';
  let inboxDir = '';
  const fsApi = options.fs || fs;
  const logger = options.logger || (() => {});
  const onUpdate = options.onUpdate;
  let document = recordShape();
  let watcher = null;
  let processing = false;

  function ensureDirs() {
    if (!root) return;
    fsApi.mkdirSync(root, { recursive: true });
    inboxDir = path.join(root, options.inboxName || DEFAULT_INBOX_NAME);
    fsApi.mkdirSync(inboxDir, { recursive: true });
    fsApi.mkdirSync(path.join(inboxDir, 'processed'), { recursive: true });
    fsApi.mkdirSync(path.join(inboxDir, 'failed'), { recursive: true });
  }

  function recordsPath() {
    return path.join(root, options.recordsName || 'expense-records.json');
  }

  function load() {
    if (!root) return;
    ensureDirs();
    document = readExpenseDocument(recordsPath(), fsApi);
  }

  function persist() {
    if (!root) return;
    try {
      writeExpenseDocument(recordsPath(), document, { fs: fsApi });
    } catch (error) {
      logger(`[expense] write failed (kept in memory): ${error.message}`);
    }
  }

  function emit() {
    if (typeof onUpdate === 'function') onUpdate(runtime.getSnapshot());
  }

  function processInboxFile(filePath) {
    const fileName = path.basename(filePath);
    if (!String(fileName).toLowerCase().endsWith('.json')) return;
    if (!filePath.startsWith(inboxDir)) return;
    const relSuffix = filePath.slice(inboxDir.length + 1);
    if (!relSuffix || relSuffix.includes(path.sep)) return;
    let text;
    try {
      text = fsApi.readFileSync(filePath, 'utf8');
    } catch (_) {
      return;
    }
    // Never log raw content; only the outcome summary crosses the process boundary.
    const result = ingestInboxFile(document, text, {
      autoCategorize: runtime.autoCategorize(),
      defaultCurrency: runtime.defaultCurrency()
    });
    let outcome = result.outcome;
    if (outcome === 'ok' && result.added > 0) {
      try {
        writeExpenseDocument(recordsPath(), result.document, { fs: fsApi });
        document = normalizeExpenseDocument(result.document);
      } catch (error) {
        outcome = 'persistFailed';
        logger(`[expense] write failed for ${fileName}: ${error.message}`);
      }
    }
    const dest = outcome === 'ok'
      ? path.join(inboxDir, 'processed', fileName)
      : path.join(inboxDir, 'failed', fileName);
    try {
      // If a file with the same name already exists under the dest dir, retry with
      // a suffix so nothing is silently dropped.
      let target = dest;
      let n = 1;
      while (fsApi.existsSync(target)) {
        const ext = path.extname(fileName);
        target = path.join(path.dirname(dest), `${path.basename(fileName, ext)}-${n}${ext}`);
        n += 1;
      }
      fsApi.renameSync(filePath, target);
    } catch (error) {
      logger(`[expense] inbox move failed for ${fileName}: ${error.message}`);
      return;
    }
    if (outcome === 'ok' && result.added > 0) emit();
    logger(`[expense] inbox ${fileName}: ${outcome} (added ${result.added}, dupes ${result.duplicates})`);
  }

  function drainInbox() {
    if (processing) return;
    processing = true;
    try {
      let entries;
      try { entries = fsApi.readdirSync(inboxDir); } catch (_) { return; }
      for (const name of entries) {
        const full = path.normalize(path.join(inboxDir, name));
        const isJson = String(name).toLowerCase().endsWith('.json');
        if (!isJson) continue;
        let stat = null;
        try { stat = fsApi.lstatSync(full); } catch (_) { continue; }
        if (!stat.isFile()) continue;
        processInboxFile(full);
      }
    } finally {
      processing = false;
    }
  }

  function startWatcher() {
    if (watcher || !inboxDir) return;
    try {
      watcher = chokidar.watch(inboxDir, {
        // Only top-level .json drops; subdirs are our own processed/failed.
        depth: 0,
        persistent: true,
        followSymlinks: false,
        ignoreInitial: true
      });
      watcher.on('add', (filePath) => {
        if (filePath.endsWith('.json')) processInboxFile(filePath);
      });
      watcher.on('error', (error) => {
        logger(`[expense] inbox watcher error: ${error.message}`);
      });
    } catch (error) {
      logger(`[expense] inbox watcher start failed: ${error.message}`);
    }
  }

  function stopWatcher() {
    if (watcher) {
      try { watcher.close(); } catch (_) {}
      watcher = null;
    }
  }

  const runtime = {
    autoCategorize() {
      return Boolean(options.getSettings?.()?.expenseAutoCategorize) !== false;
    },
    defaultCurrency() {
      return options.getSettings?.()?.expenseDefaultCurrency || 'CNY';
    },
    getSnapshot() {
      const settings = options.getSettings?.() || {};
      const snapshot = buildExpenseSnapshot(document, {
        now: new Date(),
        recentLimit: 20,
        currency: settings.expenseDefaultCurrency || 'CNY'
      });
      return {
        ok: true,
        enabled: Boolean(settings.expenseEnabled),
        root,
        inboxDir,
        inboxCount: countJsonFiles(inboxDir, fsApi),
        processedCount: countJsonFiles(path.join(inboxDir, 'processed'), fsApi),
        failedCount: countJsonFiles(path.join(inboxDir, 'failed'), fsApi),
        ...snapshot
      };
    },
    records() {
      return {
        ok: true,
        records: [...document.records]
      };
    },
    importPreview(text) {
      if (typeof text !== 'string' || text.length > 2 * 1024 * 1024) {
        return { ok: false, error: 'tooLarge' };
      }
      return {
        ok: true,
        ...previewCsvImport(text, {
          autoCategorize: runtime.autoCategorize(),
          defaultCurrency: runtime.defaultCurrency()
        })
      };
    },
    importConfirm(drafts) {
      if (!Array.isArray(drafts) || drafts.length > 5000) return { ok: false, error: 'badBatch' };
      const merged = mergeRecords(document, drafts, {
        autoCategorize: runtime.autoCategorize(),
        defaultCurrency: runtime.defaultCurrency()
      });
      document = normalizeExpenseDocument(merged.document);
      persist();
      emit();
      return { ok: true, added: merged.added.length, duplicates: merged.duplicates.length, rejected: merged.rejected.length };
    },
    clear() {
      document = clearExpenseDocument();
      persist();
      emit();
      return { ok: true };
    },
    getInboxInfo() {
      return { ok: true, root, inboxDir, inboxCount: countJsonFiles(inboxDir, fsApi) };
    },
    start() {
      if (!root) return;
      load();
      startWatcher();
      drainInbox();
      emit();
    },
    reconfigure() {
      if (!root) return;
      load();
      startWatcher();
      drainInbox();
      emit();
    },
    stop() {
      stopWatcher();
    }
  };
  return runtime;
}

function countJsonFiles(dir, fsApi) {
  try {
    return fsApi.readdirSync(dir).filter((name) => String(name).toLowerCase().endsWith('.json')).length;
  } catch (_) {
    return 0;
  }
}

module.exports = { createExpenseRuntime, DEFAULT_INBOX_NAME };
