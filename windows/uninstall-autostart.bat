@echo off
title MegaDesk - Remover Inicio Automatico
color 0E

set STARTUP_FOLDER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
set VBS_PATH=%STARTUP_FOLDER%\MegaDesk-AutoStart.vbs
set DESKTOP=%USERPROFILE%\Desktop

echo Removendo auto-inicio do MegaDesk...

if exist "%VBS_PATH%" (
    del "%VBS_PATH%"
    echo [OK] Auto-inicio removido da pasta Startup
) else (
    echo [INFO] Nenhum auto-inicio configurado encontrado
)

if exist "%DESKTOP%\MegaDesk.lnk" (
    del "%DESKTOP%\MegaDesk.lnk"
    echo [OK] Atalho da area de trabalho removido
)

echo.
echo MegaDesk nao iniciara mais automaticamente com o Windows.
echo.
pause
