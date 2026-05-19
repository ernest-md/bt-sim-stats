$ErrorActionPreference = "Stop"

$scriptPath = $MyInvocation.MyCommand.Path
$sourceRoot = if ($scriptPath) { Split-Path -Parent $scriptPath } else { (Get-Location).Path }
$documentsRoot = Split-Path -Parent $sourceRoot
$mobileRoot = Join-Path $documentsRoot "barateam-hub-fantasy-mobile"
$mobileWeb = Join-Path $mobileRoot "web"
$androidRoot = Join-Path $mobileRoot "android"
$defaultSdk = "C:\Users\ErnestGladiadorValde\AppData\Local\Android\Sdk"
$appId = "com.barateam.fantasy"
$appName = "VaDeFantasy"

function Write-Utf8NoBom {
  param(
    [Parameter(Mandatory=$true)][string]$Path,
    [Parameter(Mandatory=$true)][string]$Content
  )
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

function Invoke-Native {
  param(
    [Parameter(Mandatory=$true)][string]$FilePath,
    [string[]]$Arguments = @(),
    [Parameter(Mandatory=$true)][string]$Label
  )
  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Label fallo con codigo $LASTEXITCODE"
  }
}

function Copy-ProjectItem {
  param([Parameter(Mandatory=$true)][string]$RelativePath)

  $src = Join-Path $sourceRoot $RelativePath
  $dst = Join-Path $mobileWeb $RelativePath
  if (!(Test-Path -LiteralPath $src)) {
    throw "Falta archivo requerido en origen: $src"
  }

  $dstParent = Split-Path -Parent $dst
  if ($dstParent -and !(Test-Path -LiteralPath $dstParent)) {
    New-Item -ItemType Directory -Force -Path $dstParent | Out-Null
  }

  $item = Get-Item -LiteralPath $src
  if ($item.PSIsContainer) {
    if (Test-Path -LiteralPath $dst) {
      Remove-Item -LiteralPath $dst -Recurse -Force
    }
    Copy-Item -LiteralPath $src -Destination $dstParent -Recurse -Force
  } else {
    Copy-Item -LiteralPath $src -Destination $dst -Force
  }
}

