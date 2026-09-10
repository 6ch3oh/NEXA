# NEXA LiteLLM Pinned Runtime Toolchain Decision 001

Task: `NEXA-LITELLM-PINNED-RUNTIME-TOOLCHAIN-DECISION-001`

Status: `TOOLCHAIN_DECISION_PASS / RUNTIME_NOT_YET_STARTED`

## Plain-language decision

Python 3.13 is not the compatibility problem. The exact commit declares Python
`>=3.10,<3.15`. The previous installation was slow because this commit changed
the package build backend to Maturin and embeds a PyO3 Rust native module at
`litellm.rust_bridge._native`; installing directly from Git source therefore
builds native Rust code instead of downloading a wheel.

An official Windows prebuilt wheel exists for `1.99.0rc1`, but no official wheel
or release artifact exists for the exact pinned `1.99.0` commit. The RC wheel is
compatible with CPython 3.13 and Windows x86_64, but its tag resolves to a
different commit and is rejected. No installation was attempted.

The standard official Gateway command installs `litellm[proxy]`. At this commit,
that extra unconditionally depends on `litellm-enterprise==0.1.58`. That package
is explicitly proprietary. Its license permits development/testing without a
subscription, but production use requires a valid BerriAI Enterprise license.
NEXA's OSS-only commercial production path must therefore not silently install
it.

The correct decision is to freeze the official source toolchain, not run it in
this task: project-local `uv >=0.10.9`, the pinned `uv.lock`, Maturin `1.9.4`,
the pinned Cargo lock, and an explicit Rust build task if the exact commit remains
mandatory. Prefer waiting for an exact official Windows abi3 wheel and an
official OSS-only Gateway packaging clarification.

## A. Commit and version identity

- Pinned commit: `b9bff0998c9c89034314a81000ff8f9ff9158a01`.
- GitHub reports a verified commit dated 2026-08-22.
- The commit's `pyproject.toml` declares `version = "1.99.0"`.
- `requires-python = ">=3.10,<3.15"`; Python 3.13 is in range.
- Build backend: `maturin==1.9.4`.
- Native module: `litellm.rust_bridge._native`, bindings `pyo3`.

Official evidence:

