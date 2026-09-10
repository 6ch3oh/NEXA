'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..', '..');

test('Desktop trusted reconnect composes bounded candidates and authenticates before persistence', () => {
  const main = fs.readFileSync(path.join(root, 'src', 'electron', 'main.js'), 'utf8');
  const reverse = fs.readFileSync(path.join(root, 'src', 'electron', 'mobileReverseLanTransport.js'), 'utf8');
  const receiver = fs.readFileSync(path.join(root, 'src', 'electron', 'mobileSyncReceiver.js'), 'utf8');
  assert.match(main, /listTrustedPeerCandidates\(\)/);
  assert.match(main, /windowsArpPeerCandidates\(\)/);
  assert.match(main, /discoverReverseLanPeers\(\{ interfaces \}\)/);
  assert.match(main, /mobileAuthenticatedPeerResolver:[\s\S]*?authenticatedPeerCandidate\(req\.socket\)/);
  assert.match(main, /transportMode: TRANSPORT_MODE\.AUTO/);
  assert.match(receiver, /authorizeDevice[\s\S]*?recordAuthenticatedPeer/);
  assert.match(reverse, /MAX_CANDIDATES = 32/);
  assert.doesNotMatch(reverse, /for \(let last = 1; last <= 254/);
  assert.doesNotMatch(reverse, /fullScan|FULL_SCAN/);
  assert.doesNotMatch(main, /route\.exe|netsh|Set-Net|New-NetFirewallRule/);
});