function Patch-MobileHtml {
  param([Parameter(Mandatory=$true)][string]$Path)

  $pageName = Split-Path $Path -Leaf
  $accountPages = @("login.html", "profile.html", "user.html", "reset-password.html", "vade-back-fight.html")
  $allowedPages = @(
    "index.html",
    "fantasy.html",
    "fantasy-ranking.html",
    "fantasy-team.html",
    "fantasy-market.html",
    "fantasy-attendance.html",
    "vade-back-fight.html",
    "login.html",
    "profile.html",
    "user.html",
    "reset-password.html"
  )

  $html = Get-Content -LiteralPath $Path -Raw

  # La app fantasy no muestra salidas al hub general.
  $html = [regex]::Replace($html, '\s*<a class="vdfTopNavLink" href="vade-back-fight\.html"[^>]*>Ranking VBF</a>', "")
  $html = [regex]::Replace($html, '\s*<a class="vdfOriginalLink" href="index\.html"[^>]*>.*?</a>', "", [System.Text.RegularExpressions.RegexOptions]::Singleline)
  $html = $html.Replace('href="index.html"', 'href="fantasy.html"')

  # Todas las paginas de la APK: mostrar solo el nav de VadeFantasy en el hamburger mobile.
  # Hace visible el grupo data-fantasy-nav que viene oculto en el HTML fuente.
  $html = $html.Replace('data-fantasy-nav="1" style="display:none"', 'data-fantasy-nav="1"')
  # Las paginas fantasy usan <nav class="vdfTopNav"> en vez de .nav.hubNavFlow.
  # Añade clase 'nav' para que initMobileTopbarToggle cree el hamburger y controle
  # la visibilidad del panel en mobile (app.css ya tiene .topbar .nav { display:none } en mobile).
  $html = $html.Replace('<nav class="vdfTopNav"', '<nav class="vdfTopNav nav"')
  # Reemplaza el contenido del vdfTopNav con el conjunto estandar de links de la APK,
  # mismo orden y texto que el menu de las hub pages.
  $vdfTopNavLinks = '<nav class="vdfTopNav nav" aria-label="Navegacion principal VaDeFantasy">' + "`r`n" +
    '        <a class="vdfTopNavLink" href="fantasy.html">Liga</a>' + "`r`n" +
    '        <a class="vdfTopNavLink" href="fantasy-team.html">Plantilla</a>' + "`r`n" +
    '        <a class="vdfTopNavLink" href="fantasy-market.html">Mercado</a>' + "`r`n" +
    '        <a class="vdfTopNavLink" href="fantasy-ranking.html">Ranking VaDeFantasy</a>' + "`r`n" +
    '        <a class="vdfTopNavLink" href="vade-back-fight.html">Ranking VaDeBackFight</a>' + "`r`n" +
    '      </nav>'
  $html = [regex]::Replace($html,
    '<nav class="vdfTopNav nav"[^>]*>[\s\S]*?</nav>',
    $vdfTopNavLinks,
    [System.Text.RegularExpressions.RegexOptions]::Singleline
  )
  # Reescribe el menu VadeFantasy con exactamente los links de la APK, en el orden correcto.
  $vdfMenu = '<div class="navInlineMenu" id="vadeFantasyMenu">' + "`r`n" +
    '            <a class="navInlineMenuLink" href="fantasy.html">Liga</a>' + "`r`n" +
    '            <a class="navInlineMenuLink" href="fantasy-team.html">Plantilla</a>' + "`r`n" +
    '            <a class="navInlineMenuLink" href="fantasy-market.html">Mercado</a>' + "`r`n" +
    '            <a class="navInlineMenuLink" href="fantasy-ranking.html">Ranking VaDeFantasy</a>' + "`r`n" +
    '            <a class="navInlineMenuLink" href="vade-back-fight.html">Ranking VaDeBackFight</a>' + "`r`n" +
    '          </div>'
  $html = [regex]::Replace($html,
    '<div class="navInlineMenu" id="vadeFantasyMenu">[\s\S]*?</div>',
    $vdfMenu,
    [System.Text.RegularExpressions.RegexOptions]::Singleline
  )

  # CSS global: oculta todo el hub nav salvo el grupo VadeFantasy, en todas las paginas.
  $globalNavCss = @'
  <style id="fantasy-app-nav-shell">
    .nav.hubNavFlow > :not([data-fantasy-nav]){display:none!important}
    .navInlineGroup[data-fantasy-nav]{display:flex!important}
    @media (max-width:760px){
      /* Hub pages: un solo click al hamburger muestra los links directamente, sin submenu intermedio */
      .topbar .nav.open .navInlineGroup[data-fantasy-nav] > .navInlineButton{display:none!important}
      .topbar .nav.open .navInlineGroup[data-fantasy-nav] .navInlineMenu{
        display:flex!important;
        position:static!important;
        width:100%!important;
        max-width:100%!important;
        flex-direction:column!important;
        box-shadow:none!important;
        border:none!important;
        background:transparent!important;
        border-radius:0!important;
        padding:0!important;
        gap:2px!important;
      }
      /* El topbar de fantasy pages tiene overflow-x:hidden que hace overflow-y:auto,
         lo cual recorta el panel absoluto que cae por debajo del topbar. */
      body[data-fantasy-view] .topbar{overflow:visible!important}
      /* Neutraliza los overrides de fantasy-polish sobre .btn para el hamburger */
      body[data-fantasy-view] .topbar .mobileNavToggle,
      body[data-fantasy-view] .topbar .mobileNavToggle:hover,
      body[data-fantasy-view] .topbar .mobileNavToggle:focus-visible{
        background:rgba(255,255,255,.12)!important;
        color:#fff!important;
        border-radius:12px!important;
      }
      /* Fantasy pages: vdfTopNav abierto es un panel columna, no scroll horizontal */
      .topbar .nav.vdfTopNav.open{
        overflow-x:hidden!important;
        flex-direction:column!important;
        flex-wrap:nowrap!important;
        scroll-snap-type:none!important;
        align-items:stretch!important;
      }
      .topbar .nav.vdfTopNav.open .vdfTopNavLink{
        display:flex!important;
        align-items:center!important;
        justify-content:flex-start!important;
        flex:none!important;
        gap:10px!important;
        width:100%!important;
        max-width:100%!important;
        min-height:0!important;
        padding:10px 12px!important;
        border-radius:12px!important;
        font-size:14px!important;
        font-weight:800!important;
        line-height:1.2!important;
        scroll-snap-align:none!important;
        background:rgba(255,255,255,.08)!important;
        color:#fff!important;
        text-decoration:none!important;
        box-sizing:border-box!important;
        border:none!important;
        transform:none!important;
        transition:background .18s ease!important;
      }
    }
  </style>
'@
  if ($html -notmatch 'fantasy-app-nav-shell') {
    $html = $html -replace '</head>', "$globalNavCss`r`n</head>"
  }

  if ($accountPages -contains $pageName) {
    # Paginas de cuenta y VBF: cambiar logo y brand al contexto VaDeFantasy.
    $html = [regex]::Replace($html, '<body([^>]*)>', '<body$1 data-fantasy-app-account="1">', 1)
    $html = $html.Replace('src="BT_LOGO.png" alt="BARATEAM HUB"', 'src="VDF.png" alt="VaDeFantasy"')
    $html = [regex]::Replace($html, '<small>[^<]*</small>', '<small>Fantasy</small>', 1)

    $accountShellCss = @'
  <style id="fantasy-app-account-shell">
    body[data-fantasy-app-account="1"] .brandLogo{height:52px;max-width:160px;object-fit:contain}
    body[data-fantasy-app-account="1"] .brand small{display:none!important}
    @media (max-width:760px){
      body[data-fantasy-app-account="1"] .bar.with-auth-corner{padding-left:0;padding-right:0}
      body[data-fantasy-app-account="1"] .topbar .brandLink,
      body[data-fantasy-app-account="1"] .bar > .brand{width:100%;justify-content:center}
    }
  </style>
'@
    if ($html -notmatch 'fantasy-app-account-shell') {
      $html = $html -replace '</head>', "$accountShellCss`r`n</head>"
    }
  }

  if ($pageName -eq "login.html") {
    # En la APK Fantasy no hay SIM ni partidas que sincronizar tras el login.
    $html = [regex]::Replace($html,
      '[ \t]*setAuthLoading\(true,[^)]*"Recuperando partidas nuevas[^"]*"[^)]*\);[\s\S]*?} else if \(!autoSync\.skipped\)\s*\{[\s\S]*?hasFinalMessage\s*=\s*true;[^\n]*\n[^\n]*\}',
      '',
      ([System.Text.RegularExpressions.RegexOptions]::Singleline)
    )
    # Redirige directamente a fantasy.html tras el login en vez de pasar por index.html.
    $html = $html.Replace('location.href = "index.html"', 'location.href = "fantasy.html"')
  }

  # Evita enlaces rotos hacia secciones no copiadas en la APK fantasy.
  $html = [regex]::Replace($html, 'href="([^"#?]+\.html)([^"]*)"', {
    param($match)
    $target = $match.Groups[1].Value
    $suffix = $match.Groups[2].Value
    $leaf = Split-Path $target -Leaf
    if ($allowedPages -contains $leaf) {
      return $match.Value
    }
    return 'href="fantasy.html"'
  })

  Write-Utf8NoBom -Path $Path -Content $html
}

