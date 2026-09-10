'use strict';

if (process.env.NEXA_INSTALL_STDIO_EPIPE_GUARD === '1') {
  const { installSafeStdout } = require('../../src/shared/safeStdio');
  installSafeStdout();
}

const chunk = Buffer.alloc(64 * 1024, 'x');

process.on('message', (message) => {
  if (message === 'write-after-parent-close') {
    let remaining = 200;
    const writeNext = () => {
      process.stdout.write(chunk);
      remaining -= 1;
      if (remaining > 0) {
        setImmediate(writeNext);
        return;
      }
      process.send?.('survived-closed-pipe');
    };
    writeNext();
    return;
  }

  if (message === 'stop') {
    process.exit(0);
  }
});

process.send?.('ready');
