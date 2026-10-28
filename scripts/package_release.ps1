[CmdletBinding()]
param([string]$OutputDirectory = (Join-Path $PSScriptRoot '../.artifacts/releases'))

$ErrorActionPreference = 'Stop'
$cmRepository = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).ProviderPath
$cmOutput = [IO.Path]::GetFullPath($OutputDirectory)
$cmManifest = Get-Content -LiteralPath (Join-Path $cmRepository 'package.json') -Raw | ConvertFrom-Json
$cmVersion = $cmManifest.version
if ($cmVersion -notmatch '^\d+\.\d+\.\d+$') { throw 'Use a numeric package version.' }
$cmCompiledVersion = Join-Path $cmRepository 'dist/src/version.js'
if (-not (Test-Path -LiteralPath $cmCompiledVersion) -or (Get-Content -LiteralPath $cmCompiledVersion -Raw) -notmatch ('"' + [regex]::Escape($cmVersion) + '"')) { throw 'Build the current package before creating a release.' }
$cmNode = (Get-Command node -ErrorAction Stop).Source
$cmNpm = Join-Path (Split-Path -Parent $cmNode) 'node_modules/npm/bin/npm-cli.js'
if (-not (Test-Path -LiteralPath $cmNpm)) { throw 'Use a supported Node.js installation with npm.' }
$cmStage = Join-Path $cmOutput 'staging'
if (Test-Path -LiteralPath $cmOutput) { throw 'Choose a new OutputDirectory; release artifacts are not overwritten.' }
$null = New-Item -ItemType Directory -Path $cmStage -Force
Push-Location -LiteralPath $cmRepository
try {
    $cmCommit = (& git rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0) { throw 'Cannot resolve the release commit.' }
    $cmDirty = @(& git status --porcelain).Count -gt 0
    if ($cmDirty) { throw 'Commit verified source changes before packaging a release.' }
    & $cmNode $cmNpm run package:check
    if ($LASTEXITCODE -ne 0) { throw 'The committed runtime is missing or stale.' }
    $cmPackText = & $cmNode $cmNpm pack --pack-destination $cmStage --json
    if ($LASTEXITCODE -ne 0) { throw 'npm pack failed.' }
    $cmPack = $cmPackText | ConvertFrom-Json
} finally { Pop-Location }
$cmTarball = Join-Path $cmStage $cmPack[0].filename
$cmHash = (Get-FileHash -LiteralPath $cmTarball -Algorithm SHA256).Hash.ToLowerInvariant()
Copy-Item -LiteralPath (Join-Path $cmRepository 'scripts/install_cm.ps1') -Destination (Join-Path $cmStage 'install_cm.ps1')
$cmGuide = Get-Content -LiteralPath (Join-Path $cmRepository 'docs/INSTALL-WINDOWS.md') -Raw
$cmGuide = $cmGuide.Replace('(NATIVE-CLIENTS.md)', '(https://github.com/kobubu/Rag-Coding/blob/v' + $cmVersion + '/docs/NATIVE-CLIENTS.md)')
$cmGuide = $cmGuide.Replace('(../README.md)', '(https://github.com/kobubu/Rag-Coding/blob/v' + $cmVersion + '/README.md)')
$cmGuide = $cmGuide.Replace('(INSTALL.md)', '(https://github.com/kobubu/Rag-Coding/blob/v' + $cmVersion + '/docs/INSTALL.md)')
$cmGuide = $cmGuide.Replace('(DEEPSEEK-PLUGIN.md#github-installation)', '(https://github.com/kobubu/Rag-Coding/blob/v' + $cmVersion + '/docs/DEEPSEEK-PLUGIN.md#github-installation)')
[IO.File]::WriteAllText((Join-Path $cmStage 'README.md'), $cmGuide, [Text.UTF8Encoding]::new($false))
$cmRelease = [ordered]@{
    format = 'cm-windows-release-1'; version = $cmVersion; source_commit = $cmCommit; source_dirty = $false
    package = [ordered]@{ name = $cmManifest.name; filename = $cmPack[0].filename; sha256 = $cmHash }
    harness_version = '0.2.0-rc.2'; private_node_fallback = '24.21.0'
    includes = @('PowerShell bootstrap', 'prebuilt npm package', 'English installation guide')
    downloads_on_install = @('npm runtime dependencies', 'pinned embedding model', 'private Node.js if needed')
    native_client_auto_context = 'manual hook setup; installer adds MCP connections only'
}
$cmManifestText = ($cmRelease | ConvertTo-Json -Depth 6) + "`n"
[IO.File]::WriteAllText((Join-Path $cmStage 'release-manifest.json'), $cmManifestText, [Text.UTF8Encoding]::new($false))
$cmInternalSums = Get-ChildItem -LiteralPath $cmStage -File | Sort-Object Name | ForEach-Object { (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() + '  ' + $_.Name }
[IO.File]::WriteAllText((Join-Path $cmStage 'SHA256SUMS.txt'), (($cmInternalSums -join "`n") + "`n"), [Text.UTF8Encoding]::new($false))
$cmZip = Join-Path $cmOutput "CM-$cmVersion-Windows.zip"
Compress-Archive -Path (Join-Path $cmStage '*') -DestinationPath $cmZip
Copy-Item -LiteralPath $cmTarball -Destination $cmOutput
Copy-Item -LiteralPath (Join-Path $cmStage 'release-manifest.json') -Destination $cmOutput
$cmAssets = Get-ChildItem -LiteralPath $cmOutput -File | Sort-Object Name
$cmSums = $cmAssets | ForEach-Object { (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() + '  ' + $_.Name }
[IO.File]::WriteAllText((Join-Path $cmOutput 'SHA256SUMS.txt'), (($cmSums -join "`n") + "`n"), [Text.UTF8Encoding]::new($false))
[pscustomobject]@{ version = $cmVersion; source_commit = $cmCommit; output = $cmOutput; zip = $cmZip; zip_sha256 = (Get-FileHash -LiteralPath $cmZip -Algorithm SHA256).Hash.ToLowerInvariant() } | ConvertTo-Json
