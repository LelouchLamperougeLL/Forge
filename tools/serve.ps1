<#
  Minimal static file server for previewing the app locally on Windows (PowerShell 7+).
  Service workers need a secure context; http://localhost counts as secure, so offline
  behaviour, installation and caching can all be tested with this server.

  Usage (from the app folder):
    pwsh -File tools/serve.ps1                      # serves at http://localhost:8765/
    pwsh -File tools/serve.ps1 -Base /forge/        # serves under a sub-path, like GitHub Pages
    pwsh -File tools/serve.ps1 -Port 9000
  Stop with Ctrl+C.
#>
param(
  [string]$Root = (Split-Path -Parent $PSScriptRoot),
  [int]$Port = 8765,
  [string]$Base = '/'
)

if (-not $Base.StartsWith('/')) { $Base = '/' + $Base }
if (-not $Base.EndsWith('/')) { $Base = $Base + '/' }
$Root = [IO.Path]::GetFullPath($Root)

$mime = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.mjs' = 'text/javascript; charset=utf-8'
  '.css' = 'text/css; charset=utf-8'; '.json' = 'application/json; charset=utf-8'
  '.webmanifest' = 'application/manifest+json; charset=utf-8'; '.png' = 'image/png'; '.svg' = 'image/svg+xml'
  '.ico' = 'image/x-icon'; '.md' = 'text/markdown; charset=utf-8'; '.txt' = 'text/plain; charset=utf-8'
  '.woff' = 'font/woff'; '.woff2' = 'font/woff2'
}

$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "Serving $Root at http://localhost:$Port$Base  (Ctrl+C to stop)"

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $req = $ctx.Request
    $res = $ctx.Response
    try {
      $path = [Uri]::UnescapeDataString($req.Url.AbsolutePath)
      if ($path -eq $Base.TrimEnd('/')) {
        $res.StatusCode = 301; $res.RedirectLocation = $Base
      } elseif (-not $path.StartsWith($Base)) {
        $res.StatusCode = 404
      } else {
        $rel = $path.Substring($Base.Length)
        if ($rel -eq '' -or $rel.EndsWith('/')) { $rel += 'index.html' }
        $full = [IO.Path]::GetFullPath([IO.Path]::Combine($Root, ($rel -replace '/', [IO.Path]::DirectorySeparatorChar)))
        if (-not $full.StartsWith($Root)) {
          $res.StatusCode = 403
        } elseif (Test-Path -LiteralPath $full -PathType Leaf) {
          $ext = [IO.Path]::GetExtension($full).ToLowerInvariant()
          $res.ContentType = $mime[$ext] ?? 'application/octet-stream'
          $res.Headers.Add('Cache-Control', 'no-cache')
          $bytes = [IO.File]::ReadAllBytes($full)
          $res.ContentLength64 = $bytes.Length
          if ($req.HttpMethod -ne 'HEAD') { $res.OutputStream.Write($bytes, 0, $bytes.Length) }
        } else {
          $res.StatusCode = 404
        }
      }
      Write-Host ('{0} {1} {2}' -f $req.HttpMethod, $req.Url.AbsolutePath, $res.StatusCode)
    } catch {
      try { $res.StatusCode = 500 } catch {}
    } finally {
      $res.Close()
    }
  }
} finally {
  $listener.Stop()
}
