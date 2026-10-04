# =====================================================================
#  configurar-avisos.ps1 - Activa los avisos push de Mis Finanzas
#
#  Uso (desde esta carpeta, DESPUES de correr la migracion 006 en Supabase):
#     powershell -ExecutionPolicy Bypass -File .\configurar-avisos.ps1
#     powershell -ExecutionPolicy Bypass -File .\configurar-avisos.ps1 -RotarVapid
#
#  Que hace:
#   1. Genera en TU PC las claves VAPID (solo la primera vez) y un secreto HMAC nuevo.
#   2. Los carga en Vercel (sin mostrarlos en pantalla ni guardarlos en archivos del repo).
#   3. Copia al portapapeles el SQL que guarda la URL y el secreto en el Vault de Supabase,
#      y abre el SQL Editor: pegas, Run, y Enter aca. Despues se limpia el portapapeles.
#   4. Redespliega para que la app tome la clave publica.
#  Ningun secreto pasa por el chat ni queda en el historial.
# =====================================================================
param([switch]$RotarVapid)

$ErrorActionPreference = "Continue"
Set-Location $PSScriptRoot

$APP_URL      = "https://mis-finanzas-six-gamma.vercel.app"
$SUPABASE_REF = "cfsysumtjsdofjcvocho"
$VERCEL       = "vercel.cmd"
$TARGETS      = @("production", "development")

function Paso($n, $t) { Write-Host "`n==== $n  $t ====" -ForegroundColor Cyan }
function Ok($t)    { Write-Host "  [OK] $t" -ForegroundColor Green }
function Info($t)  { Write-Host "  $t" -ForegroundColor Gray }
function Aviso($t) { Write-Host "  [!] $t" -ForegroundColor Yellow }
function Falla($t) { Write-Host "  [ERROR] $t" -ForegroundColor Red; exit 1 }

