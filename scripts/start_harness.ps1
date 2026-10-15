[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$ProjectRoot,
    [ValidateRange(0, 65535)][int]$Port = 61332,
    [string]$SourceScope = '',
    [string]$Model = 'gpt-6-luna',
    [switch]$NoOpen,
    [switch]$PrepareOnly
)

$ErrorActionPreference = 'Stop'
$cmRepository = Split-Path -Parent $PSScriptRoot
$cmProject = (Resolve-Path -LiteralPath $ProjectRoot).ProviderPath
if (-not (Test-Path -LiteralPath $cmProject -PathType Container)) { throw 'ProjectRoot must be a directory.' }
if ($SourceScope) {
    $cmScope = [IO.Path]::GetFullPath((Join-Path $cmProject $SourceScope))
    if (-not $cmScope.StartsWith($cmProject.TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or
        -not (Test-Path -LiteralPath $cmScope -PathType Container)) { throw 'SourceScope must be an existing directory inside ProjectRoot.' }
}

$cmRuntimeFile = Join-Path $cmRepository '.artifacts/cm-node-runtime.json'
$cmNode = if (Test-Path -LiteralPath $cmRuntimeFile) {
    (Get-Content -LiteralPath $cmRuntimeFile -Raw | ConvertFrom-Json).node
} else { (Get-Command node -ErrorAction Stop).Source }
if (-not (Test-Path -LiteralPath $cmNode -PathType Leaf)) { throw 'The configured Node.js runtime is missing.' }
$cmNodeVersion = [version]((& $cmNode --version).TrimStart('v'))
if (-not (($cmNodeVersion.Major -eq 22 -and $cmNodeVersion -ge [version]'22.19.0') -or $cmNodeVersion.Major -eq 24)) {
    throw 'Use Node.js 24 or Node.js 22 from 22.19.0.'
}
$cmHarness = Join-Path $cmRepository '.artifacts/dsh-stand/node_modules/@deepseek-ai/dsh/lib/bin.js'
$cmPlugin = Join-Path $cmRepository 'dist/src/harness/plugin.js'
$cmModels = Join-Path $cmRepository '.artifacts/cm-embedding-models'
foreach ($cmRequired in @($cmHarness, $cmPlugin)) {
    if (-not (Test-Path -LiteralPath $cmRequired -PathType Leaf)) { throw "Required local installation is missing: $cmRequired" }
}
if (-not (Test-Path -LiteralPath $cmModels -PathType Container)) { throw "The local embedding model cache is missing: $cmModels" }

$cmHasher = [Security.Cryptography.SHA256]::Create()
try {
    $cmRootHash = -join ($cmHasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($cmProject)) | ForEach-Object { $_.ToString('x2') })
    $cmIdentity = -join ($cmHasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($cmProject + '|' + $SourceScope)) | ForEach-Object { $_.ToString('x2') })
}
finally { $cmHasher.Dispose() }
$cmHome = Join-Path $cmRepository ('.artifacts/user-harness/' + $cmIdentity.Substring(0, 12))
$cmMemory = Join-Path $cmRepository ('.artifacts/user-memory/' + $cmIdentity.Substring(0, 12))
$cmPatch = Join-Path $cmHome 'cm.patch.json'
$null = New-Item -ItemType Directory -Path $cmHome -Force
$cmConfig = [ordered]@{
    projectRoot = $cmProject
    mode = 'compact'
    autoContext = $true
    autoUpdate = $true
    backgroundUpdate = $false
    retrievalPolicy = 'adaptive'
    searchMode = 'exact'
    modelCache = $cmModels
    memoryDirectory = $cmMemory
    maxContextBytes = 6000
}
if ($SourceScope) { $cmConfig.sourceScope = $SourceScope.Replace('\', '/').TrimEnd('/') }
$cmSeedDirectory = Join-Path $cmRepository '.artifacts/live-atlas'
$cmSeedPointer = Join-Path $cmSeedDirectory 'current.json'
if (Test-Path -LiteralPath $cmSeedPointer -PathType Leaf) {
    try {
        $cmSeed = Get-Content -LiteralPath $cmSeedPointer -Raw | ConvertFrom-Json
        if ($cmSeed.format -eq 'cm-live-1' -and $cmSeed.root_hash -eq $cmRootHash -and
            $cmSeed.chunking -eq 'unit' -and $cmSeed.generation -match '^[0-9a-f]{16}$') {
            $cmBase = Join-Path $cmSeedDirectory ('generations/' + $cmSeed.generation)
            $cmSeedIndex = Join-Path $cmBase 'index.json'
            $cmSeedVectors = Join-Path $cmBase 'vectors'
            if ((Test-Path -LiteralPath $cmSeedIndex -PathType Leaf) -and (Test-Path -LiteralPath $cmSeedVectors -PathType Container)) {
                $cmConfig.indexPath = $cmSeedIndex
                $cmConfig.vectorsPath = $cmSeedVectors
            }
        }
    } catch { Write-Verbose 'No usable local Atlas seed was found; CM will build its own index.' }
}
$cmEntries = @(
    @{ id = 'session-title-llm'; disabled = $true },
    @{ id = 'llm-pi-ai'; config = @{ providers = @{ 'cm-user-openai' = @{
        apiKeyEnv = 'CM_AB_API_KEY'; api = 'openai-responses'; baseURL = 'https://api.openai.com/v1'; cacheRetention = 'none'
        models = @(@{ id = $Model; name = $Model; contextWindow = 1050000; maxTokens = 8192; input = @('text'); reasoningEfforts = @{ low = 'low' } })
    } } } },
    @{ id = 'agent-default-model'; config = @{ provider = 'cm-user-openai'; model = $Model; reasoningEffort = 'low' } },
    @{ insert = @(@{ id = 'code-memory'; name = ([Uri]$cmPlugin).AbsoluteUri; config = $cmConfig }) }
)
[IO.File]::WriteAllText($cmPatch, ($cmEntries | ConvertTo-Json -Depth 16), [Text.UTF8Encoding]::new($false))
if ($PrepareOnly) {
    [pscustomobject]@{ Node = $cmNode; Harness = $cmHarness; Home = $cmHome; Patch = $cmPatch; Project = $cmProject; Memory = $cmMemory }
    return
}

$cmSavedHome = $env:DSH_HOME
$cmSavedPath = $env:PATH
$cmSavedKey = $env:CM_AB_API_KEY
$cmSavedPermission = $env:DSH_PERMISSION_MODE
try {
    $env:DSH_HOME = $cmHome
    $env:PATH = (Split-Path -Parent $cmNode) + ';' + $env:PATH
    $env:DSH_PERMISSION_MODE = 'workspace-write'
    if (-not $env:CM_AB_API_KEY -and $env:OPENAI_API_KEY) { $env:CM_AB_API_KEY = $env:OPENAI_API_KEY }
    if (-not $env:CM_AB_API_KEY) { Write-Warning 'Set $env:CM_AB_API_KEY = Get-Clipboard in this terminal before asking the model to work.' }
    Write-Host "Code Memory + DeepSeek Harness | $cmProject | $Model"
    Write-Host 'Open the authenticated dsh web URL printed below. Stop the server with Ctrl+C.'
    $cmArguments = @($cmHarness, '--profile', 'web', '--patch', $cmPatch, '--port', [string]$Port)
    if ($NoOpen) { $cmArguments += '--no-open' }
    Push-Location -LiteralPath $cmProject
    try {
        & $cmNode @cmArguments
        if ($LASTEXITCODE -ne 0) { throw "Harness exited with code $LASTEXITCODE." }
    } finally { Pop-Location }
} finally {
    $env:DSH_HOME = $cmSavedHome
    $env:PATH = $cmSavedPath
    $env:CM_AB_API_KEY = $cmSavedKey
    $env:DSH_PERMISSION_MODE = $cmSavedPermission
}
