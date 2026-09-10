'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  trustedEndpointHeaders,
  trustedUnicastHost
} = require('../../src/electron/mobileSyncReceiver');

test('authenticated endpoint hints support routed unicast IPv4 and IPv6', () => {
  assert.deepEqual(trustedEndpointHeaders(() => ({
    transport: 'HTTPS', host: '203.0.113.17', port: 17322
  })), {
    'X-NEXA-Trusted-Endpoint': 'https://203.0.113.17:17322'
  });
  assert.deepEqual(trustedEndpointHeaders(() => ({
    transport: 'HTTPS', host: '2001:db8::17', port: 17322
  })), {
    'X-NEXA-Trusted-Endpoint': 'https://[2001:db8::17]:17322'
  });
});

test('endpoint hints reject loopback, unspecified, multicast, link-local IPv6 and malformed hosts', () => {
  for (const host of ['127.0.0.1', '0.0.0.0', '::', '::1', 'ff02::1', 'fe80::17', 'relay.example']) {
    assert.equal(trustedUnicastHost(host), null);
    assert.deepEqual(trustedEndpointHeaders(() => ({
      transport: 'HTTPS', host, port: 17322
    })), {});
  }
});

test('trusted endpoint provider receives the authenticated request context', () => {
  const request = { socket: { localAddress: '2001:db8::17' } };
  let received = null;
  trustedEndpointHeaders((value) => {
    received = value;
    return { transport: 'HTTPS', host: value.socket.localAddress, port: 17322 };
  }, request);
  assert.equal(received, request);
});
