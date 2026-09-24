# Puts a Fawanees icon on the Windows desktop, pointing at the built single file.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\desktop-shortcut.ps1
#
# Run `python build.py` and `node test/tools/makeIcons.js` first if dist/ is missing.
#
# Two Windows quirks this works around, both of which silently produce a broken shortcut:
#  - WScript.Shell saves through an ANSI path, so an Arabic filename arrives as "??????.lnk" and
#    Save() fails. The shortcut is written under an ASCII name and renamed with .NET afterwards,
#    which is Unicode-native.
#  - The script file's own encoding cannot be relied on to carry Arabic through every shell, so the
#    name is built from code points.
$ErrorActionPreference = 'Stop'

$root   = Split-Path -Parent $PSScriptRoot
$target = Join-Path $root 'dist\fawanees.html'
$icon   = Join-Path $root 'dist\fawanees.ico'
foreach ($f in @($target, $icon)) {
  if (-not (Test-Path $f)) { throw "missing $f - run: python build.py  and  node test/tools/makeIcons.js" }
}

# فوانيس
$name    = -join (0x0641, 0x0648, 0x0627, 0x0646, 0x064A, 0x0633 | ForEach-Object { [char]$_ })
$desktop = [Environment]::GetFolderPath('Desktop')
$final   = [IO.Path]::Combine($desktop, "$name.lnk")
$temp    = [IO.Path]::Combine($desktop, 'fawanees-shortcut-tmp.lnk')

if ([IO.File]::Exists($temp)) { [IO.File]::Delete($temp) }
$sh = New-Object -ComObject WScript.Shell
$s  = $sh.CreateShortcut($temp)
$s.TargetPath       = $target
$s.IconLocation     = "$icon,0"
$s.WorkingDirectory = Join-Path $root 'dist'
$s.Description      = 'Fawanees - a two-player game of light and shadow, invented by an AI'
$s.Save()

if ([IO.File]::Exists($final)) { [IO.File]::Delete($final) }
[IO.File]::Move($temp, $final)

# Explorer caches icons by path, so tell it the file changed or it keeps showing the old one.
Add-Type -Namespace Shell32 -Name Api -MemberDefinition @'
[DllImport("shell32.dll")]
public static extern void SHChangeNotify(int eventId, uint flags, IntPtr item1, IntPtr item2);
'@
[Shell32.Api]::SHChangeNotify(0x08000000, 0x0000, [IntPtr]::Zero, [IntPtr]::Zero)  # SHCNE_ASSOCCHANGED

Write-Output ("shortcut : " + $final)
Write-Output ("exists   : " + [IO.File]::Exists($final))
Write-Output ("target   : " + $target)
Write-Output ("icon     : " + $icon)
Write-Output ("size     : " + ([IO.FileInfo]$final).Length + " bytes")
