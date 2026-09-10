'use strict';

const RECOMMENDATION = Object.freeze({
  engine: 'whisper.cpp',
  model: 'ggml-small.bin (multilingual)',
  download_size: '约 466 MiB',
  disk_size: '约 500 MiB（模型与引擎）',
  license: 'whisper.cpp: MIT；Whisper 模型权重: MIT'
});

function speechError(code) { return Object.assign(new Error('Local speech-to-text is unavailable'), { code }); }

function createLocalSpeechToTextProvider({ engine = null, transcribeImpl = null } = {}) {
  const available = Boolean(engine && typeof transcribeImpl === 'function');
  const state = Object.freeze({
    status: available ? 'ready' : 'provider_ready_gap',
    local_only: true,
    cloud_allowed: false,
    engine: available ? String(engine) : null,
    can_transcribe: available,
    recommendation: RECOMMENDATION
  });
  return Object.freeze({
    getState: () => state,
    async transcribe(input) {
      const bytes = input?.bytes;
      const length = bytes?.byteLength ?? bytes?.length ?? 0;
      if (!Number.isSafeInteger(length) || length <= 0 || length > 25 * 1024 * 1024) throw speechError('STT_AUDIO_INVALID');
      if (!available) throw speechError('STT_PROVIDER_UNAVAILABLE');
      const transcript = await transcribeImpl({ bytes, mimeType: String(input?.mimeType || '').slice(0, 100) });
      if (typeof transcript !== 'string' || !transcript.trim()) throw speechError('STT_TRANSCRIPT_EMPTY');
      return Object.freeze({ transcript: transcript.trim().slice(0, 2000), engine: String(engine), local_only: true });
    }
  });
}

module.exports = { RECOMMENDATION, createLocalSpeechToTextProvider };
