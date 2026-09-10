# NEXA Mobile Capture Desktop Handoff v0.1

Contract version: `nexa.mobile.capture.desktop-handoff.v0.1`

## Ownership

This contract is owned by project `06_ANDROID_CAPTURE`. It reports what the Android capture
system is doing. It does not report whether the physical device or PC is online; device and
network topology remain owned by project 11.

## Public entrypoint

`NexaMobileCapturePublicEntrypoint.createDesktopHandoff(context)` returns a
`CaptureDesktopHandoff` whose only operation is the suspending, read-only `readStatus()` call.

The v0.1 entrypoint is an in-process Android adapter. A future Desktop assembly bridge may invoke
it, but that bridge must live in the assembly layer and must not add commands to this contract.

## Status fields

- Contract capture time.
- Stable installation `deviceId`, application id, version name, and version code.
- Capture enabled state, notification-listener permission state, and capture operational status.
- Sync status and configuration readiness.
- Pending, running, retry-pending, and terminal-failure aggregate counts.
- Last successful sync and next retry timestamps when the existing authority has them.
- Recent diagnostic category, stable reason code, and last queue activity time.

## Read-only and security boundary

The adapter reuses the existing Room capture settings, notification-listener health source,
platform permission state, and sync diagnostics source. It does not schedule work or update Room.

The public status deliberately excludes:

- raw credential, encrypted credential, authorization header, and certificate material;
- PC endpoint host, port, or path;
- notification payloads, captured business records, event ids, and queue ids;
- Room DAOs, repositories, scheduler commands, transports, and coordinator handles.

## Project 11 consumption boundary

Project 11 may consume the immutable status snapshot to display the Android capture subsystem's
health. It must not infer device/PC online state from sync readiness, mutate capture settings,
consume business records, or absorb capture ownership. No project 11 code is changed by v0.1.

## Assembly gap

This task freezes the public snapshot and Android adapter only. Desktop IPC/plugin registration is
an assembly concern and is intentionally not implemented inside the Android capture module.
