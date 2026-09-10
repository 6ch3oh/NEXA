'use strict';

const { spawnSync } = require('node:child_process');

const GENERIC_CREDENTIAL_TYPE = 1;
const MAX_CREDENTIAL_BYTES = 16 * 1024;

const READ_CREDENTIALS_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$source = @'
using System;
using System.Runtime.InteropServices;

public static class NexaCredentialManagerNative {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct Credential {
    public UInt32 Flags;
    public UInt32 Type;
    [MarshalAs(UnmanagedType.LPWStr)] public string TargetName;
    [MarshalAs(UnmanagedType.LPWStr)] public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public UInt32 CredentialBlobSize;
    public IntPtr CredentialBlob;
    public UInt32 Persist;
    public UInt32 AttributeCount;
    public IntPtr Attributes;
    [MarshalAs(UnmanagedType.LPWStr)] public string TargetAlias;
    [MarshalAs(UnmanagedType.LPWStr)] public string UserName;
  }

  [DllImport("Advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool CredRead(string target, UInt32 type, UInt32 reservedFlag, out IntPtr credentialPtr);

  [DllImport("Advapi32.dll", SetLastError = true)]
  public static extern void CredFree(IntPtr credentialPtr);
}
'@
Add-Type -TypeDefinition $source

function Read-NexaGenericCredential([string]$target) {
  $pointer = [IntPtr]::Zero
  if (-not [NexaCredentialManagerNative]::CredRead($target, ${GENERIC_CREDENTIAL_TYPE}, 0, [ref]$pointer)) {
    return $null
  }
  try {
    $credential = [Runtime.InteropServices.Marshal]::PtrToStructure(
      $pointer,
      [type][NexaCredentialManagerNative+Credential]
    )
    if ($credential.CredentialBlobSize -eq 0) { return '' }
    if ($credential.CredentialBlobSize -gt ${MAX_CREDENTIAL_BYTES}) { throw 'Credential blob is too large' }
    $bytes = New-Object byte[] $credential.CredentialBlobSize
    [Runtime.InteropServices.Marshal]::Copy($credential.CredentialBlob, $bytes, 0, $bytes.Length)
    try {
      $looksUtf16 = $bytes.Length % 2 -eq 0
      if ($looksUtf16) {
        for ($index = 1; $index -lt $bytes.Length; $index += 2) {
          if ($bytes[$index] -ne 0) {
            $looksUtf16 = $false
            break
          }
        }
      }
      $encoding = if ($looksUtf16) { [Text.Encoding]::Unicode } else { [Text.Encoding]::UTF8 }
      return $encoding.GetString($bytes).TrimEnd([char]0)
    } finally {
      [Array]::Clear($bytes, 0, $bytes.Length)
    }
  } finally {
    [NexaCredentialManagerNative]::CredFree($pointer)
  }
}

$targetsJson = [Text.Encoding]::UTF8.GetString(
  [Convert]::FromBase64String([Environment]::GetEnvironmentVariable('NEXA_CREDENTIAL_TARGETS_B64'))
)
$targets = $targetsJson | ConvertFrom-Json
$result = [ordered]@{}
foreach ($target in $targets) {
  $value = Read-NexaGenericCredential $target
  if ($null -eq $value) { exit 3 }
  $result[$target] = $value
}
$json = $result | ConvertTo-Json -Compress
$encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))
[Console]::Out.Write($encoded)
`;

function readWindowsGenericCredentials(targets, {
  platform = process.platform,
  spawn = spawnSync,
  timeoutMs = 5000,
  onDiagnostic = () => {}
} = {}) {
  if (platform !== 'win32') return null;
  const normalizedTargets = [...new Set((targets || []).map((target) => String(target || '').trim()))];
  if (normalizedTargets.length === 0 || normalizedTargets.some((target) => !target || target.length > 256)) {
    throw new Error('Windows credential targets are invalid');
  }
  const encodedScript = Buffer.from(READ_CREDENTIALS_SCRIPT, 'utf16le').toString('base64');
  const encodedTargets = Buffer.from(JSON.stringify(normalizedTargets), 'utf8').toString('base64');
  const result = spawn('powershell.exe', [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy', 'Bypass',
    '-EncodedCommand', encodedScript
  ], {
    encoding: 'buffer',
    windowsHide: true,
    timeout: timeoutMs,
    maxBuffer: MAX_CREDENTIAL_BYTES * 2,
    env: {
      ...process.env,
      NEXA_CREDENTIAL_TARGETS_B64: encodedTargets
    }
  });
  if (result.error || result.status !== 0 || !Buffer.isBuffer(result.stdout)) {
    onDiagnostic(Object.freeze({
      status: result.status,
      errorCode: result.error?.code || null,
      stderr: Buffer.isBuffer(result.stderr)
        ? result.stderr.toString('utf8').replace(/[\r\n]+/g, ' ').slice(0, 512)
        : ''
    }));
    result.stdout?.fill?.(0);
    result.stderr?.fill?.(0);
    return null;
  }

  const encoded = Buffer.from(result.stdout);
  let decoded;
  try {
    decoded = Buffer.from(encoded.toString('ascii').trim(), 'base64');
    if (decoded.length === 0 || decoded.length > MAX_CREDENTIAL_BYTES) return null;
    const parsed = JSON.parse(decoded.toString('utf8'));
    const values = {};
    for (const target of normalizedTargets) {
      const value = parsed?.[target];
      if (typeof value !== 'string' || value.length < 1 || value.length > 4096) return null;
      values[target] = value;
    }
    return Object.freeze(values);
  } catch (_) {
    return null;
  } finally {
    encoded.fill(0);
    decoded?.fill(0);
    result.stdout.fill(0);
    result.stderr?.fill(0);
  }
}

module.exports = {
  readWindowsGenericCredentials
};