- [Pinned GitHub commit](https://github.com/BerriAI/litellm/commit/b9bff0998c9c89034314a81000ff8f9ff9158a01)
- [Pinned pyproject.toml](https://raw.githubusercontent.com/BerriAI/litellm/b9bff0998c9c89034314a81000ff8f9ff9158a01/pyproject.toml)

## B. Official artifact audit

On 2026-08-23, official PyPI reports stable `1.98.0`; the exact
`/pypi/litellm/1.99.0/json` endpoint returns HTTP 404. GitHub has `1.99.0-dev.1`,
`1.99.0-dev.2`, and `1.99.0-rc.1` releases, but no final `1.99.0` release and no
release asset for the pinned commit.

Nearest rejected artifact:

- Filename: `litellm-1.99.0rc1-cp310-abi3-win_amd64.whl`.
- Official source: PyPI/files.pythonhosted.org.
- SHA-256: `24f3a4e0e2b84dcb985408a3d9008ee883a0f3c529b6811086ce48b0fb253ae7`.
- Python: CPython 3.10–3.14 through `cp310-abi3`.
- Platform: Windows x86_64 (`win_amd64`).
- Release tag commit: `947dbbf0298eecd3d226f765d4a4fb7ea3fd2551`.
- Rejected because it is `1.99.0rc1`, not `1.99.0`, and does not match the pinned
  commit.

Official evidence:

- [LiteLLM on PyPI](https://pypi.org/project/litellm/)
- [Official 1.99.0rc1 artifacts](https://pypi.org/project/litellm/1.99.0rc1/)
- [GitHub 1.99.0rc1 release](https://github.com/BerriAI/litellm/releases/tag/v1.99.0-rc.1)

## C. License and Enterprise hard gate

### Why the proxy extra includes Enterprise

The monorepo publishes core LiteLLM, migration-only `litellm-proxy-extras`, and
Enterprise features as separate distributions. The `proxy` extra is an aggregate
server feature set and currently lists both subpackages. This explains dependency
resolution behavior; it does not convert Enterprise code to MIT.

### Is Enterprise required for NEXA OSS-only Gateway?

It is required by the *declared official `proxy` extra*, because dependency
resolution is unconditional. It is not a base LiteLLM dependency, and Maturin
explicitly excludes the repository's `litellm/proxy/enterprise` directory from
the MIT core wheel. However, no separately named official OSS-only Gateway extra
or official dependency matrix was found. Consequently, an Enterprise-free server
install assembled manually cannot be claimed as an officially supported path.

### License answer

- LiteLLM core outside `enterprise/`: MIT.
- `litellm-proxy-extras==0.4.88`: MIT and contains proxy migrations.
- `litellm-enterprise==0.1.58`: `LicenseRef-Proprietary`.
- Development/testing without subscription: explicitly permitted.
- Production use by NEXA commercial product: requires a valid Enterprise
  subscription/license; otherwise not permitted.

Official evidence:

- [Pinned root license](https://raw.githubusercontent.com/BerriAI/litellm/b9bff0998c9c89034314a81000ff8f9ff9158a01/LICENSE)
- [Pinned Enterprise license](https://raw.githubusercontent.com/BerriAI/litellm/b9bff0998c9c89034314a81000ff8f9ff9158a01/enterprise/LICENSE.md)
- [Enterprise package metadata](https://pypi.org/project/litellm-enterprise/0.1.58/)

### Required capability answer

The public Gateway documentation exposes the OpenAI-compatible surface, aliases,
routing, fallback, budgets/rate limits, and credentials behind the Gateway. The
base package and public proxy code suggest these are not intrinsically Enterprise
features. But this audit did not find an official Enterprise-free proxy install
extra or an official test guarantee covering the complete requested feature set.
Therefore the answer to “can the full requested set run with Enterprise completely
absent?” is `NOT YET OFFICIALLY VERIFIED`, not an assumed yes.

## D. Frozen toolchain decision

Primary path:

1. Keep the exact commit pinned.
2. Wait for an official `1.99.0` Windows `cp310-abi3-win_amd64` wheel whose release
   tag/attestation can be related to the required commit.
3. Re-run artifact SHA-256, license, import, CLI, and fake-provider gates.

Exact-source fallback, requiring a separate OWNER-approved build task:

1. New module-local environment under `runtime_v2`; never reuse the failed venv.
2. Project-local `uv >=0.10.9` as declared by pinned `pyproject.toml`.
3. Frozen `uv.lock` and `litellm-rust/Cargo.lock` from the pinned commit.
4. Maturin exactly `1.9.4`, PyO3 native build, with a bounded build timeout and
   captured native compiler diagnostics.
5. Build only the MIT core package; do not build/install the Enterprise workspace
   package.
6. Do not claim a Gateway PASS until BerriAI publishes or confirms an official
   OSS-only Gateway dependency set.

## E. Actions not taken

- Artifact/package installation: `NO`.
- Enterprise package download or installation: `NO`.
- LiteLLM import/start: `NO`.
- Fake-provider POC: `NOT RUN`.
- System/global Python write: `NO`.
- Real Provider credentials/calls/cost: `NO / 0 / 0`.
- Docker, Production n8n, Core, ExecutionHub, Langfuse: `NOT TOUCHED`.
- Pinned upstream source modification: `NO`.

## F. Verification

- Focused decision tests: `6/6 PASS`.
- Full module regression: `570` tests, `569 PASS`, `1` expected unresolved
  acceptance failure. The only failure remains the previous real-runtime gate
  because `nonprod_poc.evidence.json` does not exist; Route B does not waive it.
- System Python: still 17 packages; `pip freeze` aggregate SHA-256 remains
  `734bae15cbdad6d3e41b1e55e593afe61c9863595fc5841d60294e681bfcccb7`.
- `litellm-enterprise` installed in system Python: `NO`.
- `runtime_v2/venv` created: `NO`.
- Wheel files downloaded: `0`.
- Pinned upstream: 8 files, HEAD unchanged, aggregate SHA-256 remains
  `a0c290614266783b2a78ca7bf7dbdfebe4f2853111147c1f8e8af193e3d604d2`.
- n8n Legacy: 294 files and 15,680,304 bytes, unchanged.

## Stop reason

`EXACT_PINNED_PREBUILT_ARTIFACT_NOT_FOUND_AND_OFFICIAL_OSS_ONLY_GATEWAY_PATH_NOT_PUBLISHED`