function Assert-FantasyOnlyLinks {
  $allowedPages = @(
    "index.html",
    "fantasy.html",
    "fantasy-ranking.html",
    "fantasy-team.html",
    "fantasy-market.html",
    "fantasy-attendance.html",
    "vade-back-fight.html",
    "login.html",
    "profile.html",
    "user.html",
    "reset-password.html"
  )

  $badLinks = New-Object System.Collections.Generic.List[string]
  Get-ChildItem -LiteralPath $mobileWeb -Filter "*.html" | ForEach-Object {
    $page = $_.Name
    $html = Get-Content -LiteralPath $_.FullName -Raw
    [regex]::Matches($html, 'href="([^"#]+\.html)([^"]*)"') | ForEach-Object {
      $target = $_.Groups[1].Value
      $leaf = Split-Path $target -Leaf
      if ($allowedPages -notcontains $leaf) {
        $badLinks.Add("${page} -> $($_.Value)")
      }
    }
  }

  if ($badLinks.Count) {
    throw "La web fantasy mobile conserva enlaces fuera de Fantasy:`n$($badLinks -join "`n")"
  }
}

function Patch-FantasyAppJs {
  $appJsPath = Join-Path $mobileWeb "app.js"
  if (!(Test-Path -LiteralPath $appJsPath)) {
    throw "Falta app.js para parchear la navegacion fantasy mobile."
  }

  $js = Get-Content -LiteralPath $appJsPath -Raw
  $needle = 'const items = Array.isArray(actions) ? actions : [];'
  $replacement = 'const items = (Array.isArray(actions) ? actions : []).filter((item) => /(^|\/)fantasy(?:-[a-z]+)?\.html(?:$|[?#])/i.test(String(item.href || "")));'

  if (!$js.Contains($needle)) {
    throw "No se encontro el punto de parcheo de renderModeDock en app.js."
  }

  $js = $js.Replace($needle, $replacement)
  Write-Utf8NoBom -Path $appJsPath -Content $js
}

function Ensure-MobileProject {
  if (!(Test-Path -LiteralPath $mobileRoot)) {
    New-Item -ItemType Directory -Force -Path $mobileRoot | Out-Null
  }

  $packageJson = Join-Path $mobileRoot "package.json"
  $packageLock = Join-Path $mobileRoot "package-lock.json"
  if (!(Test-Path -LiteralPath $packageJson)) {
    Copy-Item -LiteralPath (Join-Path $sourceRoot "package.json") -Destination $packageJson -Force
  }
  if (!(Test-Path -LiteralPath $packageLock) -and (Test-Path -LiteralPath (Join-Path $sourceRoot "package-lock.json"))) {
    Copy-Item -LiteralPath (Join-Path $sourceRoot "package-lock.json") -Destination $packageLock -Force
  }

  Push-Location $mobileRoot
  try {
    if (!(Test-Path -LiteralPath ".\node_modules\.bin\cap.cmd")) {
      Invoke-Native -FilePath "npm.cmd" -Arguments @("install") -Label "npm install"
    }
  } finally {
    Pop-Location
  }
}

function Write-CapacitorConfig {
  $config = @"
{
  "appId": "$appId",
  "appName": "$appName",
  "webDir": "web"
}
"@
  Write-Utf8NoBom -Path (Join-Path $mobileRoot "capacitor.config.json") -Content $config
}

function Write-FantasyIndex {
  $index = @'
<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>VaDeFantasy</title>
  <meta http-equiv="refresh" content="0; url=fantasy.html">
  <script>
    window.location.replace("fantasy.html" + window.location.search + window.location.hash);
  </script>
</head>
<body>
  <a href="fantasy.html">Entrar en VaDeFantasy</a>
</body>
</html>
'@
  Write-Utf8NoBom -Path (Join-Path $mobileWeb "index.html") -Content $index
}

function Build-FantasyWeb {
  if (Test-Path -LiteralPath $mobileWeb) {
    Remove-Item -LiteralPath $mobileWeb -Recurse -Force
  }
  New-Item -ItemType Directory -Force -Path $mobileWeb | Out-Null

  $items = @(
    "fantasy.html",
    "fantasy-ranking.html",
    "fantasy-team.html",
    "fantasy-market.html",
    "fantasy-attendance.html",
    "vade-back-fight.html",
    "login.html",
    "profile.html",
    "user.html",
    "reset-password.html",
    "app.css",
    "app.js",
    "fantasy-polish.css",
    "fantasy-player-portraits.js",
    "fantasy.js",
    "favicon.ico",
    "LOGO_APP_VDF.jpg",
    "BT_LOGO.png",
    "VDF.png",
    "VDF_BG.png",
    "VDF_Background.png",
    "VDJ.png",
    "bg.png",
    "berries.png",
    "inscrito.png",
    "fantasy_coin.png",
    "fantasy_placeholder.jpeg",
    "fantasy",
    "DOC"
  )

  foreach ($item in $items) {
    Copy-ProjectItem -RelativePath $item
  }

  Write-FantasyIndex

  Get-ChildItem -LiteralPath $mobileWeb -Filter "*.html" | ForEach-Object {
    Patch-MobileHtml -Path $_.FullName
  }
  Patch-FantasyAppJs
  Assert-FantasyOnlyLinks

  $must = @(
    "index.html",
    "fantasy.html",
    "fantasy-ranking.html",
    "fantasy-team.html",
    "fantasy-market.html",
    "fantasy-attendance.html",
    "login.html",
    "profile.html",
    "app.css",
    "app.js",
    "fantasy-polish.css",
    "fantasy-player-portraits.js",
    "fantasy.js",
    "VDF.png",
    "LOGO_APP_VDF.jpg",
    "VDF_BG.png",
    "VDF_Background.png",
    "berries.png",
    "inscrito.png"
  )

  foreach ($relative in $must) {
    $path = Join-Path $mobileWeb $relative
    if (!(Test-Path -LiteralPath $path)) {
      throw "Falta archivo requerido en web fantasy: $path"
    }
  }
}

function Ensure-AndroidProject {
  Push-Location $mobileRoot
  try {
    if (!(Test-Path -LiteralPath $androidRoot)) {
      Invoke-Native -FilePath ".\node_modules\.bin\cap.cmd" -Arguments @("add", "android") -Label "cap add android"
    }
  } finally {
    Pop-Location
  }
}

function Generate-AndroidAssets {
  $iconSource = Join-Path $mobileWeb "LOGO_APP_VDF.jpg"
  if (!(Test-Path -LiteralPath $iconSource)) {
    throw "No se encontro LOGO_APP_VDF.jpg en $mobileWeb"
  }

  $androidResPath = Join-Path $androidRoot "app\src\main\res"

  Add-Type -AssemblyName System.Drawing

  $sizes = [ordered]@{
    "mipmap-mdpi"    = 48
    "mipmap-hdpi"    = 72
    "mipmap-xhdpi"   = 96
    "mipmap-xxhdpi"  = 144
    "mipmap-xxxhdpi" = 192
  }

  $srcImage = [System.Drawing.Image]::FromFile($iconSource)
  try {
    foreach ($entry in $sizes.GetEnumerator()) {
      $dir = Join-Path $androidResPath $entry.Key
      if (!(Test-Path -LiteralPath $dir)) {
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
      }
      $sz = $entry.Value
      $bmp = New-Object System.Drawing.Bitmap($sz, $sz)
      $g = [System.Drawing.Graphics]::FromImage($bmp)
      $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $g.SmoothingMode    = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      $g.DrawImage($srcImage, 0, 0, $sz, $sz)
      $g.Dispose()
      foreach ($name in @("ic_launcher.png", "ic_launcher_round.png")) {
        $bmp.Save((Join-Path $dir $name), [System.Drawing.Imaging.ImageFormat]::Png)
      }
      $bmp.Dispose()
    }
  } finally {
    $srcImage.Dispose()
  }

  Write-Host "Iconos Android generados desde LOGO_APP_VDF.jpg"
}

function Sync-Capacitor {
  Push-Location $mobileRoot
  try {
    Invoke-Native -FilePath ".\node_modules\.bin\cap.cmd" -Arguments @("sync", "android") -Label "cap sync android"
  } finally {
    Pop-Location
  }
}

function Write-ImmersiveMainActivity {
  $javaRoot = Join-Path $androidRoot "app\src\main\java"
  $mainActivity = Get-ChildItem -LiteralPath $javaRoot -Recurse -Filter "MainActivity.java" -ErrorAction SilentlyContinue | Select-Object -First 1
  if (!$mainActivity) {
    Write-Warning "No se encontro MainActivity.java para aplicar modo inmersivo."
    return
  }

  $existing = Get-Content -LiteralPath $mainActivity.FullName -Raw
  $packageMatch = [regex]::Match($existing, '^\s*package\s+([^;]+);', [System.Text.RegularExpressions.RegexOptions]::Multiline)
  $javaPackage = if ($packageMatch.Success) { $packageMatch.Groups[1].Value } else { $appId }

  $content = @"
package $javaPackage;

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
"@

  Write-Utf8NoBom -Path $mainActivity.FullName -Content $content
}

function Write-LocalProperties {
  $sdkPath = @($env:ANDROID_HOME, $env:ANDROID_SDK_ROOT, $defaultSdk) |
    Where-Object { $_ -and (Test-Path -LiteralPath $_) } |
    Select-Object -First 1

  if (!$sdkPath) {
    $sdkPath = Get-ChildItem "C:\Users\ErnestGladiadorValde" -Recurse -Directory -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -eq "Sdk" } |
      Select-Object -First 1 -ExpandProperty FullName
  }

  if (!$sdkPath) {
    throw "No se ha encontrado Android SDK en el equipo."
  }

  $sdkForGradle = $sdkPath.Replace('\', '/')
  Set-Content -LiteralPath (Join-Path $androidRoot "local.properties") -Encoding ASCII -Value "sdk.dir=$sdkForGradle"
}

function Build-Apk {
  Push-Location $androidRoot
  try {
    Invoke-Native -FilePath ".\gradlew.bat" -Arguments @("clean", "assembleDebug") -Label "gradle assembleDebug"
  } finally {
    Pop-Location
  }
}

Ensure-MobileProject
Write-CapacitorConfig
Build-FantasyWeb
Ensure-AndroidProject
Generate-AndroidAssets
Sync-Capacitor
Write-ImmersiveMainActivity
Write-LocalProperties
Build-Apk

$apkPath = Join-Path $androidRoot "app\build\outputs\apk\debug\app-debug.apk"
Write-Host ""
Write-Host "APK Fantasy lista en:"
Write-Host $apkPath
