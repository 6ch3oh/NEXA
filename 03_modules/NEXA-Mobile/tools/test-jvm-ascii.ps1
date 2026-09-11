param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$GradleArguments = @($args)

if (-not ('NexaMobileAsciiTest.NativeMethods' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

namespace NexaMobileAsciiTest
{
    public static class NativeMethods
    {
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern uint QueryDosDevice(
            string lpDeviceName,
            StringBuilder lpTargetPath,
            int ucchMax
        );
    }
}
'@
}

function Get-DosDeviceTarget {
    param([Parameter(Mandatory = $true)][string] $Drive)

    $buffer = New-Object System.Text.StringBuilder 32768
    $length = [NexaMobileAsciiTest.NativeMethods]::QueryDosDevice(
        $Drive,
        $buffer,
        $buffer.Capacity
    )

    if ($length -eq 0) {
        return $null
    }

    return $buffer.ToString().Split([char]0)[0]
}

function Normalize-SubstTarget {
    param([AllowNull()][string] $Target)

    if ([string]::IsNullOrWhiteSpace($Target)) {
        return $null
    }

    $normalized = $Target
    if ($normalized.StartsWith('\??\', [StringComparison]::Ordinal)) {
        $normalized = $normalized.Substring(4)
    }

    return [IO.Path]::GetFullPath($normalized).TrimEnd('\')
}

function Test-SamePath {
    param(
        [Parameter(Mandatory = $true)][string] $Left,
        [Parameter(Mandatory = $true)][string] $Right
    )

    return [string]::Equals(
        ([IO.Path]::GetFullPath($Left).TrimEnd('\')),
        ([IO.Path]::GetFullPath($Right).TrimEnd('\')),
        [StringComparison]::OrdinalIgnoreCase
    )
}

function Convert-ProjectPathToAlias {
    param(
        [Parameter(Mandatory = $true)][string] $Path,
        [Parameter(Mandatory = $true)][string] $ProjectRoot,
        [Parameter(Mandatory = $true)][string] $MappedRoot
    )

    $fullPath = [IO.Path]::GetFullPath($Path).TrimEnd('\')
    $fullProjectRoot = [IO.Path]::GetFullPath($ProjectRoot).TrimEnd('\')
    $projectPrefix = $fullProjectRoot + '\'

    if ([string]::Equals($fullPath, $fullProjectRoot, [StringComparison]::OrdinalIgnoreCase)) {
        return $MappedRoot.TrimEnd('\')
    }

    if ($fullPath.StartsWith($projectPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        return Join-Path $MappedRoot $fullPath.Substring($projectPrefix.Length)
    }

    return $Path
}

$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')
$gradleWrapper = Join-Path $projectRoot 'gradlew.bat'
$settingsFile = Join-Path $projectRoot 'settings.gradle.kts'
$appBuildFile = Join-Path $projectRoot 'app\build.gradle.kts'

if (-not (Test-Path -LiteralPath $gradleWrapper -PathType Leaf) -or
    -not (Test-Path -LiteralPath $settingsFile -PathType Leaf) -or
    -not (Test-Path -LiteralPath $appBuildFile -PathType Leaf)) {
    throw "This launcher must remain inside the NEXA-Mobile project. Resolved root: $projectRoot"
}

$settingsText = Get-Content -Raw -LiteralPath $settingsFile
if ($settingsText -notmatch 'rootProject\.name\s*=\s*"NEXA Mobile"' -or
    $settingsText -notmatch 'include\("\:app"\)') {
    throw "Project identity validation failed for: $projectRoot"
}

if ($null -eq $GradleArguments -or $GradleArguments.Count -eq 0) {
    $GradleArguments = @(':app:testDebugUnitTest')
}

$originalLocation = Get-Location
$originalGradleUserHome = [Environment]::GetEnvironmentVariable('GRADLE_USER_HOME', 'Process')
$createdDrive = $null
$expectedTarget = $projectRoot
$gradleExitCode = 1
$gradleStarted = $false
$cleanupSucceeded = $true

try {
    $occupiedDriveNames = @(
        [IO.DriveInfo]::GetDrives() | ForEach-Object { $_.Name.Substring(0, 1) }
        Get-PSDrive -PSProvider FileSystem | ForEach-Object { $_.Name.Substring(0, 1) }
    )

    foreach ($codePoint in 90..68) {
        $letter = [char]$codePoint
        $drive = "${letter}:"

        if ($occupiedDriveNames -contains [string]$letter) {
            continue
        }

        if ($null -ne (Get-DosDeviceTarget -Drive $drive)) {
            continue
        }

        & subst.exe $drive $projectRoot
        if ($LASTEXITCODE -ne 0) {
            continue
        }

        $actualTarget = Normalize-SubstTarget (Get-DosDeviceTarget -Drive $drive)
        if ($null -eq $actualTarget -or -not (Test-SamePath -Left $actualTarget -Right $expectedTarget)) {
            throw "Created $drive but could not verify that it maps to the NEXA-Mobile project."
        }

        $createdDrive = $drive
        break
    }

    if ($null -eq $createdDrive) {
        throw 'No unused ASCII drive letter is available for the temporary JVM test mapping.'
    }

    $mappedRoot = $createdDrive + '\'

    if (-not [string]::IsNullOrWhiteSpace($originalGradleUserHome)) {
        $env:GRADLE_USER_HOME = Convert-ProjectPathToAlias `
            -Path $originalGradleUserHome `
            -ProjectRoot $projectRoot `
            -MappedRoot $mappedRoot
    }
    elseif (Test-Path -LiteralPath (Join-Path $projectRoot '.gradle-user-home') -PathType Container) {
        $env:GRADLE_USER_HOME = Join-Path $mappedRoot '.gradle-user-home'
    }

    Write-Host "NEXA-Mobile JVM test mapping: $mappedRoot -> $projectRoot"
    Write-Host "Running Gradle from ASCII project root: $mappedRoot"

    Set-Location -LiteralPath $mappedRoot
    $mappedGradleWrapper = Join-Path $mappedRoot 'gradlew.bat'
    $gradleStarted = $true
    & $mappedGradleWrapper @GradleArguments
    $gradleExitCode = $LASTEXITCODE
}
catch {
    Write-Error $_
    if (-not $gradleStarted) {
        $gradleExitCode = 1
    }
}
finally {
    try {
        Set-Location -LiteralPath $projectRoot
    }
    catch {
        Set-Location -LiteralPath ($env:SystemDrive + '\')
    }

    if ($null -ne $createdDrive) {
        $currentTarget = Normalize-SubstTarget (Get-DosDeviceTarget -Drive $createdDrive)
        if ($null -ne $currentTarget -and (Test-SamePath -Left $currentTarget -Right $expectedTarget)) {
            & subst.exe $createdDrive /D
            if ($LASTEXITCODE -ne 0 -or $null -ne (Get-DosDeviceTarget -Drive $createdDrive)) {
                $cleanupSucceeded = $false
                Write-Error "Failed to remove temporary mapping $createdDrive"
            }
            else {
                Write-Host "Removed temporary JVM test mapping: $createdDrive"
            }
        }
        elseif ($null -ne $currentTarget) {
            $cleanupSucceeded = $false
            Write-Error "Refusing to remove $createdDrive because its mapping identity changed."
        }
    }

    if ([string]::IsNullOrWhiteSpace($originalGradleUserHome)) {
        Remove-Item Env:GRADLE_USER_HOME -ErrorAction SilentlyContinue
    }
    else {
        $env:GRADLE_USER_HOME = $originalGradleUserHome
    }

    try {
        Set-Location -LiteralPath $originalLocation.Path
    }
    catch {
        Set-Location -LiteralPath $projectRoot
    }
}

if (-not $cleanupSucceeded -and $gradleExitCode -eq 0) {
    exit 1
}

exit $gradleExitCode
