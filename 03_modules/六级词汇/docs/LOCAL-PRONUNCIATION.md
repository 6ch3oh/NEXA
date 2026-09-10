# Local Pronunciation and TTS V0.1

## Dual-accent closeout — 2026-08-14

- Status: `DUAL_ACCENT_LOCAL_TTS_READY`
- US: `LOCAL_US_PRONUNCIATION_READY` — Microsoft Zira Desktop, en-US
- UK: `LOCAL_UK_PRONUNCIATION_READY` — Microsoft Hazel Desktop, en-GB
- Default accent: US
- Real smoke: US 10 normal + 2 long words; UK 10 real words
- WAV/cache: PASS; cache contains 22 accent-aware entries
- Cache identity: normalized word + accent + voiceId + voiceVersion
- Network TTS/runtime network dependency: 0
- Resolved: `UK_VOICE_NOT_INSTALLED` on `2026-08-14`

The older text below records the state before Hazel was installed and is retained as historical evidence.

默认口音为 US，显式支持 UK。播放优先级：授权本地真人音频 → 本地 TTS Cache → 本地 TTS 生成 → 明确 unavailable。运行时不调用在线词典或在线 TTS。

Cache identity 为 `normalized word + accent + voiceId + voiceVersion` 的 SHA-256；升级 voiceVersion 会自然生成新 key，也可按 voice/version 显式 invalidate。清单和音频都保存在调用方指定的绝对本地目录，写入串行化以避免并发丢更新。

## TTS 选型审计

- sherpa-onnx：项目源码 Apache-2.0，官方仓库声明支持离线、Windows、NodeJS，并具备未来 Android 路径。来源：https://github.com/k2-fsa/sherpa-onnx
- MeloTTS：项目源码 MIT，可完全本地运行，但当前 Node/Windows 集成路径不如 sherpa-onnx 直接。来源：https://github.com/myshell-ai/MeloTTS

V0.1 仅建立 sherpa-onnx runtime descriptor 与可注入 Adapter，没有安装 runtime 或下载 voice model。原因是模型文件许可证必须逐 voice 审计，不能从 runtime 源码许可证推断模型许可证。Descriptor 强制每个 voice 提供 `modelLicense / voiceVersion / modelPath / tokensPath`，缺少时拒绝配置。

因此当前状态为 `LOCAL_TTS_RUNTIME_READY_CONTRACT`；真实 US/UK voice、模型体积、CPU 性能、首次加载耗时仍为 `PENDING_MODEL_SELECTION_AND_LICENSE_AUDIT`。
