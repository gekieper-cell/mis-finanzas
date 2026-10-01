# =====================================================================
#  deploy.ps1 - Sube Mis Finanzas a GitHub y Vercel en un solo paso
#
#  Uso (desde esta carpeta):
#     powershell -ExecutionPolicy Bypass -File .\deploy.ps1
#
#  Pide UNA sola vez la clave anon/publishable de Supabase (oculta),
#  la valida, carga las variables en Vercel sin prompts y despliega.
#  La clave no queda en el historial ni en el repo.
# =====================================================================

$ErrorActionPreference = "Continue"   # PS 5.1: con "Stop", el stderr de git/vercel corta el script
Set-Location $PSScriptRoot

$SUPABASE_URL = "https://cfsysumtjsdofjcvocho.supabase.co"
$SUPABASE_REF = "cfsysumtjsdofjcvocho"
$VERCEL       = "vercel.cmd"          # .cmd evita el bloqueo de ExecutionPolicy sobre vercel.ps1
$TARGETS      = @("production", "development")

function Paso($n, $t) { Write-Host "`n==== $n  $t ====" -ForegroundColor Cyan }
function Ok($t)    { Write-Host "  [OK] $t" -ForegroundColor Green }
function Info($t)  { Write-Host "  $t" -ForegroundColor Gray }
function Aviso($t) { Write-Host "  [!] $t" -ForegroundColor Yellow }
function Falla($t) { Write-Host "  [ERROR] $t" -ForegroundColor Red; exit 1 }

# ---------------------------------------------------------------------
Paso "1/6" "Requisitos"
foreach ($c in "git", "node", "npm.cmd") {
  if (-not (Get-Command $c -ErrorAction SilentlyContinue)) { Falla "Falta '$c' en el PATH" }
}
if (-not (Get-Command $VERCEL -ErrorAction SilentlyContinue)) {
  Info "Instalando Vercel CLI..."
  & npm.cmd install -g vercel
  if ($LASTEXITCODE -ne 0) { Falla "No se pudo instalar Vercel CLI" }
}
Ok "git, node, npm y Vercel CLI disponibles"

# ---------------------------------------------------------------------
Paso "2/6" "Clave de Supabase"
Write-Host "  Copia la clave ANON o PUBLISHABLE desde:" -ForegroundColor Yellow
Write-Host "  https://supabase.com/dashboard/project/$SUPABASE_REF/settings/api-keys" -ForegroundColor White
Write-Host "  (NUNCA la service_role / secret). Pegala con clic derecho y Enter; no se va a ver." -ForegroundColor Yellow
$sec  = Read-Host "  Clave" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
$KEY  = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr).Trim()
[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)

if (-not $KEY) { Falla "La clave esta vacia" }
if ($KEY -like "sb_secret_*") { Falla "Esa es una clave SECRET. Usa la publishable (sb_publishable_...) o la anon." }
if ($KEY -like "eyJ*") {
  try {
    $p = $KEY.Split(".")[1].Replace("-", "+").Replace("_", "/")
    $p = $p.PadRight($p.Length + (4 - $p.Length % 4) % 4, "=")
    $claims = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($p)) | ConvertFrom-Json
  } catch { Falla "La clave no parece un JWT valido" }
  if ($claims.role -eq "service_role") { Falla "Esa es la service_role. Usa la clave ANON." }
  if ($claims.role -ne "anon")         { Falla "Rol inesperado en la clave: $($claims.role)" }
  if ($claims.ref -and $claims.ref -ne $SUPABASE_REF) { Falla "La clave es de otro proyecto ($($claims.ref))" }
  Ok "Clave anon valida para el proyecto $SUPABASE_REF"
} elseif ($KEY -like "sb_publishable_*") {
  Ok "Clave publishable"
} else {
  Falla "Formato de clave desconocido. Debe empezar con 'eyJ' (anon) o 'sb_publishable_'."
}

# Prueba real contra Supabase: la clave tiene que ser aceptada
try {
  $h = @{ apikey = $KEY }
  if ($KEY -like "eyJ*") { $h.Authorization = "Bearer $KEY" }
  Invoke-RestMethod "$SUPABASE_URL/auth/v1/settings" -Headers $h -TimeoutSec 20 | Out-Null
  Ok "Supabase acepta la clave"
} catch { Falla "Supabase rechazo la clave: $($_.Exception.Message)" }

