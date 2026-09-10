# Driving Theory Offline OCR Gate

This gate exists only to generate and validate private local OCR drafts from the
user-provided driving-theory PDF. It does not promote OCR output into study
content and does not change the source classification.

## Source boundary

- Source: `USER_PROVIDED`
- Origin: `THIRD_PARTY_SOURCE_UNVERIFIED`
- Official: `false`
- Redistribution: `NOT_ESTABLISHED`
- NEXA bundling: `NO`
- OCR processing: local only

The PDF and extracted questions must never be uploaded to OCR, Vision, search,
answer-verification, enrichment, or commercial API services.

## Accepted runtime

The accepted Windows runtime is the second local candidate:

- RapidOCR `3.8.1`
- ONNX Runtime CPU `1.28.0`
- wheel-bundled `ch_PP-OCRv4_det_infer.onnx`
- wheel-bundled `ch_PP-OCRv4_rec_infer.onnx`

The Python runner blocks socket connections before RapidOCR is imported and
passes explicit local model paths. OCR results and models stay below
`.local-tools/driving-ocr-gate/`, which is ignored.

PaddleOCR `3.7.0` with PaddlePaddle CPU `3.3.1` and the official
`PP-OCRv5_server_det` / `PP-OCRv5_server_rec` models was evaluated first. The
models loaded through an ASCII path alias, but native CPU inference was not
stable on this Windows environment. It is retained only as failed-candidate
evidence and is not the accepted runtime.

## Why the ASCII drive alias is required

The project path contains non-ASCII characters. Native inference libraries on
this Windows environment did not reliably open models through that path. The
PowerShell entry point creates a temporary `SUBST` alias, runs entirely against
the same module files, and removes the alias in `finally`.

Choose another unused drive letter if `R:` is already occupied:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/run-driving-theory-ocr-gold-gate.ps1
powershell -ExecutionPolicy Bypass -File scripts/run-driving-theory-ocr-gold-gate.ps1 -AsciiDriveLetter Q
```

## Gold Set contract

Truth is imported from the existing, manually verified
`DRIVING_THEORY_USER_PDF_PILOT_ITEMS`. OCR never supplies its own truth.

All 20 pages must satisfy every rule:

- normalized question is present exactly;
- every normalized option is present exactly;
- normalized explanation is present exactly;
- the expected answer letter appears as a labelled answer signal;
- coverage diagnostics remain above the declared thresholds.

A missing page or any field-level failure makes the whole gate fail. Gate
success permits only a later batch **structured draft** phase. Automatic
consistency checks and manual QA remain mandatory before any content promotion.

## Runtime installation

Create the ignored venv under `.local-tools/driving-ocr-gate/` and install only
the pinned packages in `scripts/driving-theory-ocr-runtime-requirements.txt`.
For the accepted candidate:

```powershell
python -m venv .local-tools/driving-ocr-gate/venv-rapidocr
.local-tools/driving-ocr-gate/venv-rapidocr/Scripts/python.exe -m pip install rapidocr==3.8.1 onnxruntime==1.28.0
```

Package/model downloads are bootstrap-only. Actual PDF processing is offline.
