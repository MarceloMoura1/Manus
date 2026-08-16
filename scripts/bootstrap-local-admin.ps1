param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[^\s@]+@[^\s@]+\.[^\s@]+$')]
  [string]$AdminEmail,
  [string]$AdminName = 'Administrador'
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $projectRoot '.env.local'
if (-not (Test-Path -LiteralPath $envFile)) { throw '.env.local not found.' }
$loadedNames = [System.Collections.Generic.List[string]]::new()
foreach ($line in Get-Content -LiteralPath $envFile) {
  if ($line -match '^\s*(#|$)') { continue }
  $parts = $line -split '=', 2
  if ($parts.Count -ne 2) { throw 'Invalid .env.local entry.' }
  [Environment]::SetEnvironmentVariable($parts[0], $parts[1], 'Process')
  $loadedNames.Add($parts[0])
}
$securePassword = Read-Host 'MegaAdmin password' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
try {
  $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  $env:ADMIN_EMAIL = $AdminEmail
  $env:ADMIN_NAME = $AdminName
  $env:ADMIN_PASSWORD = $plainPassword
  & node (Join-Path $projectRoot 'seed-admin.mjs')
  if ($LASTEXITCODE -ne 0) { throw 'MegaAdmin bootstrap failed.' }
} finally {
  Remove-Item Env:ADMIN_PASSWORD, Env:ADMIN_EMAIL, Env:ADMIN_NAME -ErrorAction SilentlyContinue
  foreach ($name in $loadedNames) { [Environment]::SetEnvironmentVariable($name, $null, 'Process') }
  if ($bstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  $plainPassword = $null
  $securePassword.Dispose()
}
