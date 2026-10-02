# =====================================================================
#  subir.ps1 - Sube los cambios de Mis Finanzas a GitHub.
#  Vercel los despliega solo (el repo ya esta conectado).
#
#  Uso:
#     powershell -ExecutionPolicy Bypass -File .\subir.ps1
#     powershell -ExecutionPolicy Bypass -File .\subir.ps1 "mensaje del cambio"
# =====================================================================
param([string]$Mensaje = "")

$ErrorActionPreference = "Continue"
Set-Location $PSScriptRoot
$APP_URL = "https://mis-finanzas-six-gamma.vercel.app"

function Ok($t)    { Write-Host "  [OK] $t" -ForegroundColor Green }
function Info($t)  { Write-Host "  $t" -ForegroundColor Gray }
function Falla($t) { Write-Host "  [ERROR] $t" -ForegroundColor Red; exit 1 }

Write-Host "`n==== Subiendo cambios ====" -ForegroundColor Cyan

# 1. Lock de git trabado (si quedo de un proceso anterior)
if (Test-Path ".git\index.lock") {
  $gitRunning = Get-Process git -ErrorAction SilentlyContinue
  if ($gitRunning) { Falla "Hay un git corriendo. Cerralo y volve a ejecutar." }
  Remove-Item ".git\index.lock" -Force
  Ok "Borrado .git\index.lock trabado"
}

# 2. Seguridad: que no se cuele ningun archivo de claves
$tracked = git ls-files
$peligrosos = $tracked | Where-Object { $_ -match '(^|/)\.env($|\.local|\.production)' -or $_ -match '^\.vercel/' }
if ($peligrosos) { Falla "Archivos sensibles versionados: $($peligrosos -join ', '). No subo nada." }

# 3. Cambios
git add -A
$cambios = git status --porcelain
if (-not $cambios) {
  Ok "No hay cambios para subir"
} else {
  Info "Archivos a subir:"
  $cambios | ForEach-Object { Info "   $_" }
  $sens = git diff --cached --name-only | Where-Object { $_ -match '\.env' -and $_ -ne '.env.example' }
  if ($sens) { git reset -q; Falla "Se iba a subir $($sens -join ', '). Cancelado." }
  if (-not $Mensaje) { $Mensaje = "Actualizacion $(Get-Date -Format 'yyyy-MM-dd HH:mm')" }
  git commit -q -m $Mensaje
  if ($LASTEXITCODE -ne 0) { Falla "git commit fallo" }
  Ok "Commit: $Mensaje"
}

# Deploy actual (para detectar el nuevo despues del push)
$hayVercel = [bool](Get-Command vercel.cmd -ErrorAction SilentlyContinue)
function PrimerDeploy {
  $out = (& vercel.cmd ls 2>&1 | Out-String)
  return ($out -split "`n" | Where-Object { $_ -match "https://\S+\.vercel\.app" } | Select-Object -First 1)
}
$antes = if ($hayVercel) { PrimerDeploy } else { $null }
$urlAntes = if ($antes -match "(https://\S+\.vercel\.app)") { $Matches[1] } else { "" }

# 4. Push
git push -u origin main
if ($LASTEXITCODE -ne 0) { Falla "git push fallo (revisa conexion o login de GitHub)" }
Ok "Subido a GitHub"

# 5. Esperar el deploy nuevo de Vercel
if ($hayVercel -and $cambios) {
  Info "Esperando que Vercel compile el deploy nuevo (hasta 5 min)..."
  $estado = "desconocido"
  for ($i = 1; $i -le 30; $i++) {
    Start-Sleep -Seconds 10
    $fila = PrimerDeploy
    if (-not $fila) { continue }
    $url = if ($fila -match "(https://\S+\.vercel\.app)") { $Matches[1] } else { "" }
    if ($url -eq $urlAntes) { Info "   ...esperando que aparezca ($($i * 10) s)"; continue }
    if ($fila -match "Ready")           { $estado = "ok"; break }
    if ($fila -match "Error|Canceled")  { $estado = "error"; break }
    Info "   ...compilando ($($i * 10) s)"
  }
  switch ($estado) {
    "ok"    { Ok "Deploy listo" }
    "error" { Falla "El deploy fallo. Mira vercel.com > mis-finanzas > Deployments > Build Logs" }
    default { Info "Sigue en proceso; revisalo en vercel.com en un rato." }
  }
} else {
  Info "Vercel lo despliega solo en 1-2 minutos."
}

Write-Host "`nListo: $APP_URL" -ForegroundColor Green
Start-Process $APP_URL
