<#
.SYNOPSIS
  Exports the SKPass database (schema, public data, staff accounts) and the photo bucket.

.DESCRIPTION
  See docs/backup-plan.md. Output goes to .\backups\<UTC timestamp>\ which is git-ignored.
  The output contains PERSONAL DATA and PASSWORD HASHES: encrypt it and move it off-site; never
  commit it.

  Needs SUPABASE_DB_URL (Dashboard -> Project Settings -> Database -> Connection string) and either
  `pg_dump` on PATH or Docker (used by `supabase db dump`).

.PARAMETER DryRun
  Print what would run without connecting to anything.
#>
[CmdletBinding()]
param([switch]$DryRun)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

$stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMdd-HHmmss")
$out = Join-Path $repo "backups\$stamp"
$url = $env:SUPABASE_DB_URL

if (-not $DryRun -and [string]::IsNullOrWhiteSpace($url)) {
  throw "Set SUPABASE_DB_URL first (see docs/backup-plan.md)."
}

# Never print the password.
function Hide-Secret([string]$s) { return ($s -replace '(postgres(?:ql)?://[^:]+:)[^@]+@', '$1****@') }

$havePgDump = [bool](Get-Command pg_dump -ErrorAction SilentlyContinue)
$tool = if ($havePgDump) { "pg_dump" } else { "supabase db dump (needs Docker)" }

$steps = @(
  @{ File = "schema.sql";      Desc = "schema (all app schemas)";               Pg = @("--schema-only", "--schema=public");            Sb = @("--schema", "public") },
  @{ File = "data-public.sql"; Desc = "data: public schema";                    Pg = @("--data-only", "--schema=public", "--inserts");  Sb = @("--data-only", "--schema", "public", "--use-copy") },
  @{ File = "data-auth.sql";   Desc = "data: staff accounts (auth schema)";     Pg = @("--data-only", "--schema=auth", "--inserts");    Sb = @("--data-only", "--schema", "auth", "--use-copy") }
)

Write-Host "Backup -> $out"
Write-Host "Using: $tool"
if ($DryRun) { Write-Host "(dry run: nothing will be executed)" -ForegroundColor Yellow }
if (-not $DryRun) { New-Item -ItemType Directory -Force -Path $out | Out-Null }

foreach ($s in $steps) {
  $target = Join-Path $out $s.File
  if ($havePgDump) {
    $args = @($s.Pg) + @("--no-owner", "--no-privileges", "--file=$target", $url)
    Write-Host ("  pg_dump " + (Hide-Secret ($args -join ' ')))
    if (-not $DryRun) { & pg_dump @args; if ($LASTEXITCODE -ne 0) { throw "pg_dump failed for $($s.File)" } }
  } else {
    $args = @("supabase", "db", "dump", "--db-url", $url) + @($s.Sb) + @("-f", $target)
    Write-Host ("  npx " + (Hide-Secret ($args -join ' ')))
    if (-not $DryRun) { & npx @args; if ($LASTEXITCODE -ne 0) { throw "supabase db dump failed for $($s.File)" } }
  }
}

# Photos (private bucket). Uses the logged-in CLI; see docs/backup-plan.md.
$photos = Join-Path $out "photos"
Write-Host "  npx supabase storage cp -r ss:///vehicle-photos $photos --linked --experimental"
if (-not $DryRun) {
  New-Item -ItemType Directory -Force -Path $photos | Out-Null
  & npx supabase storage cp -r "ss:///vehicle-photos" $photos --linked --experimental
  if ($LASTEXITCODE -ne 0) { Write-Warning "Photo download failed or the bucket is empty. Check manually." }
}

if (-not $DryRun) {
  $sums = Get-ChildItem $out -Recurse -File | Where-Object { $_.Name -ne "SHA256SUMS.txt" } | ForEach-Object {
    $h = (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLower()
    "$h  " + $_.FullName.Substring($out.Length + 1)
  }
  Set-Content -Path (Join-Path $out "SHA256SUMS.txt") -Value $sums -Encoding utf8
  $bad = Get-ChildItem $out -Filter *.sql | Where-Object { $_.Length -lt 100 }
  if ($bad) { Write-Warning ("Suspiciously small file(s): " + ($bad.Name -join ", ")) }
  Write-Host "Done. NEXT: encrypt $out, copy it off-site, delete local copies. Never commit it." -ForegroundColor Green
} else {
  Write-Host "Dry run complete." -ForegroundColor Yellow
}
