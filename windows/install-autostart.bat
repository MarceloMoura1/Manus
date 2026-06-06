@echo off
title MegaDesk - Configurar Inicio Automatico com Windows
color 0B

echo ============================================
echo   MegaDesk - Configurar Auto-Inicio
echo ============================================
echo.

:: Obter caminho absoluto do start-megadesk.bat
set SCRIPT_PATH=%~dp0start-megadesk.bat
set STARTUP_FOLDER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
set VBS_PATH=%STARTUP_FOLDER%\MegaDesk-AutoStart.vbs

echo Configurando inicio automatico com Windows...
echo Script: %SCRIPT_PATH%
echo Pasta Startup: %STARTUP_FOLDER%
echo.

:: Criar script VBScript para iniciar sem janela do CMD
echo Set oShell = CreateObject("WScript.Shell") > "%VBS_PATH%"
echo oShell.Run """" ^& "%SCRIPT_PATH%" ^& """", 1, False >> "%VBS_PATH%"

if exist "%VBS_PATH%" (
    echo [OK] Auto-inicio configurado com sucesso!
    echo.
    echo O MegaDesk sera iniciado automaticamente quando o Windows ligar.
    echo.
    echo Para REMOVER o auto-inicio, execute: uninstall-autostart.bat
) else (
    echo [ERRO] Nao foi possivel configurar o auto-inicio.
    echo Tente executar como Administrador.
)
echo.

:: Criar atalho na area de trabalho tambem
set DESKTOP=%USERPROFILE%\Desktop
echo Set oWShell = CreateObject("WScript.Shell") > "%TEMP%\CreateShortcut.vbs"
echo Set oShortcut = oWShell.CreateShortcut("%DESKTOP%\MegaDesk.lnk") >> "%TEMP%\CreateShortcut.vbs"
echo oShortcut.TargetPath = "%SCRIPT_PATH%" >> "%TEMP%\CreateShortcut.vbs"
echo oShortcut.WorkingDirectory = "%~dp0.." >> "%TEMP%\CreateShortcut.vbs"
echo oShortcut.Description = "Iniciar MegaDesk Platform" >> "%TEMP%\CreateShortcut.vbs"
echo oShortcut.Save >> "%TEMP%\CreateShortcut.vbs"
cscript //nologo "%TEMP%\CreateShortcut.vbs"
del "%TEMP%\CreateShortcut.vbs" >nul 2>&1

if exist "%DESKTOP%\MegaDesk.lnk" (
    echo [OK] Atalho criado na area de trabalho!
)

echo.
pause
