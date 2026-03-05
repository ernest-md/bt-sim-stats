# build-apk.ps1
# Uso:
#   Set-ExecutionPolicy -Scope Process Bypass
#   .\build-apk.ps1

$ErrorActionPreference = "Stop"

function Ensure-Command($cmd, $msg) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
    throw $msg
  }
}

function Install-WingetPackage($id) {
  Write-Host "Instalando $id ..."
  winget install --id $id --exact --accept-package-agreements --accept-source-agreements --silent
}

Write-Host "== 1) Verificando winget =="
Ensure-Command "winget" "winget no está disponible. Actualiza App Installer desde Microsoft Store."

Write-Host "== 2) Instalando dependencias base =="
Install-WingetPackage "OpenJS.NodeJS.LTS"
Install-WingetPackage "EclipseAdoptium.Temurin.17.JDK"
Install-WingetPackage "Google.AndroidStudio"

Write-Host "== 3) Refrescando PATH para esta sesión =="
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + `
            [System.Environment]::GetEnvironmentVariable("Path","User")

Ensure-Command "node" "Node no quedó disponible en PATH."
Ensure-Command "npm" "npm no quedó disponible en PATH."

Write-Host "== 4) Configurando proyecto Node/Capacitor =="
if (-not (Test-Path "package.json")) {
  npm init -y | Out-Null
}

npm install @capacitor/core @capacitor/cli @capacitor/android --save-dev

# Carpeta web limpia para empaquetar solo estáticos
if (Test-Path "web") { Remove-Item -Recurse -Force "web" }
New-Item -ItemType Directory -Path "web" | Out-Null

# Copia de archivos web comunes (ajusta si necesitas más extensiones)
Get-ChildItem -File -Include *.html,*.css,*.js,*.png,*.jpg,*.jpeg,*.gif,*.svg,*.ico,*.webp,*.json,*.woff,*.woff2 -Path . |
  Where-Object { $_.DirectoryName -eq (Get-Location).Path } |
  ForEach-Object { Copy-Item $_.FullName -Destination "web" }

# Inicializa Capacitor solo si no existe
if (-not (Test-Path "capacitor.config.json")) {
  npx cap init "Barateam Hub" "com.barateam.hub" --web-dir "web"
}

# Fuerza webDir=web por seguridad
(Get-Content "capacitor.config.json" -Raw) `
  -replace '"webDir"\s*:\s*"[^"]+"', '"webDir":"web"' |
  Set-Content "capacitor.config.json" -Encoding UTF8

if (-not (Test-Path "android")) {
  npx cap add android
}

npx cap copy android

Write-Host "== 5) Detectando Android SDK =="
$sdkPath = "$env:LOCALAPPDATA\Android\Sdk"
if (-not (Test-Path $sdkPath)) {
  Write-Host ""
  Write-Host "No se encontró Android SDK en $sdkPath"
  Write-Host "Abre Android Studio una vez y completa:"
  Write-Host "  - SDK Platform (Android 14 recomendado)"
  Write-Host "  - Android SDK Build-Tools"
  Write-Host "  - Android SDK Platform-Tools"
  Write-Host "Luego vuelve a ejecutar este script."
  exit 1
}

$localProps = @"
sdk.dir=$($sdkPath -replace '\\','\\')
"@
Set-Content -Path ".\android\local.properties" -Value $localProps -Encoding ASCII

Write-Host "== 6) Build APK debug =="
Push-Location ".\android"
.\gradlew.bat assembleDebug
Pop-Location

$apk = Resolve-Path ".\android\app\build\outputs\apk\debug\app-debug.apk"
Write-Host ""
Write-Host "APK generada correctamente:"
Write-Host $apk
