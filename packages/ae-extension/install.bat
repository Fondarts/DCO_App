@echo off
echo === DCO Panel Installer ===
echo.

REM Enable unsigned CEP extensions
echo Enabling unsigned extensions...
reg add HKCU\Software\Adobe\CSXS.11 /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
reg add HKCU\Software\Adobe\CSXS.12 /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1

REM Create symlink to extensions folder
set TARGET=%APPDATA%\Adobe\CEP\extensions\com.dco.panel
set SOURCE=%~dp0

if exist "%TARGET%" (
  echo Removing existing extension link...
  rmdir "%TARGET%" 2>nul
  del "%TARGET%" 2>nul
)

echo Creating extension link...
echo   From: %SOURCE%
echo   To:   %TARGET%
mklink /J "%TARGET%" "%SOURCE%"

if %ERRORLEVEL% EQU 0 (
  echo.
  echo Installation complete!
  echo Restart After Effects and open:
  echo   Window ^> Extensions ^> DCO
) else (
  echo.
  echo ERROR: Failed to create link. Try running as Administrator.
)

echo.
pause
