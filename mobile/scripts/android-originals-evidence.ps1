param(
  [Parameter(Mandatory = $true)]
  [string]$Serial,

  [Parameter(Mandatory = $true)]
  [string]$FixturePath,

  [ValidateRange(1000, 15000)]
  [int]$IntervalMs = 3500,

  [ValidateRange(1, 10)]
  [int]$Loops = 1,

  [string]$AdbPath = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $AdbPath)) {
  throw "ADB was not found at $AdbPath"
}
if (-not (Test-Path -LiteralPath $FixturePath)) {
  throw "Location fixture was not found: $FixturePath"
}

$fixture = Get-Content -LiteralPath $FixturePath -Raw | ConvertFrom-Json
$samples = @($fixture.samples | Where-Object {
  $null -ne $_.lat -and $null -ne $_.lng
})
if ($samples.Count -lt 2) {
  throw 'The fixture must contain at least two samples with lat and lng.'
}

function Invoke-Adb {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
  $output = & $AdbPath -s $Serial @Arguments 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "ADB failed: adb -s $Serial $($Arguments -join ' ')`n$output"
  }
  return $output
}

$deviceState = (Invoke-Adb get-state | Out-String).Trim()
if ($deviceState -ne 'device') {
  throw "Android device $Serial is not ready (state: $deviceState)."
}

$previousMockOp = (Invoke-Adb shell appops get 2000 android:mock_location | Out-String).ToLowerInvariant()
$restoreMockOp = if ($previousMockOp -match '\ballow\b') { 'allow' }
  elseif ($previousMockOp -match '\bdeny\b') { 'deny' }
  elseif ($previousMockOp -match '\bignore\b') { 'ignore' }
  else { 'default' }
$providerAdded = $false

try {
  Invoke-Adb shell appops set 2000 android:mock_location allow | Out-Null
  Invoke-Adb shell cmd location providers add-test-provider gps --requiresSatellite --supportsSpeed --supportsBearing | Out-Null
  $providerAdded = $true
  Invoke-Adb shell cmd location providers set-test-provider-enabled gps true | Out-Null

  Write-Host "Injecting $($samples.Count) OS-level GPS fixes on $Serial. Keep the real Trailhead tour running."
  for ($loop = 0; $loop -lt $Loops; $loop += 1) {
    foreach ($sample in $samples) {
      $lat = [Convert]::ToString([double]$sample.lat, [Globalization.CultureInfo]::InvariantCulture)
      $lng = [Convert]::ToString([double]$sample.lng, [Globalization.CultureInfo]::InvariantCulture)
      $accuracyValue = if ($null -ne $sample.accuracy_m) { [double]$sample.accuracy_m } else { 8.0 }
      $accuracy = [Convert]::ToString([Math]::Max(1.0, $accuracyValue), [Globalization.CultureInfo]::InvariantCulture)
      $time = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
      Invoke-Adb shell cmd location providers set-test-provider-location gps --location "$lat,$lng" --accuracy $accuracy --time $time | Out-Null
      $phase = if ($sample.phase) { " [$($sample.phase)]" } else { '' }
      Write-Host "  $lat,$lng ±${accuracy}m$phase"
      Start-Sleep -Milliseconds $IntervalMs
    }
  }
}
finally {
  if ($providerAdded) {
    try { Invoke-Adb shell cmd location providers set-test-provider-enabled gps false | Out-Null } catch {}
    try { Invoke-Adb shell cmd location providers remove-test-provider gps | Out-Null } catch {}
  }
  try { Invoke-Adb shell appops set 2000 android:mock_location $restoreMockOp | Out-Null } catch {}
}

Write-Host 'GPS injection finished and the real provider was restored.'
