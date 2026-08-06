$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$distDirectory = Join-Path $projectRoot "dist"
$stageRoot = Join-Path $distDirectory "stage"
$stageModule = Join-Path $stageRoot "nelflow"
$manifestPath = Join-Path $projectRoot "module.json"

if (-not (Test-Path -LiteralPath $manifestPath)) {
  throw "module.json not found at $manifestPath"
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$version = [string]$manifest.version
if (-not $version) {
  throw "module.json is missing a version field."
}

$versionedArchive = Join-Path $distDirectory "nelflow-$version.zip"
$compatArchive = Join-Path $distDirectory "nelflow.zip"
$distManifest = Join-Path $distDirectory "module.json"
$checksumsPath = Join-Path $distDirectory "SHA256SUMS.txt"
$releaseReadme = Join-Path $distDirectory "RELEASE_README.txt"

if (-not $distDirectory.StartsWith($projectRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Resolved dist path is outside the project root."
}

New-Item -ItemType Directory -Force -Path $distDirectory | Out-Null
if (Test-Path -LiteralPath $stageRoot) {
  $resolvedStage = (Resolve-Path -LiteralPath $stageRoot).Path
  if (-not $resolvedStage.StartsWith($distDirectory, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Resolved staging path is outside dist."
  }
  Remove-Item -LiteralPath $resolvedStage -Recurse -Force
}
New-Item -ItemType Directory -Path $stageModule -Force | Out-Null

Copy-Item -LiteralPath $manifestPath -Destination $stageModule
Copy-Item -LiteralPath (Join-Path $projectRoot "README.md") -Destination $stageModule
if (Test-Path -LiteralPath (Join-Path $projectRoot "CHANGELOG.md")) {
  Copy-Item -LiteralPath (Join-Path $projectRoot "CHANGELOG.md") -Destination $stageModule
}
if (Test-Path -LiteralPath (Join-Path $projectRoot "LICENSE")) {
  Copy-Item -LiteralPath (Join-Path $projectRoot "LICENSE") -Destination $stageModule
}
foreach ($directory in @("scripts", "styles", "lang")) {
  $source = Join-Path $projectRoot $directory
  if (Test-Path -LiteralPath $source) {
    Copy-Item -LiteralPath $source -Destination $stageModule -Recurse
  }
}
$stageDocs = Join-Path $stageModule "docs"
New-Item -ItemType Directory -Path $stageDocs | Out-Null
foreach ($document in Get-ChildItem -LiteralPath (Join-Path $projectRoot "docs") -File -Filter "*.md" -ErrorAction SilentlyContinue) {
  if ($document.Name -notmatch "TEST_PLAN") {
    Copy-Item -LiteralPath $document.FullName -Destination $stageDocs
  }
}

# Validate manifest-referenced assets exist in the stage.
foreach ($entry in @($manifest.esmodules)) {
  $path = Join-Path $stageModule ([string]$entry)
  if (-not (Test-Path -LiteralPath $path)) {
    throw "Manifest esmodule missing from package stage: $entry"
  }
}
foreach ($entry in @($manifest.styles)) {
  $path = Join-Path $stageModule ([string]$entry)
  if (-not (Test-Path -LiteralPath $path)) {
    throw "Manifest style missing from package stage: $entry"
  }
}
foreach ($language in @($manifest.languages)) {
  $path = Join-Path $stageModule ([string]$language.path)
  if (-not (Test-Path -LiteralPath $path)) {
    throw "Manifest language missing from package stage: $($language.path)"
  }
}

function New-ZipFromDirectory {
  param(
    [Parameter(Mandatory = $true)][string]$SourceDirectory,
    [Parameter(Mandatory = $true)][string]$ArchivePath
  )
  if (Test-Path -LiteralPath $ArchivePath) {
    Remove-Item -LiteralPath $ArchivePath -Force
  }
  Add-Type -AssemblyName System.IO.Compression
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $outputArchive = [System.IO.Compression.ZipFile]::Open(
    $ArchivePath,
    [System.IO.Compression.ZipArchiveMode]::Create
  )
  try {
    foreach ($file in Get-ChildItem -LiteralPath $SourceDirectory -Recurse -File) {
      $relativePath = $file.FullName.Substring($SourceDirectory.Length).TrimStart(
        [char[]]@("\", "/")
      ).Replace("\", "/")
      [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
        $outputArchive,
        $file.FullName,
        $relativePath,
        [System.IO.Compression.CompressionLevel]::Optimal
      ) | Out-Null
    }
  }
  finally {
    $outputArchive.Dispose()
  }
}

function Assert-ZipRootModuleJson {
  param([Parameter(Mandatory = $true)][string]$ArchivePath)
  $archive = [System.IO.Compression.ZipFile]::OpenRead($ArchivePath)
  try {
    $entries = @($archive.Entries | ForEach-Object { $_.FullName.Replace("\", "/") })
    if ($entries -notcontains "module.json") {
      throw "Packaged archive does not contain module.json at its root: $ArchivePath"
    }
    if ($entries | Where-Object { $_ -match '^nelflow/' }) {
      throw "Packaged archive nests module files under nelflow/: $ArchivePath"
    }
    $forbidden = @($entries | Where-Object {
      $_ -match '(^|/)(?:\.git|dist|tools|tests|node_modules|__pycache__|coverage)(/|$)' -or
      $_ -match '\.(?:zip|pyc)$' -or
      $_ -match 'TEST_PLAN'
    })
    if ($forbidden.Count -gt 0) {
      throw "Packaged archive contains forbidden entries: $($forbidden -join ', ')"
    }
    return $entries
  }
  finally {
    $archive.Dispose()
  }
}

New-ZipFromDirectory -SourceDirectory $stageModule -ArchivePath $versionedArchive
$entries = Assert-ZipRootModuleJson -ArchivePath $versionedArchive
Copy-Item -LiteralPath $versionedArchive -Destination $compatArchive -Force
Copy-Item -LiteralPath $manifestPath -Destination $distManifest -Force

$hash = (Get-FileHash -LiteralPath $versionedArchive -Algorithm SHA256).Hash.ToLowerInvariant()
$size = (Get-Item -LiteralPath $versionedArchive).Length
@(
  "$hash  nelflow-$version.zip"
  "$hash  nelflow.zip"
) | Set-Content -LiteralPath $checksumsPath -Encoding ascii

$releaseNotes = @"
NelFlow $version — local release package
=====================================

Contents
--------
- nelflow-$version.zip
- nelflow.zip (same bytes)
- module.json
- SHA256SUMS.txt
- stage/nelflow/ (extracted layout used to build the ZIP)

SHA-256 ($versionedArchive)
  $hash

Archive size
  $size bytes

Top-level ZIP entries include module.json at the archive root (not nested as
nelflow/nelflow/).

Installation (clean replace — do not merge into 0.7.0)
------------------------------------------------------
1. Stop Foundry.
2. Back up or remove the existing Data/modules/nelflow folder.
3. Extract nelflow-$version.zip directly into:
   Data/modules/nelflow
4. Confirm:
   Data/modules/nelflow/module.json
5. Restart Foundry.
6. Enable NelFlow and NelCine.
7. Confirm installed versions in the console:
   game.modules.get("nelflow")?.version
   game.modules.get("nelcine")?.version
8. Initially leave:
   - Synchronize Damage with NelCine Impact = Off
   - Enable NelCine Basic-Save Batches = Off
9. Test ordinary Strike cinematics first (Enable NelCine Strike Cinematics On).
10. Enable mechanical impact synchronization only after ordinary presentation
    passes.

Do not merge these files into an older NelFlow directory.
"@
Set-Content -LiteralPath $releaseReadme -Value $releaseNotes -Encoding utf8

Write-Output "Created $versionedArchive"
Write-Output "Created $compatArchive"
Write-Output "SHA-256 $hash"
Write-Output "Size $size bytes"
Write-Output "Verified $($entries.Count) archive entries; module.json is at the ZIP root."
Write-Output "Top-level sample: $(($entries | Select-Object -First 12) -join ', ')"
