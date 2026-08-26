[CmdletBinding()]
param()

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$desktop = [Environment]::GetFolderPath('Desktop')
$powershell = Join-Path $PSHOME 'powershell.exe'
$shell = New-Object -ComObject WScript.Shell

$shortcuts = @(
  @{ Name = 'Iniciar MegaDesk.lnk'; Script = 'Iniciar-MegaDesk.ps1'; Description = 'Iniciar MegaDesk com MySQL e Cloudflare Tunnel' },
  @{ Name = 'Atualizar MegaDesk.lnk'; Script = 'Atualizar-MegaDesk.ps1'; Description = 'Validar, compilar e atualizar MegaDesk localmente' },
  @{ Name = 'Parar MegaDesk.lnk'; Script = 'Parar-MegaDesk.ps1'; Description = 'Parar somente processos controlados do MegaDesk' }
)

foreach ($item in $shortcuts) {
  $scriptPath = Join-Path $PSScriptRoot $item.Script
  if (-not (Test-Path -LiteralPath $scriptPath -PathType Leaf)) { throw "Script ausente: $($item.Script)" }
  $shortcut = $shell.CreateShortcut((Join-Path $desktop $item.Name))
  $shortcut.TargetPath = $powershell
  $shortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -File "{0}"' -f $scriptPath
  $shortcut.WorkingDirectory = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
  $shortcut.Description = $item.Description
  $shortcut.Save()
}

Write-Host 'Atalhos Iniciar, Atualizar e Parar MegaDesk criados na Area de Trabalho.'
Write-Host 'Nenhum auto-start, servico ou tarefa agendada foi configurado.'
