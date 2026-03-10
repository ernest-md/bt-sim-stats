Esta rama es para recibir los cambios de main y aplicarlos a la .apk.
Como hay muchas dependencias externas de momento solo se usa desde el pc del capi.



Script para copiar los archivos a la .apk:
cd "C:\Users\ErnestGladiadorValde\Documents"
$ErrorActionPreference = "Stop"

$sourceRoot = "C:\Users\ErnestGladiadorValde\Documents\barateam-hub"
$mobileRoot = "C:\Users\ErnestGladiadorValde\Documents\barateam-hub-mobile"
$mobileWeb = Join-Path $mobileRoot "web"
$androidRoot = Join-Path $mobileRoot "android"
$defaultSdk = "C:\Users\ErnestGladiadorValde\AppData\Local\Android\Sdk"

if (!(Test-Path $mobileRoot)) { throw "No existe $mobileRoot" }
if (!(Test-Path (Join-Path $mobileRoot "node_modules\.bin\cap.cmd"))) { throw "No existe cap.cmd en $mobileRoot\node_modules\.bin" }

# 1) refrescar assets web del proyecto mobile
if (Test-Path $mobileWeb) { Remove-Item $mobileWeb -Recurse -Force }
New-Item -ItemType Directory $mobileWeb | Out-Null

robocopy $sourceRoot $mobileWeb /E `
  /XD .git node_modules android web .vscode .codex `
  /XF *.ps1 package-lock.json npm-debug.log .gitignore
if ($LASTEXITCODE -ge 8) { throw "robocopy web fallo con codigo $LASTEXITCODE" }

# 2) checks criticos
$must = @(
  ".\web\index.html",
  ".\web\login.html",
  ".\web\decks.html",
  ".\web\encuestas.html",
  ".\web\op-wrapped.html",
  ".\web\app.css",
  ".\web\app.js",
  ".\web\LOGO_APP.png",
  ".\web\sim-stats\frontend\stats.html",
  ".\web\sim-stats\frontend\team-stats.html"
)
cd $mobileRoot
$must | ForEach-Object {
  if (!(Test-Path $_)) { throw "Falta archivo requerido: $_" }
}

# 3) nombre app correcto
@'
{
  "appId": "com.barateam.hub",
  "appName": "Barateam",
  "webDir": "web"
}
'@ | Set-Content -Encoding UTF8 .\capacitor.config.json

# 4) regenerar icono desde LOGO_APP
if (Test-Path .\resources) { Remove-Item .\resources -Recurse -Force }
New-Item -ItemType Directory .\resources | Out-Null
Copy-Item ".\web\LOGO_APP.png" ".\resources\icon.png" -Force

npx.cmd @capacitor/assets generate --android

# 5) sync capacitor
.\node_modules\.bin\cap.cmd sync android

# 6) fullscreen inmersivo
$mainActivity = Join-Path $androidRoot "app\src\main\java\com\barateam\hub\MainActivity.java"
if (Test-Path $mainActivity) {
@'
package com.barateam.hub;

import android.os.Bundle;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  private void applyImmersiveMode() {
    WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

    WindowInsetsControllerCompat controller =
      new WindowInsetsControllerCompat(getWindow(), getWindow().getDecorView());

    controller.hide(
      WindowInsetsCompat.Type.statusBars() | WindowInsetsCompat.Type.navigationBars()
    );
    controller.setSystemBarsBehavior(
      WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    );
  }

  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    applyImmersiveMode();
  }

  @Override
  public void onWindowFocusChanged(boolean hasFocus) {
    super.onWindowFocusChanged(hasFocus);
    if (hasFocus) {
      applyImmersiveMode();
    }
  }
}
'@ | Set-Content -Encoding UTF8 $mainActivity
}

# 7) sdk local.properties
cd $androidRoot
if (Test-Path $defaultSdk) {
@"
sdk.dir=C\:\\Users\\ErnestGladiadorValde\\AppData\\Local\\Android\\Sdk
"@ | Set-Content -Encoding ASCII .\local.properties
} else {
  $sdkPath = Get-ChildItem "C:\Users\ErnestGladiadorValde" -Recurse -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -eq "Sdk" } |
    Select-Object -First 1 -ExpandProperty FullName

  if (-not $sdkPath) { throw "No se ha encontrado Android SDK en el equipo." }

  $escaped = $sdkPath.Replace('\', '\\')
@"
sdk.dir=$escaped
"@ | Set-Content -Encoding ASCII .\local.properties
}

# 8) compilar apk
.\gradlew.bat clean assembleDebug

Write-Host ""
Write-Host "APK lista en:"
Write-Host "C:\Users\ErnestGladiadorValde\Documents\barateam-hub-mobile\android\app\build\outputs\apk\debug\app-debug.apk"
