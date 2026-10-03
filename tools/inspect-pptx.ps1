$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$path = 'C:\Users\Administrator\Downloads\1999-1.4(new).pptx'
$zip = [System.IO.Compression.ZipFile]::OpenRead($path)
try {
  $entries = $zip.Entries
  $names = $entries | ForEach-Object { $_.FullName }
  $result = [ordered]@{
    file = $path
    bytes = (Get-Item $path).Length
    entries = $names.Count
    slides = ($names | Where-Object { $_ -match '^ppt/slides/slide\d+\.xml$' }).Count
    layouts = ($names | Where-Object { $_ -match '^ppt/slideLayouts/slideLayout\d+\.xml$' }).Count
    masters = ($names | Where-Object { $_ -match '^ppt/slideMasters/' }).Count
    mediaCount = ($names | Where-Object { $_ -match '^ppt/media/' }).Count
    mediaBytes = 0
    themeColors = @{}
    themeFonts = @{}
    sizeEmu = $null
  }
  foreach ($e in $entries) { if ($e.FullName -like 'ppt/media/*') { $result.mediaBytes += $e.Length } }
  function Read-Entry($name) {
    $entry = $zip.GetEntry($name)
    if (-not $entry) { return $null }
    $stream = $entry.Open()
    $reader = New-Object System.IO.StreamReader($stream)
    $text = $reader.ReadToEnd()
    $reader.Close(); $stream.Close()
    return $text
  }
  $theme = Read-Entry 'ppt/theme/theme1.xml'
  if ($theme) {
    $scheme = [regex]::Match($theme, '<a:clrScheme[\s\S]*?</a:clrScheme>').Value
    foreach ($m in [regex]::Matches($scheme, '<a:(dk1|lt1|dk2|lt2|accent1|accent2|accent3|accent4|accent5|accent6|hlink|folHlink)>[\s\S]*?val="([0-9A-Fa-f]{6})"')) {
      $result.themeColors[$m.Groups[1].Value] = '#' + $m.Groups[2].Value.ToUpper()
    }
    $fontScheme = [regex]::Match($theme, '<a:fontScheme[\s\S]*?</a:fontScheme>').Value
    $major = [regex]::Match($fontScheme, '<a:majorFont>[\s\S]*?<a:latin typeface="([^"]*)"[\s\S]*?<a:ea typeface="([^"]*)"').Groups
    $minor = [regex]::Match($fontScheme, '<a:minorFont>[\s\S]*?<a:latin typeface="([^"]*)"[\s\S]*?<a:ea typeface="([^"]*)"').Groups
    if ($major.Count -ge 3) { $result.themeFonts.major = @{ latin = $major[1].Value; ea = $major[2].Value } }
    if ($minor.Count -ge 3) { $result.themeFonts.minor = @{ latin = $minor[1].Value; ea = $minor[2].Value } }
  }
  $pres = Read-Entry 'ppt/presentation.xml'
  if ($pres) {
    $m = [regex]::Match($pres, '<p:sldSz cx="(\d+)" cy="(\d+)"')
    if ($m.Success) { $result.sizeEmu = @{ cx = [int]$m.Groups[1].Value; cy = [int]$m.Groups[2].Value } }
  }
  $colorCount = @{}
  $fontCount = @{}
  $slideTextLength = 0
  $slideXmlBytes = 0
  foreach ($name in ($names | Where-Object { $_ -match '^ppt/slides/slide\d+\.xml$' })) {
    $xml = Read-Entry $name
    if (-not $xml) { continue }
    $slideXmlBytes += $xml.Length
    foreach ($m in [regex]::Matches($xml, 'srgbClr val="([0-9A-Fa-f]{6})"')) {
      $key = '#' + $m.Groups[1].Value.ToUpper()
      if ($colorCount.ContainsKey($key)) { $colorCount[$key]++ } else { $colorCount[$key] = 1 }
    }
    foreach ($m in [regex]::Matches($xml, 'typeface="([^"]{1,60})"')) {
      $key = $m.Groups[1].Value
      if ($fontCount.ContainsKey($key)) { $fontCount[$key]++ } else { $fontCount[$key] = 1 }
    }
    $texts = [regex]::Matches($xml, '<a:t>([\s\S]*?)</a:t>')
    foreach ($t in $texts) { $slideTextLength += $t.Groups[1].Value.Length }
  }
  $result.topColors = $colorCount.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 12 | ForEach-Object { @{ color = $_.Key; count = $_.Value } }
  $result.topFonts = $fontCount.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 12 | ForEach-Object { @{ font = $_.Key; count = $_.Value } }
  $result.slideXmlBytes = $slideXmlBytes
  $result.totalSlideTextChars = $slideTextLength
  $json = $result | ConvertTo-Json -Depth 6
  Set-Content -Path 'C:\Users\Administrator\Downloads\StudyMate-Web\docs\style-evidence.json' -Value $json -Encoding utf8NoBOM
  Write-Output ("slides=" + $result.slides + " layouts=" + $result.layouts + " media=" + $result.mediaCount + " mediaGB=" + [math]::Round($result.mediaBytes/1GB,2) + " slideXmlKB=" + [math]::Round($result.slideXmlBytes/1KB,0))
  Write-Output ("size=" + $result.sizeEmu.cx + "x" + $result.sizeEmu.cy + " textChars=" + $result.totalSlideTextChars)
  Write-Output ("theme: " + ($result.themeColors.GetEnumerator() | ForEach-Object { $_.Key + '=' + $_.Value }) -join ' ')
  Write-Output ("fonts: " + (($result.topFonts | ForEach-Object { $_.font + '(' + $_.count + ')' }) -join ', '))
  Write-Output ("colors: " + (($result.topColors | ForEach-Object { $_.color + '(' + $_.count + ')' }) -join ', '))
} finally { $zip.Dispose() }
