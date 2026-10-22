#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Restablece la contraseña de 'root'@'localhost' de un servicio MySQL de Windows SIN perder datos.

.DESCRIPTION
  Usa el método oficial --init-file: detiene el servicio, arranca mysqld una sola vez ejecutando un
  ALTER USER, lo apaga limpiamente, borra el fichero temporal y vuelve a iniciar el servicio.
  Pide la contraseña nueva de forma oculta (no queda en el historial ni en ningún fichero versionado).

.EXAMPLE
  # En una consola de PowerShell abierta COMO ADMINISTRADOR:
  Set-ExecutionPolicy -Scope Process Bypass
  .\scripts\dev\reset-mysql-root.ps1
#>
param(
  [string]$ServiceName = "MySQL84"
)

$ErrorActionPreference = "Stop"

# 1) Localiza mysqld y su my.ini a partir de la definición real del servicio.
$svc = Get-CimInstance Win32_Service -Filter "Name='$ServiceName'"
if (-not $svc) { throw "No existe el servicio '$ServiceName'." }
if ($svc.PathName -notmatch '^"(?<exe>[^"]+mysqld\.exe)"\s+--defaults-file="(?<cfg>[^"]+)"') {
  throw "No pude interpretar la línea de comandos del servicio: $($svc.PathName)"
}
$mysqld = $Matches.exe
$cfg = $Matches.cfg
$binDir = Split-Path $mysqld
$mysqladmin = Join-Path $binDir "mysqladmin.exe"
$mysql = Join-Path $binDir "mysql.exe"
foreach ($p in @($mysqld, $cfg, $mysqladmin, $mysql)) { if (-not (Test-Path $p)) { throw "No existe: $p" } }

# 2) Pide la contraseña nueva (oculta) y la confirma.
function ConvertTo-Plain([System.Security.SecureString]$s) {
  $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
  try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
}
$pw1 = ConvertTo-Plain (Read-Host "Nueva contraseña para root (mínimo 12 caracteres)" -AsSecureString)
$pw2 = ConvertTo-Plain (Read-Host "Repite la contraseña" -AsSecureString)
if ($pw1 -ne $pw2) { throw "Las contraseñas no coinciden. No se ha cambiado nada." }
if ($pw1.Length -lt 12) { throw "La contraseña debe tener al menos 12 caracteres. No se ha cambiado nada." }

# Escapa para un literal SQL entre comillas simples.
$sqlPw = $pw1.Replace('\', '\\').Replace("'", "''")

$initFile = Join-Path $env:TEMP ("mysql-init-" + [guid]::NewGuid().ToString("N") + ".sql")
$errLog = Join-Path $env:TEMP ("mysql-reset-" + [guid]::NewGuid().ToString("N") + ".log")
$proc = $null

try {
  [IO.File]::WriteAllText($initFile, "ALTER USER 'root'@'localhost' IDENTIFIED BY '$sqlPw';`n", (New-Object Text.UTF8Encoding($false)))

  Write-Host "Deteniendo el servicio $ServiceName..."
  Stop-Service $ServiceName -Force
  (Get-Service $ServiceName).WaitForStatus("Stopped", [TimeSpan]::FromSeconds(60))

  Write-Host "Arrancando MySQL una vez para aplicar el cambio..."
  $initArg = $initFile.Replace('\', '/')
  $proc = Start-Process -FilePath $mysqld -PassThru -WindowStyle Hidden -RedirectStandardError $errLog `
    -ArgumentList "--defaults-file=`"$cfg`"", "--init-file=`"$initArg`"", "--console"

  $ready = $false
  for ($i = 0; $i -lt 90; $i++) {
    Start-Sleep -Seconds 1
    if ($proc.HasExited) { break }
    if ((Test-Path $errLog) -and (Select-String -Path $errLog -Pattern "ready for connections" -Quiet)) { $ready = $true; break }
  }
  if (-not $ready) {
    $tail = if (Test-Path $errLog) { (Get-Content $errLog -Tail 15) -join "`n" } else { "(sin registro)" }
    throw "MySQL no llegó a estar listo. Últimas líneas del registro:`n$tail"
  }
  if (Select-String -Path $errLog -Pattern "init-file|ALTER USER" -Quiet) {
    $bad = Select-String -Path $errLog -Pattern "\[ERROR\].*(init|ALTER)" | Select-Object -First 3
    if ($bad) { throw "El ALTER USER falló:`n$($bad -join "`n")" }
  }

  # Apagado limpio con la contraseña nueva (por variable de entorno, no por línea de comandos).
  $env:MYSQL_PWD = $pw1
  & $mysqladmin --defaults-file="$cfg" --user=root shutdown
  if (-not $proc.WaitForExit(60000)) { throw "mysqld no se apagó a tiempo." }
  Write-Host "Cambio aplicado." -ForegroundColor Green
}
finally {
  Remove-Item $initFile -Force -ErrorAction SilentlyContinue
  Remove-Item $errLog -Force -ErrorAction SilentlyContinue
  if ($proc -and -not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
  Write-Host "Reiniciando el servicio $ServiceName..."
  Start-Service $ServiceName
  (Get-Service $ServiceName).WaitForStatus("Running", [TimeSpan]::FromSeconds(60))
}

# 3) Verificación: iniciar sesión con la contraseña nueva.
try {
  $env:MYSQL_PWD = $pw1
  Start-Sleep -Seconds 3
  $r = & $mysql --defaults-file="$cfg" --user=root --batch --skip-column-names -e "SELECT 'login correcto como', CURRENT_USER();"
  Write-Host $r -ForegroundColor Green
}
finally {
  Remove-Item Env:\MYSQL_PWD -ErrorAction SilentlyContinue
  $pw1 = $null; $pw2 = $null; $sqlPw = $null
}
