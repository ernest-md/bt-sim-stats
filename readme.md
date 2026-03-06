Esta rama es para recibir los cambios de main y aplicarlos a la .apk.
Como hay muchas dependencias externas de momento solo se usa desde el pc del capi.



Script para copiar los archivos a la .apk:
cd "C:\Users\ErnestGladiadorValde\Documents\barateam-hub"
$ErrorActionPreference = "Stop"

# 1) web limpia
if (Test-Path .\web) { Remove-Item .\web -Recurse -Force }
New-Item -ItemType Directory .\web | Out-Null

# 2) copiar TODO lo necesario (recursivo), excluyendo carpetas técnicas
robocopy . .\web /E `
  /XD .git node_modules android web .vscode .codex `
  /XF *.ps1 package-lock.json npm-debug.log .gitignore
if ($LASTEXITCODE -ge 8) { throw "robocopy fallo con codigo $LASTEXITCODE" }

# 3) checks mínimos críticos
$must = @(
  ".\web\index.html",
  ".\web\login.html",
  ".\web\decks.html",
  ".\web\encuestas.html",
  ".\web\sim-stats\frontend\stats.html",
  ".\web\sim-stats\frontend\team-stats.html"
)
$must | ForEach-Object {
  if (!(Test-Path $_)) { throw "Falta archivo requerido: $_" }
}

# 4) sync capacitor -> android assets
npx cap copy android

# 5) compilar apk
cd .\android
.\gradlew.bat clean assembleDebug

Write-Host ""
Write-Host "APK lista en:"
Write-Host "C:\Users\ErnestGladiadorValde\Documents\barateam-hub\android\app\build\outputs\apk\debug\app-debug.apk"
