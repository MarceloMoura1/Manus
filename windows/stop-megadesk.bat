@echo off
title MegaDesk - Encerrando Plataforma
color 0C

echo ============================================
echo   MegaDesk - Encerrando todos os servicos
echo ============================================
echo.

echo [1/5] Encerrando MegaDesk (Node.js porta 3000)...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do (
    taskkill /PID %%a /F >nul 2>&1
)
echo      Processos na porta 3000 encerrados

echo [2/5] Encerrando Evolution API (porta 8080)...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8080" ^| findstr "LISTENING"') do (
    taskkill /PID %%a /F >nul 2>&1
)
echo      Processos na porta 8080 encerrados

echo [3/5] Encerrando n8n (porta 5678)...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5678" ^| findstr "LISTENING"') do (
    taskkill /PID %%a /F >nul 2>&1
)
echo      Processos na porta 5678 encerrados

echo [4/5] Encerrando Cloudflare Tunnel...
taskkill /IM cloudflared.exe /F >nul 2>&1
echo      cloudflared encerrado

echo [5/5] Encerrando processos tsx e node relacionados...
:: Fechar janelas do cmd abertas pelo start-megadesk.bat
taskkill /FI "WINDOWTITLE eq MegaDesk App" /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq Evolution API" /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq n8n" /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq Cloudflare Tunnel" /F >nul 2>&1
echo      Janelas auxiliares fechadas

echo.
echo ============================================
echo   Todos os servicos encerrados.
echo ============================================
echo.
timeout /t 3 /nobreak >nul
