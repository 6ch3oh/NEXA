import { PronunciationAccent } from '../adapters/pronunciation-contract.mjs';

export const LOCAL_TTS_ADAPTER_VERSION = '0.1';
export const LocalTtsRuntime = Object.freeze({
  SHERPA_ONNX: 'sherpa-onnx',
  WINDOWS_SAPI: 'windows-sapi',
});

export function createLocalTtsRuntimeDescriptor({
  runtime,
  runtimeVersion,
  runtimeLicense = runtime === LocalTtsRuntime.SHERPA_ONNX ? 'Apache-2.0' : 'WINDOWS_COMPONENT',
  voices = [],
  available = false,
}) {
  if (!Object.values(LocalTtsRuntime).includes(runtime)) throw new TypeError(`unsupported local TTS runtime: ${runtime}`);
  if (typeof runtimeVersion !== 'string' || runtimeVersion.trim() === '') throw new TypeError('runtimeVersion required');
  if (typeof available !== 'boolean') throw new TypeError('available must be boolean');
  const normalizedVoices = voices.map((voice, index) => {
    if (!Object.values(PronunciationAccent).includes(voice.accent)) throw new TypeError(`voices[${index}].accent invalid`);
    for (const field of ['voiceId', 'voiceVersion', 'modelLicense']) {
      if (typeof voice[field] !== 'string' || voice[field].trim() === '') throw new TypeError(`voices[${index}].${field} required`);
    }
    return Object.freeze({
      voiceId: voice.voiceId,
      voiceVersion: voice.voiceVersion,
      accent: voice.accent,
      modelLicense: voice.modelLicense,
      modelPath: voice.modelPath ?? null,
      tokensPath: voice.tokensPath ?? null,
      displayName: voice.displayName ?? voice.voiceId,
      language: voice.language ?? null,
      redistribution: voice.redistribution ?? 'NOT_BUNDLED',
    });
  });
  if (typeof runtimeLicense !== 'string' || runtimeLicense.trim() === '') throw new TypeError('runtimeLicense required');
  return Object.freeze({
    adapterVersion: LOCAL_TTS_ADAPTER_VERSION,
    runtime,
    runtimeVersion,
    runtimeLicense,
    available,
    fullyOffline: true,
    voices: Object.freeze(normalizedVoices),
  });
}

export function createLocalTtsAdapter({ descriptor, synthesize }) {
  if (!descriptor || descriptor.adapterVersion !== LOCAL_TTS_ADAPTER_VERSION) throw new TypeError('valid TTS descriptor required');
  if (descriptor.available && typeof synthesize !== 'function') throw new TypeError('available runtime requires synthesize()');
  return Object.freeze({
    adapterVersion: LOCAL_TTS_ADAPTER_VERSION,
    descriptor,
    supports(accent) {
      return descriptor.available && descriptor.voices.some((voice) => voice.accent === accent);
    },
    async synthesize(request) {
      if (!descriptor.available) {
        return Object.freeze({ ok: false, error: { code: 'LOCAL_TTS_RUNTIME_UNAVAILABLE', message: 'local TTS runtime is not installed' } });
      }
      const voice = descriptor.voices.find((candidate) => candidate.voiceId === request.voiceId && candidate.accent === request.accent);
      if (!voice) return Object.freeze({ ok: false, error: { code: 'LOCAL_TTS_VOICE_UNAVAILABLE', message: 'requested local voice is not installed' } });
      return synthesize({ ...request, voice });
    },
  });
}