# ---------------------------------------------------------------------
Paso "3/6" "GitHub"
git add -A
if (git status --porcelain) { git commit -m "Actualizacion $(Get-Date -Format 'yyyy-MM-dd HH:mm')" | Out-Null }
git push -u origin main
if ($LASTEXITCODE -ne 0) { Falla "git push fallo" }
Ok "Codigo en GitHub"

# ---------------------------------------------------------------------
Paso "4/6" "Vercel: sesion y proyecto"
& $VERCEL whoami *> $null
if ($LASTEXITCODE -ne 0) {
  Info "Inicia sesion (elegi 'Continue with GitHub')..."
  & $VERCEL login
  if ($LASTEXITCODE -ne 0) { Falla "Login de Vercel fallo" }
}
if (-not (Test-Path ".vercel\project.json")) {
  & $VERCEL link --yes
  if ($LASTEXITCODE -ne 0) { Falla "vercel link fallo" }
}
Ok "Proyecto vinculado"

# ---------------------------------------------------------------------
Paso "5/6" "Vercel: variables de entorno"
$tmp = [IO.Path]::GetTempFileName()
try {
  $vars = [ordered]@{ "NEXT_PUBLIC_SUPABASE_URL" = $SUPABASE_URL; "NEXT_PUBLIC_SUPABASE_ANON_KEY" = $KEY }
  foreach ($name in $vars.Keys) {
    # Sin salto de linea final: el valor queda exacto
    [IO.File]::WriteAllText($tmp, $vars[$name], (New-Object Text.UTF8Encoding $false))
    foreach ($t in $TARGETS) {
      cmd /c "$VERCEL env rm $name $t --yes >nul 2>&1"
      cmd /c "$VERCEL env add $name $t < `"$tmp`""
      if ($LASTEXITCODE -ne 0) { Falla "No se pudo cargar $name ($t)" }
      Ok "$name -> $t"
    }
  }
} finally {
  Remove-Item $tmp -Force -ErrorAction SilentlyContinue
  $KEY = $null
}

# ---------------------------------------------------------------------
Paso "6/6" "Deploy a produccion"
Info "Compilando en Vercel (1-2 minutos)..."
$deployUrl = (& $VERCEL deploy --prod --yes) | Select-Object -Last 1
if ($LASTEXITCODE -ne 0 -or $deployUrl -notmatch "^https://") { Falla "El deploy fallo. Revisa vercel.com > mis-finanzas > Deployments > Build Logs" }
$inspect = (& $VERCEL inspect $deployUrl 2>&1 | Out-String)
$aliases = @([regex]::Matches($inspect, "https://[a-z0-9-]+\.vercel\.app") | ForEach-Object { $_.Value } | Select-Object -Unique | Sort-Object Length)
$prodUrl = if ($aliases.Count -gt 0) { $aliases[0] } else { $deployUrl }
Ok "Publicado: $prodUrl"

try {
  $r = Invoke-WebRequest "$prodUrl/login" -UseBasicParsing -TimeoutSec 30
  if ($r.StatusCode -eq 200) { Ok "/login responde 200" }
  if ($r.Headers["Content-Security-Policy"] -match [regex]::Escape($SUPABASE_URL)) { Ok "La app apunta a tu Supabase" }
  else { Aviso "La CSP no incluye tu URL de Supabase: revisa las variables y volve a correr el script" }
} catch {
  Aviso "No pude verificar automaticamente ($($_.Exception.Message)). Probala en el navegador."
}

Write-Host ""
Write-Host "Ultimo paso manual (una sola vez):" -ForegroundColor Cyan
Write-Host "  Supabase > Authentication > URL Configuration > Site URL = $prodUrl"
Start-Process "https://supabase.com/dashboard/project/$SUPABASE_REF/auth/url-configuration"
Start-Process $prodUrl
Write-Host "`nListo. Desde ahora, cada 'git push' redeploya solo." -ForegroundColor Green
