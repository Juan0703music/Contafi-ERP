<#
  Contafi — Fase 0: prueba de la IA local en el PC de 8 GB (sección 12 del plan).

  Qué hace:
    1. Descarga la última versión de llama.cpp para Windows (CPU x64) desde GitHub.
    2. Descarga un modelo GGUF de ~4B parámetros (por defecto Qwen3-4B Q4_K_M, ~2,5 GB, licencia Apache 2.0).
       La descarga usa BITS, que se puede reanudar si se corta.
    3. Mide velocidad con llama-bench.
    4. Levanta llama-server en 127.0.0.1 y hace 3 preguntas en español con una herramienta
       "saldo_cuenta": mide el tiempo de respuesta, si eligió la herramienta y la RAM usada.

  Criterio de salida de la Fase 0: respuesta en menos de 10 segundos en un PC de 8 GB.

  Uso (PowerShell):
    powershell -ExecutionPolicy Bypass -File .\probar-ia.ps1
    powershell -ExecutionPolicy Bypass -File .\probar-ia.ps1 -ModeloUrl "<otra URL .gguf>"

  Verifica antes de usar: que la URL del modelo siga vigente y su licencia permita uso comercial.
#>
param(
  [string]$ModeloUrl = "https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-Q4_K_M.gguf",
  [string]$Carpeta = "$env:LOCALAPPDATA\ContafiPOC\ia",
  [int]$Hilos = 0
)
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
New-Item -ItemType Directory -Force -Path $Carpeta | Out-Null
$informe = Join-Path $Carpeta "informe-ia.txt"
function Anotar([string]$t) { Write-Host $t; Add-Content -Path $informe -Value $t -Encoding UTF8 }
Set-Content -Path $informe -Value "Contafi — prueba de IA local — $(Get-Date -Format 'yyyy-MM-dd HH:mm')" -Encoding UTF8

