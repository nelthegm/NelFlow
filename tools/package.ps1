$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$distDirectory = Join-Path $projectRoot "dist"
$stageDirectory = Join-Path $distDirectory "package-staging"
$archivePath = Join-Path $distDirectory "nelflow.zip"

if (-not $distDirectory.StartsWith($projectRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Resolved dist path is outside the project root."
}

New-Item -ItemType Directory -Force -Path $distDirectory | Out-Null
if (Test-Path -LiteralPath $stageDirectory) {
  $resolvedStage = (Resolve-Path -LiteralPath $stageDirectory).Path
  if (-not $resolvedStage.StartsWith($distDirectory, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Resolved staging path is outside dist."
  }
  Remove-Item -LiteralPath $resolvedStage -Recurse -Force
}
New-Item -ItemType Directory -Path $stageDirectory | Out-Null

Copy-Item -LiteralPath (Join-Path $projectRoot "module.json") -Destination $stageDirectory
Copy-Item -LiteralPath (Join-Path $projectRoot "README.md") -Destination $stageDirectory
foreach ($directory in @("scripts", "styles", "lang", "docs")) {
  Copy-Item -LiteralPath (Join-Path $projectRoot $directory) -Destination $stageDirectory -Recurse
}

if (Test-Path -LiteralPath $archivePath) {
  Remove-Item -LiteralPath $archivePath -Force
}
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$outputArchive = [System.IO.Compression.ZipFile]::Open(
  $archivePath,
  [System.IO.Compression.ZipArchiveMode]::Create
)
try {
  foreach ($file in Get-ChildItem -LiteralPath $stageDirectory -Recurse -File) {
    $relativePath = $file.FullName.Substring($stageDirectory.Length).TrimStart(
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

$archive = [System.IO.Compression.ZipFile]::OpenRead($archivePath)
try {
  $entries = @($archive.Entries | ForEach-Object { $_.FullName.Replace("\", "/") })
  if ($entries -notcontains "module.json") {
    throw "Packaged archive does not contain module.json at its root."
  }
  if ($archive.Entries | Where-Object { $_.FullName.Contains("\") -or $_.FullName.StartsWith("/") }) {
    throw "Packaged archive contains a non-portable entry path."
  }
  $forbidden = @($entries | Where-Object {
    $_ -match '(^|/)(?:\.git|dist|tools|node_modules|__pycache__)(/|$)' -or
    $_ -match '\.(?:zip|pyc)$'
  })
  if ($forbidden.Count -gt 0) {
    throw "Packaged archive contains forbidden entries: $($forbidden -join ', ')"
  }
  Write-Output "Created $archivePath"
  Write-Output "Verified $($entries.Count) archive entries; module.json is at the ZIP root."
}
finally {
  $archive.Dispose()
  if (Test-Path -LiteralPath $stageDirectory) {
    Remove-Item -LiteralPath $stageDirectory -Recurse -Force
  }
}
