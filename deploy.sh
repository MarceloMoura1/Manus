#!/usr/bin/env bash
# =============================================================================
# MegaDesk Platform — Script Automatizado de Deploy VPS
# =============================================================================
# Uso na VPS (ex.: Oracle Cloud / Ubuntu):
#   bash deploy.sh
#   ou: ./deploy.sh [branch]
# =============================================================================

set -euo pipefail

TARGET_BRANCH="${1:-release/updater-v2-bootstrap}"
PROJECT_DIR="${MEGADESK_DIR:-/opt/megadesk}"

# Se o script for executado a partir do próprio repositório, usa o diretório atual
if [ -f "package.json" ] && [ -d ".git" ]; then
  PROJECT_DIR="$(pwd)"
fi

echo "=========================================================="
echo "  Iniciando Deploy do MegaDesk na VPS"
echo "  Diretório : ${PROJECT_DIR}"
echo "  Branch    : ${TARGET_BRANCH}"
echo "  Data/Hora : $(date '+%Y-%m-%d %H:%M:%S')"
echo "=========================================================="

cd "${PROJECT_DIR}"

# 1. Validação de pré-requisitos essenciais
echo ""
echo "[1/6] Verificando pré-requisitos..."
command -v git >/dev/null 2>&1 || { echo "ERRO: git não está instalado."; exit 1; }
command -v pnpm >/dev/null 2>&1 || { echo "ERRO: pnpm não está instalado. Instale com 'npm install -g pnpm'."; exit 1; }
command -v node >/dev/null 2>&1 || { echo "ERRO: node não está instalado."; exit 1; }

if [ ! -f ".env" ]; then
  echo "AVISO: Arquivo .env não encontrado em ${PROJECT_DIR}."
  if [ -f ".env.example" ]; then
    echo "DICA: Crie seu .env a partir de .env.example antes de iniciar a aplicação:"
    echo "      cp .env.example .env && nano .env"
  fi
fi

# 2. Sincronizar repositório Git
echo ""
echo "[2/6] Atualizando código-fonte via Git..."
git fetch origin "${TARGET_BRANCH}"
git checkout "${TARGET_BRANCH}"
git pull origin "${TARGET_BRANCH}"

# 3. Instalar dependências congeladas
echo ""
echo "[3/6] Instalando dependências (pnpm install --frozen-lockfile)..."
pnpm install --frozen-lockfile

# 4. Compilar aplicação para produção
echo ""
echo "[4/6] Compilando frontend e backend (pnpm run build)..."
pnpm run build

# 5. Reiniciar o serviço de aplicação
echo ""
echo "[5/6] Reiniciando serviço do MegaDesk..."
if command -v pm2 >/dev/null 2>&1; then
  if pm2 describe megadesk >/dev/null 2>&1; then
    echo "Recarregando processo PM2: megadesk..."
    pm2 reload megadesk || pm2 restart megadesk
  elif [ -f "ecosystem.config.cjs" ]; then
    echo "Iniciando processo PM2 com ecosystem.config.cjs..."
    pm2 start ecosystem.config.cjs
    pm2 save || true
  else
    echo "AVISO: Processo PM2 'megadesk' não encontrado e 'ecosystem.config.cjs' ausente."
  fi
elif [ -f "docker-compose.yml" ] && command -v docker >/dev/null 2>&1; then
  echo "Reiniciando containers via Docker Compose..."
  docker compose restart app || docker compose up -d --build
else
  echo "AVISO: Nem PM2 nem Docker Compose foram identificados para restart automático."
  echo "Reinicie manualmente seu processo Node."
fi

# 6. Status final
echo ""
echo "[6/6] Verificação de status:"
if command -v pm2 >/dev/null 2>&1 && pm2 describe megadesk >/dev/null 2>&1; then
  pm2 status megadesk
fi

echo ""
echo "=========================================================="
echo "  Deploy finalizado com sucesso! (Versão: $(git rev-parse --short HEAD))"
echo "=========================================================="