function EnvAdd($name, $value, $targets) {
  $tmp = [IO.Path]::GetTempFileName()
  try {
    [IO.File]::WriteAllText($tmp, $value, (New-Object Text.UTF8Encoding $false))
    foreach ($t in $targets) {
      cmd /c "$VERCEL env rm $name $t --yes >nul 2>&1"
      cmd /c "$VERCEL env add $name $t < `"$tmp`" >nul 2>&1"
      if ($LASTEXITCODE -ne 0) { Falla "No se pudo cargar $name ($t) en Vercel" }
    }
    Ok "$name -> $($targets -join ', ')"
  } finally {
    Remove-Item $tmp -Force -ErrorAction SilentlyContinue
  }
}

# ---------------------------------------------------------------------
Paso "1/4" "Herramientas"
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Falla "Falta Node.js (https://nodejs.org)" }
if (-not (Get-Command $VERCEL -ErrorAction SilentlyContinue)) { Falla "Falta Vercel CLI: npm i -g vercel" }
if (-not (Test-Path ".vercel\project.json")) { Falla "Esta carpeta no esta vinculada a Vercel. Corre antes deploy.ps1" }
if (-not (Test-Path "node_modules\web-push")) {
  Info "Instalando dependencias (npm install)..."
  npm install --no-audit --no-fund | Out-Null
  if (-not (Test-Path "node_modules\web-push")) { Falla "No se pudo instalar web-push" }
}
Ok "Node, Vercel CLI y web-push listos"

# ---------------------------------------------------------------------
Paso "2/4" "Claves"
$envList = (& $VERCEL env ls production 2>&1 | Out-String)
$tieneVapid = $envList -match "VAPID_PRIVATE_KEY"
if ($tieneVapid -and -not $RotarVapid) {
  Ok "Las claves VAPID ya estaban en Vercel (no se tocan: los celulares suscriptos siguen andando)"
} else {
  if ($RotarVapid) { Aviso "Rotando VAPID: vas a tener que reactivar los avisos en cada celular" }
  $tmpJson = [IO.Path]::GetTempFileName()
  try {
    node -e "require('fs').writeFileSync(process.argv[1], JSON.stringify(require('web-push').generateVAPIDKeys()))" $tmpJson
    $vapid = Get-Content $tmpJson -Raw | ConvertFrom-Json
  } finally {
    Remove-Item $tmpJson -Force -ErrorAction SilentlyContinue
  }
  if (-not $vapid.publicKey -or -not $vapid.privateKey) { Falla "No se pudieron generar las claves VAPID" }
  $mail = (git config user.email)
  $subj = Read-Host "Email de contacto para Apple/Google (Enter = $mail)"
  if (-not $subj) { $subj = $mail }
  if ($subj -notmatch "^[^@\s]+@[^@\s]+$") { Falla "Email invalido" }
  EnvAdd "NEXT_PUBLIC_VAPID_PUBLIC_KEY" $vapid.publicKey $TARGETS
  EnvAdd "VAPID_PRIVATE_KEY" $vapid.privateKey @("production")
  EnvAdd "VAPID_SUBJECT" "mailto:$subj" @("production")
  $vapid = $null
}

# Secreto HMAC compartido base <-> Vercel: se renueva en cada corrida
$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$SECRET = -join ($bytes | ForEach-Object { $_.ToString("x2") })
EnvAdd "PUSH_SECRET" $SECRET @("production")

# ---------------------------------------------------------------------
Paso "3/4" "Supabase Vault"
$sql = @"
-- Mis Finanzas: URL de la app y secreto de los avisos (Vault). Idempotente.
do `$`$
declare v_id uuid;
begin
  select id into v_id from vault.secrets where name = 'push_app_url';
  if v_id is null then perform vault.create_secret('$APP_URL', 'push_app_url');
  else perform vault.update_secret(v_id, '$APP_URL'); end if;
  select id into v_id from vault.secrets where name = 'push_secret';
  if v_id is null then perform vault.create_secret('$SECRET', 'push_secret');
  else perform vault.update_secret(v_id, '$SECRET'); end if;
end `$`$;
select name, updated_at from vault.secrets where name in ('push_app_url', 'push_secret');
"@
Set-Clipboard -Value $sql
$SECRET = $null
Start-Process "https://supabase.com/dashboard/project/$SUPABASE_REF/sql/new"
Info "Se abrio el SQL Editor (proyecto $SUPABASE_REF) y el SQL esta en el portapapeles."
Info "Pegalo (Ctrl+V), toca Run y verifica que liste push_app_url y push_secret."
while ($true) {
  $r = Read-Host "  Enter cuando lo hayas ejecutado  (C + Enter = volver a copiarlo)"
  if ($r -match '^[cC]$') { Set-Clipboard -Value $sql; Ok "Copiado de nuevo al portapapeles"; continue }
  break
}
$sql = $null
Set-Clipboard -Value " "
Ok "Portapapeles limpio"

# ---------------------------------------------------------------------
Paso "4/4" "Redeploy"
Info "Compilando en Vercel (1-2 minutos)..."
$out = (& $VERCEL deploy --prod --yes) | Select-Object -Last 1
if ($LASTEXITCODE -ne 0 -or $out -notmatch "^https://") { Falla "El deploy fallo. Revisa vercel.com > Deployments" }
Ok "Publicado"

try {
  $r = Invoke-WebRequest "$APP_URL/api/push" -Method Post -Body '{"payload":"x","sig":"00"}' -ContentType "application/json" -UseBasicParsing -TimeoutSec 30
  Aviso "Respuesta inesperada: $($r.StatusCode)"
} catch {
  $code = [int]$_.Exception.Response.StatusCode
  if ($code -eq 400) { Ok "/api/push activo y rechaza pedidos sin firma (400)" }
  elseif ($code -eq 503) { Aviso "/api/push dice 'sin configurar': revisa las variables en Vercel" }
  else { Aviso "/api/push respondio $code" }
}

Write-Host ""
Write-Host "Ultimo paso, en el iPhone:" -ForegroundColor Cyan
Write-Host "  Abri la app desde el icono de inicio > Ajustes > Avisos > Activar > Enviar prueba"
Write-Host "`nListo. Los avisos salen todos los dias a las 9:00." -ForegroundColor Green