# --- Hardware
$cs = Get-CimInstance Win32_ComputerSystem
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$os = Get-CimInstance Win32_OperatingSystem
Anotar ("Equipo: {0} · RAM {1:N1} GB · {2} ({3} núcleos / {4} hilos) · {5}" -f `
  $cs.Model, ($cs.TotalPhysicalMemory / 1GB), $cpu.Name.Trim(), $cpu.NumberOfCores, $cpu.NumberOfLogicalProcessors, $os.Caption)
if ($Hilos -le 0) { $Hilos = [Math]::Max(1, $cpu.NumberOfCores) }

# --- 1. llama.cpp
$bin = Join-Path $Carpeta "llama.cpp"
if (-not (Test-Path (Join-Path $bin "llama-server.exe"))) {
  Write-Host "Descargando llama.cpp..."
  $rel = Invoke-RestMethod "https://api.github.com/repos/ggml-org/llama.cpp/releases/latest" -Headers @{ "User-Agent" = "contafi-poc" }
  $asset = $rel.assets | Where-Object { $_.name -match "bin-win-cpu-x64\.zip$" } | Select-Object -First 1
  if (-not $asset) { throw "No se encontró el binario de Windows CPU x64 en la última versión de llama.cpp." }
  $zip = Join-Path $Carpeta $asset.name
  Invoke-WebRequest $asset.browser_download_url -OutFile $zip
  Expand-Archive $zip -DestinationPath $bin -Force
  Anotar "llama.cpp: $($rel.tag_name)"
}
$server = Get-ChildItem $bin -Recurse -Filter "llama-server.exe" | Select-Object -First 1
$bench = Get-ChildItem $bin -Recurse -Filter "llama-bench.exe" | Select-Object -First 1

# --- 2. Modelo (BITS: reanudable)
$modelo = Join-Path $Carpeta ([IO.Path]::GetFileName(([Uri]$ModeloUrl).AbsolutePath))
if (-not (Test-Path $modelo)) {
  Write-Host "Descargando el modelo (puede tardar)..."
  Start-BitsTransfer -Source $ModeloUrl -Destination $modelo -DisplayName "Contafi modelo IA"
}
Anotar ("Modelo: {0} ({1:N2} GB)" -f (Split-Path $modelo -Leaf), ((Get-Item $modelo).Length / 1GB))
Anotar ("SHA-256 del modelo: {0}" -f (Get-FileHash $modelo -Algorithm SHA256).Hash)

# --- 3. Velocidad bruta
Anotar "`n== llama-bench (pp = lectura del prompt, tg = generación; t/s = tokens por segundo) =="
& $bench.FullName -m $modelo -p 256 -n 64 -t $Hilos -o md 2>$null | ForEach-Object { Anotar $_ }

# --- 4. Preguntas reales con herramienta
$puerto = Get-Random -Minimum 20000 -Maximum 60000
$token = [guid]::NewGuid().ToString("N")
$proc = Start-Process -FilePath $server.FullName -PassThru -WindowStyle Hidden -ArgumentList @(
  "-m", "`"$modelo`"", "--host", "127.0.0.1", "--port", $puerto, "--api-key", $token,
  "-c", "4096", "-t", $Hilos, "--jinja"
)
try {
  $base = "http://127.0.0.1:$puerto"
  $cabeceras = @{ Authorization = "Bearer $token" }
  $inicio = Get-Date
  do {
    Start-Sleep -Milliseconds 500
    try { $listo = (Invoke-RestMethod "$base/health" -Headers $cabeceras).status -eq "ok" } catch { $listo = $false }
  } until ($listo -or ((Get-Date) - $inicio).TotalSeconds -gt 180)
  if (-not $listo) { throw "llama-server no arrancó en 3 minutos." }
  Anotar ("`nCarga del modelo: {0:N1} s" -f ((Get-Date) - $inicio).TotalSeconds)

  $herramientas = @(@{
    type = "function"
    function = @{
      name = "saldo_cuenta"
      description = "Devuelve el saldo de una cuenta contable del PUC a una fecha."
      parameters = @{
        type = "object"
        properties = @{
          cuenta = @{ type = "string"; description = "Código PUC, por ejemplo 1110 (bancos) o 1305 (clientes)" }
          fecha = @{ type = "string"; description = "Fecha de corte AAAA-MM-DD" }
        }
        required = @("cuenta")
      }
    }
  })
  $sistema = "Eres Jarvis, asesor contable de Contafi para Colombia. Nunca inventes cifras: usa las herramientas para cualquier valor. Responde en español, breve."
  $preguntas = @(
    "¿Cuánta plata tenemos en bancos hoy?",
    "¿Cuánto nos deben los clientes al 30 de septiembre de 2026?",
    "Explícame en dos frases qué es la retención en la fuente."
  )
  Anotar "`n== Preguntas (meta: menos de 10 s en respuestas cortas) =="
  foreach ($p in $preguntas) {
    $cuerpo = @{
      messages = @(@{ role = "system"; content = $sistema }, @{ role = "user"; content = $p })
      tools = $herramientas
      max_tokens = 200
      temperature = 0.2
      chat_template_kwargs = @{ enable_thinking = $false }   # Qwen3: sin "modo pensamiento" para responder rápido
    } | ConvertTo-Json -Depth 10
    $cron = [Diagnostics.Stopwatch]::StartNew()
    $r = Invoke-RestMethod "$base/v1/chat/completions" -Method Post -Headers $cabeceras -ContentType "application/json; charset=utf-8" -Body ([Text.Encoding]::UTF8.GetBytes($cuerpo))
    $cron.Stop()
    $m = $r.choices[0].message
    $llamada = if ($m.tool_calls) { "$($m.tool_calls[0].function.name)($($m.tool_calls[0].function.arguments))" } else { "ninguna" }
    Anotar ("`n» {0}`n  Tiempo: {1:N1} s · Herramienta: {2} · Tokens generados: {3}" -f $p, $cron.Elapsed.TotalSeconds, $llamada, $r.usage.completion_tokens)
    if ($m.content) { Anotar ("  Respuesta: {0}" -f ($m.content -replace "\s+", " ").Trim()) }
  }
  $ram = (Get-Process -Id $proc.Id).WorkingSet64 / 1GB
  Anotar ("`nRAM de llama-server: {0:N2} GB" -f $ram)
}
finally {
  if ($proc -and -not $proc.HasExited) { Stop-Process -Id $proc.Id -Force }
}
Anotar "`nInforme guardado en: $informe"
Write-Host "Copia el contenido del informe en docs/fase-0/informe-prueba-tecnica.md"
