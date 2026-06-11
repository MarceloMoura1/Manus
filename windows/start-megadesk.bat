@echo off
title MegaDesk - Iniciando Plataforma
color 0A

echo ============================================
echo   MegaDesk - Iniciando todos os servicos
echo ============================================
echo.

:: ─── Verificar Node.js ───────────────────────────────────────────────────
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERRO] Node.js nao encontrado!
    echo Instale em: https://nodejs.org
    pause
    exit /b 1
)

:: ─── Verificar pnpm ──────────────────────────────────────────────────────
where pnpm >nul 2>&1
if %errorlevel% neq 0 (
    echo [INFO] Instalando pnpm...
    npm install -g pnpm
)

:: ─── Verificar cloudflared ───────────────────────────────────────────────
where cloudflared >nul 2>&1
if %errorlevel% neq 0 (
    echo [AVISO] cloudflared nao encontrado.
    echo Baixe em: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
    echo O tunnel nao sera iniciado.
    set CF_AVAILABLE=0
) else (
    set CF_AVAILABLE=1
)

:: ─── Definir diretório do projeto ────────────────────────────────────────
set PROJECT_DIR=%~dp0..
set EVOLUTION_DIR=%~dp0..\evolution-api

echo [1/5] Iniciando MySQL...
net start MySQL 2>nul || net start MySQL80 2>nul || net start MySQL57 2>nul
if %errorlevel% equ 0 (
    echo      MySQL iniciado com sucesso
) else (
    echo      MySQL ja esta rodando ou nome do servico diferente
)
echo.

:: ─── Criar pasta de logs ─────────────────────────────────────────────────
if not exist "%PROJECT_DIR%\logs" mkdir "%PROJECT_DIR%\logs"

echo [2/5] Iniciando MegaDesk (Frontend + Backend - porta 3000)...
start "MegaDesk App" cmd /k "cd /d "%PROJECT_DIR%" && pnpm dev > logs\megadesk.log 2>&1"
echo      Aguardando MegaDesk iniciar...
timeout /t 8 /nobreak >nul
echo      MegaDesk iniciado em http://localhost:3000
echo.

echo [3/5] Iniciando Evolution API (WhatsApp - porta 8080)...
if exist "%EVOLUTION_DIR%" (
    start "Evolution API" cmd /k "cd /d "%EVOLUTION_DIR%" && npm start > "%PROJECT_DIR%\logs\evolution.log" 2>&1"
    timeout /t 5 /nobreak >nul
    echo      Evolution API iniciada em http://localhost:8080
) else (
    echo      [AVISO] Pasta evolution-api nao encontrada em: %EVOLUTION_DIR%
    echo      Ignorando Evolution API...
)
echo.

echo [4/5] Iniciando n8n (Automacoes - porta 5678)...
where n8n >nul 2>&1
if %errorlevel% equ 0 (
    start "n8n" cmd /k "n8n > "%PROJECT_DIR%\logs\n8n.log" 2>&1"
    timeout /t 5 /nobreak >nul
    echo      n8n iniciado em http://localhost:5678
) else (
    echo      [INFO] n8n nao instalado. Instalando via npx...
    start "n8n" cmd /k "npx n8n > "%PROJECT_DIR%\logs\n8n.log" 2>&1"
    echo      n8n iniciando em http://localhost:5678
)
echo.

echo [5/5] Iniciando Cloudflare Tunnel...
if "%CF_AVAILABLE%"=="1" (
    if exist "%~dp0.cloudflared\config.yml" (
        start "Cloudflare Tunnel" cmd /k "cloudflared tunnel --config "%~dp0.cloudflared\config.yml" run megadesk-server > "%PROJECT_DIR%\logs\tunnel.log" 2>&1"
        timeout /t 5 /nobreak >nul
        echo      Tunnel iniciado
    ) else (
        start "Cloudflare Tunnel" cmd /k "cloudflared tunnel run megadesk-server > "%PROJECT_DIR%\logs\tunnel.log" 2>&1"
        timeout /t 5 /nobreak >nul
        echo      Tunnel iniciado (sem config.yml)
    )
) else (
    echo      cloudflared nao disponivel - tunnel ignorado
)
echo.

echo ============================================
echo   MegaDesk ONLINE!
echo ============================================
echo.
echo   Local:   http://localhost:3000
echo   App:     https://app.megadesk.online
echo   Admin:   https://admin.megadesk.online
echo   API:     https://api.megadesk.online
echo   n8n:     http://localhost:5678
echo.
echo   Logs disponíveis em: %PROJECT_DIR%\logs\
echo.
echo   Pressione qualquer tecla para fechar esta janela
echo   (os servicos continuarao rodando em segundo plano)
echo.
pause >nul
