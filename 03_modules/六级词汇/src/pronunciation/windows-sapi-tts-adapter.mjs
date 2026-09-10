import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { PronunciationAccent } from '../adapters/pronunciation-contract.mjs';
import { LocalTtsRuntime, createLocalTtsAdapter, createLocalTtsRuntimeDescriptor } from './local-tts-adapter.mjs';

export const WINDOWS_SAPI_TTS_ADAPTER_VERSION = '0.1';
const execFileAsync = promisify(execFile);
const scriptPath = join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))), 'scripts', 'windows-sapi-tts.ps1');

function accentForLanguage(language) {
  const normalized = String(language ?? '').toLowerCase();
  if (normalized === '409' || normalized === '0409') return PronunciationAccent.US;
  if (normalized === '809' || normalized === '0809') return PronunciationAccent.UK;
  return null;
}

async function defaultRunner(args) {
  const { stdout } = await execFileAsync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...args,
  ], { windowsHide: true, maxBuffer: 1024 * 1024 });
  return stdout.trim();
}

export async function detectWindowsSapiVoices({ runner = defaultRunner } = {}) {
  if (process.platform !== 'win32') return Object.freeze([]);
  const output = await runner(['-Operation', 'list']);
  const parsed = JSON.parse(output || '[]');
  const voices = (Array.isArray(parsed) ? parsed : [parsed]).flatMap((voice) => {
    const accent = accentForLanguage(voice.language);
    if (accent === null) return [];
    return [{
      voiceId: voice.voiceTokenId,
      voiceVersion: 'windows-sapi-token-v1',
      displayName: voice.displayName,
      language: accent === PronunciationAccent.US ? 'en-US' : 'en-GB',
      accent,
      modelLicense: 'WINDOWS_INSTALLED_COMPONENT',
      redistribution: 'NOT_BUNDLED',
      modelPath: null,
      tokensPath: null,
    }];
  });
  return Object.freeze(voices.map(Object.freeze));
}

export async function createWindowsSapiTtsAdapter({
  runner = defaultRunner,
  clock = () => new Date().toISOString(),
  outputDirectory = join(tmpdir(), 'nexa-cet6-sapi'),
} = {}) {
  let voices = [];
  let detectionError = null;
  try {
    voices = await detectWindowsSapiVoices({ runner });
  } catch (error) {
    detectionError = { code: 'WINDOWS_SAPI_DETECTION_FAILED', message: error.message };
  }
  const descriptor = createLocalTtsRuntimeDescriptor({
    runtime: LocalTtsRuntime.WINDOWS_SAPI,
    runtimeVersion: WINDOWS_SAPI_TTS_ADAPTER_VERSION,
    runtimeLicense: 'WINDOWS_COMPONENT',
    voices,
    available: voices.length > 0,
  });
  const adapter = createLocalTtsAdapter({
    descriptor,
    async synthesize({ word, voice }) {
      await mkdir(outputDirectory, { recursive: true });
      const outputPath = join(outputDirectory, `speech-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.wav`);
      const output = await runner([
        '-Operation', 'synthesize', '-Text', word, '-VoiceTokenId', voice.voiceId, '-OutputPath', outputPath,
      ]);
      const result = JSON.parse(output);
      return Object.freeze({
        ok: true,
        localAssetRef: result.outputPath,
        createdAt: clock(),
        sourceType: 'LOCAL_TTS',
        audioMetadata: Object.freeze({ format: 'wav', bytes: result.bytes, runtime: LocalTtsRuntime.WINDOWS_SAPI }),
      });
    },
  });
  return Object.freeze({ ...adapter, detectionError });
}
