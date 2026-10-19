[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$ProjectRoot,
    [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'CodeMemory'),
    [string]$Clients = 'harness,codex,claude',
    [string]$SourceScope = '',
    [string]$PackageTarball = '',
    [string]$ModelCacheSource = '',
    [string]$SeedDirectory = '',
    [string]$HarnessModel = '',
    [ValidateSet('local', 'project')][string]$ClaudeScope = 'local',
    [switch]$SkipIndex
)

$ErrorActionPreference = 'Stop'
$cmProject = (Resolve-Path -LiteralPath $ProjectRoot).ProviderPath
if (-not (Test-Path -LiteralPath $cmProject -PathType Container)) { throw 'ProjectRoot must be a directory.' }
if ($Clients -notmatch '^(harness|codex|claude)(,(harness|codex|claude))*$') { throw 'Use -Clients harness,codex,claude or a subset.' }
$cmInstall = [IO.Path]::GetFullPath($InstallRoot)
$null = New-Item -ItemType Directory -Path $cmInstall -Force
$cmRepo = Split-Path -Parent $PSScriptRoot
$cmNode = $null
$cmSystemNode = Get-Command node -ErrorAction SilentlyContinue
if ($cmSystemNode) {
    $cmVersion = [version]((& $cmSystemNode.Source --version).TrimStart('v'))
    if (($cmVersion.Major -eq 22 -and $cmVersion -ge [version]'22.19.0') -or $cmVersion.Major -eq 24) { $cmNode = $cmSystemNode.Source }
}
if (-not $cmNode) {
    $cmRuntimeVersion = '24.21.0'
    $cmArch = if ([Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString() -eq 'Arm64') { 'arm64' } else { 'x64' }
    $cmRuntimeName = "node-v$cmRuntimeVersion-win-$cmArch"
    $cmRuntimeRoot = Join-Path $cmInstall 'runtime'
    $cmNode = Join-Path $cmRuntimeRoot "$cmRuntimeName/node.exe"
    if (-not (Test-Path -LiteralPath $cmNode -PathType Leaf)) {
        $null = New-Item -ItemType Directory -Path $cmRuntimeRoot -Force
        $cmZip = Join-Path $cmRuntimeRoot "$cmRuntimeName.zip"
        $cmChecksums = Join-Path $cmRuntimeRoot "node-v$cmRuntimeVersion-SHASUMS256.txt"
        $cmBaseUrl = "https://nodejs.org/dist/v$cmRuntimeVersion/"
        Write-Host "Downloading private Node.js $cmRuntimeVersion ($cmArch)..."
        Invoke-WebRequest -UseBasicParsing -Uri ($cmBaseUrl + 'SHASUMS256.txt') -OutFile $cmChecksums
        Invoke-WebRequest -UseBasicParsing -Uri ($cmBaseUrl + "$cmRuntimeName.zip") -OutFile $cmZip
        $cmChecksumLine = Get-Content -LiteralPath $cmChecksums | Where-Object { $_ -match ('^[0-9a-f]{64}\s+' + [regex]::Escape("$cmRuntimeName.zip") + '$') } | Select-Object -First 1
        if (-not $cmChecksumLine -or (Get-FileHash -LiteralPath $cmZip -Algorithm SHA256).Hash.ToLowerInvariant() -ne ($cmChecksumLine -split '\s+')[0]) { throw 'Node.js archive checksum mismatch.' }
        Expand-Archive -LiteralPath $cmZip -DestinationPath $cmRuntimeRoot -Force
    }
}
$cmNpm = Join-Path (Split-Path -Parent $cmNode) 'node_modules/npm/bin/npm-cli.js'
if (-not (Test-Path -LiteralPath $cmNpm -PathType Leaf)) { throw 'The selected Node.js installation must include npm.' }
function Invoke-CMNode([string[]]$Arguments) {
    $cmPriorPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        & $cmNode @Arguments
        $cmNativeExit = $LASTEXITCODE
    } finally { $ErrorActionPreference = $cmPriorPreference }
    if ($cmNativeExit -ne 0) { throw "CM command failed with exit code $cmNativeExit." }
}
$cmSavedPath = $env:PATH
try {
    $env:PATH = (Split-Path -Parent $cmNode) + ';' + $env:PATH
    if (-not $PackageTarball) {
        $cmBundledPackage = Join-Path $PSScriptRoot 'dsh-plugin-code-memory-0.9.1.tgz'
        if (Test-Path -LiteralPath $cmBundledPackage -PathType Leaf) { $PackageTarball = $cmBundledPackage }
        else {
            if (-not (Test-Path -LiteralPath (Join-Path $cmRepo 'package-lock.json'))) { throw 'Provide -PackageTarball or run from a source checkout.' }
            Push-Location -LiteralPath $cmRepo
            try {
                if (-not (Test-Path -LiteralPath (Join-Path $cmRepo 'node_modules/typescript/bin/tsc')) -or -not (Test-Path -LiteralPath (Join-Path $cmRepo 'node_modules/smol-toml/package.json'))) {
                    Invoke-CMNode @($cmNpm, 'ci', '--no-audit', '--no-fund')
                }
                Invoke-CMNode @($cmNpm, 'run', 'compile')
                $cmPackRoot = Join-Path $cmRepo '.artifacts/installer-pack'
                $null = New-Item -ItemType Directory -Path $cmPackRoot -Force
                $cmPacked = (Invoke-CMNode @($cmNpm, 'pack', '--pack-destination', $cmPackRoot, '--json')) | ConvertFrom-Json
                $PackageTarball = Join-Path $cmPackRoot $cmPacked[0].filename
            } finally { Pop-Location }
        }
    }
    $cmTarball = (Resolve-Path -LiteralPath $PackageTarball).ProviderPath
    $cmHash = (Get-FileHash -LiteralPath $cmTarball -Algorithm SHA256).Hash.ToLowerInvariant()
    $cmRelease = Join-Path $cmInstall ('releases/' + $cmHash.Substring(0, 16) + $(if ($Clients.Split(',') -contains 'harness') { '-h' } else { '-m' }))
    $cmPackage = Join-Path $cmRelease 'node_modules/dsh-plugin-code-memory'
    $cmReady = Join-Path $cmRelease 'cm-package-ready.json'
    if (-not (Test-Path -LiteralPath $cmReady)) {
        $null = New-Item -ItemType Directory -Path $cmRelease -Force
        $cmLocalTarball = Join-Path $cmRelease 'cm-package.tgz'
        Copy-Item -LiteralPath $cmTarball -Destination $cmLocalTarball -Force
        $cmDependencies = [ordered]@{ 'dsh-plugin-code-memory' = ('file:' + $cmLocalTarball.Replace('\', '/')) }
        if ($Clients.Split(',') -contains 'harness') { $cmDependencies['@deepseek-ai/dsh'] = '0.2.0-rc.2' }
        $cmManifest = [ordered]@{ name = 'code-memory-local-install'; version = '0.9.1'; private = $true; dependencies = $cmDependencies; overrides = @{ sharp = '0.35.5' } }
        [IO.File]::WriteAllText((Join-Path $cmRelease 'package.json'), ($cmManifest | ConvertTo-Json -Depth 6), [Text.UTF8Encoding]::new($false))
        Write-Host 'Installing CM and native dependencies into the selected directory...'
        Push-Location -LiteralPath $cmRelease
        try {
            Invoke-CMNode @($cmNpm, 'install', '--omit=dev', '--no-audit', '--no-fund', '--loglevel=error', '--install-strategy=hoisted', '--prefer-offline')
        } finally { Pop-Location }
        $cmInstalled = Get-Content -LiteralPath (Join-Path $cmPackage 'package.json') -Raw | ConvertFrom-Json
        if ($cmInstalled.name -ne 'dsh-plugin-code-memory' -or $cmInstalled.version -ne '0.9.1') { throw 'Unexpected CM package identity/version.' }
        [IO.File]::WriteAllText($cmReady, (@{sha256=$cmHash;version=$cmInstalled.version}|ConvertTo-Json), [Text.UTF8Encoding]::new($false))
    }
    if (-not $ModelCacheSource -and (Test-Path -LiteralPath (Join-Path $cmRepo '.artifacts/cm-embedding-models'))) { $ModelCacheSource = Join-Path $cmRepo '.artifacts/cm-embedding-models' }
    if (-not $SeedDirectory -and (Test-Path -LiteralPath (Join-Path $cmRepo '.artifacts/live-atlas/current.json'))) { $SeedDirectory = Join-Path $cmRepo '.artifacts/live-atlas' }
    $cmSetup = Join-Path $cmPackage 'dist/src/setup/cli.js'
    $cmArguments = @($cmSetup, 'install', '--root', $cmInstall, '--project', $cmProject, '--clients', $Clients, '--claude-scope', $ClaudeScope, '--download', 'true', '--prepare', $(if ($SkipIndex) {'false'} else {'true'}))
    if ($SourceScope) { $cmArguments += @('--source-scope', $SourceScope) }
    if ($ModelCacheSource) { $cmArguments += @('--model-source', $ModelCacheSource) }
    if ($SeedDirectory) { $cmArguments += @('--seed', $SeedDirectory) }
    if ($HarnessModel) { $cmArguments += @('--harness-model', $HarnessModel) }
    Invoke-CMNode $cmArguments
    Write-Host 'CM installed. Restart Codex/Claude Code in the selected project; use the generated start-harness.ps1 for Harness.'
    Write-Host ('Doctor: & ' + "'" + $cmNode + "' '" + $cmSetup + "' doctor --root '" + $cmInstall + "' --project '" + $cmProject + "'")
} finally { $env:PATH = $cmSavedPath }
