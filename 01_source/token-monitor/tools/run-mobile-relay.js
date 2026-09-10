'use strict';

const fs = require('node:fs');
const { createMobileRelayServer } = require('../src/relay/server');

const USAGE = 'Usage: node tools/run-mobile-relay.js --host <host> --port <port> --key <key.pem> --cert <cert.pem>';
const REQUIRED_OPTIONS = Object.freeze(['host', 'port', 'key', 'cert']);

function parseArguments(argv) {
  if (!Array.isArray(argv)) throw new Error('Relay arguments must be an array');
  if (argv.includes('--help') || argv.includes('-h')) return { help: true };
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!/^--(host|port|key|cert)$/.test(flag || '') || value === undefined || value.startsWith('--')) {
      throw new Error('Invalid Relay argument');
    }
    const name = flag.slice(2);
    if (Object.hasOwn(options, name)) throw new Error(`Duplicate Relay option: --${name}`);
    options[name] = value;
  }
  for (const name of REQUIRED_OPTIONS) {
    if (!Object.hasOwn(options, name) || !String(options[name]).trim()) {
      throw new Error(`Missing required Relay option: --${name}`);
    }
  }
  const port = Number(options.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('Relay port must be an integer from 0 through 65535');
  }
  return Object.freeze({
    host: String(options.host).trim(),
    port,
    keyPath: String(options.key),
    certPath: String(options.cert)
  });
}

async function run(argv, {
  readFile = fs.readFileSync,
  stdout = process.stdout,
  logger = console
} = {}) {
  const options = parseArguments(argv);
  if (options.help) {
    stdout.write(`${USAGE}\n`);
    return null;
  }
  const relay = createMobileRelayServer({
    host: options.host,
    port: options.port,
    key: readFile(options.keyPath),
    cert: readFile(options.certPath),
    logger
  });
  await relay.start();
  const address = relay.address();
  stdout.write(`[mobile-relay] LISTENING host=${address.address} port=${address.port}\n`);
  return relay;
}

async function main() {
  const relay = await run(process.argv.slice(2));
  if (!relay) return;
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    await relay.stop();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`[mobile-relay] START_FAILED code=${String(error?.code || 'INVALID_CONFIGURATION')}\n`);
    process.stderr.write(`${USAGE}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  USAGE,
  parseArguments,
  run
};
