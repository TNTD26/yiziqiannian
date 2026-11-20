@echo off
chcp 936 >nul
rem 为「一字千年 · AI 甲骨文数字生命馆」创建桌面快捷方式
setlocal
set "ROOT=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$w = New-Object -ComObject WScript.Shell; $s = $w.CreateShortcut([IO.Path]::Combine([Environment]::GetFolderPath('Desktop'), '一字千年.lnk')); $s.TargetPath = $env:ROOT + '一字千年.exe'; $s.WorkingDirectory = $env:ROOT; $s.IconLocation = $env:ROOT + 'favicon.ico'; $s.Description = '一字千年 · AI 甲骨文数字生命馆'; $s.Save()"
if %errorlevel%==0 (
  echo.
  echo   已在桌面创建快捷方式「一字千年」，双击即可打开软件。
) else (
  echo.
  echo   创建失败，可直接双击「一字千年.exe」运行软件。
)
timeout /t 4 >nul
