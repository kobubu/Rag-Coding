# Install Code Memory on Windows

This guide covers the **v0.9.1 Windows release**, an unofficial community integration. It installs the native DeepSeek Harness plugin. Optional Codex/Claude connections use MCP; their automatic-context hooks are configured separately.

## Download and verify

If Harness 0.2.0-rc.2 is already installed, you can use `dsh plugin --profile web add github:kobubu/Rag-Coding#v0.9.1`, then prepare the index/model as described in the [Harness reference](DEEPSEEK-PLUGIN.md#github-installation). The Git tag includes the ready runtime. This ZIP additionally installs Harness and generates launchers.

Download `CM-0.9.1-Windows.zip` and `SHA256SUMS.txt` from [GitHub Releases](https://github.com/kobubu/Rag-Coding/releases/tag/v0.9.1). Keep both files in the same directory.

```powershell
$expected = ((Get-Content .\SHA256SUMS.txt | Where-Object { $_ -match '  CM-0\.9\.1-Windows\.zip$' }) -split '\s+')[0]
if (-not $expected) { throw 'ZIP checksum is missing.' }
$actual = (Get-FileHash .\CM-0.9.1-Windows.zip -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actual -ne $expected) { throw 'ZIP checksum mismatch.' }
Expand-Archive -LiteralPath .\CM-0.9.1-Windows.zip -DestinationPath .\CM-0.9.1
Set-Location .\CM-0.9.1
```

The ZIP contains the PowerShell bootstrap, the built npm tarball, this guide, a release manifest, and checksums. It contains no source-project index, embedding weights, API keys, or model credits. Dependencies and pinned model weights are downloaded on first install. A compatible installed Node.js is reused; otherwise the bootstrap downloads a private Node.js runtime and checks its official archive checksum.

## Install for a project

Replace the example project path with an existing repository directory:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install_cm.ps1 -ProjectRoot 'C:\path\to\your-project' -Clients harness
```

Windows PowerShell 5.1 is supported. No administrator account is required. The default install directory is `%LOCALAPPDATA%\CodeMemory`. First-time installation and indexing can take several minutes. The installer does not run the indexed project's code.

Useful options:

| Option | Purpose |
|---|---|
| `-InstallRoot 'D:\CodeMemory'` | Choose a local runtime and data directory |
| `-SourceScope src` | Restrict the corpus to a project subdirectory |
| `-Clients harness,codex,claude` | Configure all three project integrations |
| `-ClaudeScope project` | Use a shared `.mcp.json` instead of personal Claude project settings |
| `-SkipIndex` | Delay indexing until the first indexed query; model setup still runs |
| `-HarnessModel MODEL_ID` | Select the optional OpenAI-compatible model configuration; otherwise keep Harness defaults |

Harness **0.2.0-rc.2** is pinned for this release. Other Harness versions have not been validated by this release's installer checks. Codex and Claude Code are separate products and must already be installed if selected. Normal client project/MCP trust prompts still apply. Automatic context in Codex/Claude needs the [manual hook configuration](NATIVE-CLIENTS.md); selecting those clients does not install the hook.

## Launch and verify

Setup prints JSON containing `directory`, plus an exact `Doctor:` command. In that generated project directory, run `start-harness.ps1`. Configure your provider/model using Harness's normal settings and use its printed local web URL. The installer stores no API-key value. If you select `-HarnessModel`, its OpenAI configuration reads `OPENAI_API_KEY` from the launch environment.

Run the exact `Doctor:` command printed by setup. A healthy result reports a working MCP connection, the selected project root, and a ready index. This confirms installation and retrieval readiness; a live task is needed to measure model savings.

The generated `start-codex.ps1` and `start-claude.ps1` launch those clients in your project. Restart clients after changing their MCP configuration.

Source, vectors, and graph stay local. A cloud model provider still receives the code selected for its context. Large repositories beyond the current 500-file/8-MiB source limits need a smaller `-SourceScope`.

## Remove a project connection

Use the same Node executable and `cm-setup` CLI paths shown by setup, changing the action from `doctor` to `remove`:

```powershell
# Replace both executable paths and directory arguments with your setup output.
& 'C:\CM\runtime\node.exe' 'C:\CM\releases\HASH\node_modules\dsh-plugin-code-memory\dist\src\setup\cli.js' remove --root 'C:\CM' --project 'C:\path\to\your-project'
```

Removal disconnects managed project settings and unchanged generated skills. Installed packages, model weights, and knowledge files are retained. Existing unrelated settings are preserved; modified managed settings can cause a conflict that needs review. There is no automatic release rollback or cross-platform bootstrap in this release.

[README](../README.md) · [Russian setup reference](INSTALL.md)
