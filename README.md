# MegaDesk Platform

**Hub Operacional Inteligente para Empresas** — SaaS multi-tenant com WhatsApp, CRM, Chamados, IA e automações.

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Frontend | React 19 + Vite 7 + TailwindCSS 4 + shadcn/ui |
| Backend | Express 4 + tRPC 11 + DrizzleORM |
| Banco | MySQL 8.0+ |
| WhatsApp | Evolution API v2 |
| IA | Google Gemini |
| Auth | JWT (MegaAdmin) + bcrypt (clientes) |

## Início rápido

```bash
# 1. Clonar e entrar na pasta
git clone https://github.com/MarceloMoura1/megadesk.git
cd megadesk

# 2. Configurar variáveis de ambiente
cp .env.example .env
# Edite .env com suas configurações (especialmente DATABASE_URL e JWT_SECRET)

# 3. Instalar dependências
pnpm install

# 4. Criar banco de dados MySQL
mysql -u root -p -e "CREATE DATABASE megadesk_main CHARACTER SET utf8mb4;"
mysql -u root -p -e "CREATE USER 'megadesk'@'localhost' IDENTIFIED BY 'SuaSenha';"
mysql -u root -p -e "GRANT ALL ON \`megadesk_%\`.* TO 'megadesk'@'localhost';"

# 5. Aplicar schema
pnpm db:push

# 6. Criar admin inicial
ADMIN_EMAIL=seu@email.com ADMIN_PASSWORD=SuaSenha node seed-admin.mjs

# 7. Iniciar
pnpm dev
```

Acesse: http://localhost:3000 (plataforma) | http://localhost:3000/admin (painel)

## Documentação

| Arquivo | Conteúdo |
|---------|----------|
| [INSTALL.md](docs/INSTALL.md) | Instalação completa (Windows e Linux) |
| [DEPLOY-VPS.md](docs/DEPLOY-VPS.md) | Deploy na VPS Contabo (Ubuntu 24.04) |
| [DATABASE.md](docs/DATABASE.md) | Banco de dados, schema e migrations |
| [BACKUP.md](docs/BACKUP.md) | Estratégia de backup |
| [.env.example](.env.example) | Variáveis de ambiente |

## URLs de produção (via Cloudflare Tunnel)

| URL | Propósito |
|-----|-----------|
| https://app.megadesk.online | Plataforma dos clientes |
| https://admin.megadesk.online | Painel MegaAdmin |
| https://api.megadesk.online | API e webhooks |

## Scripts disponíveis

```bash
pnpm dev        # Desenvolvimento (tsx watch + Vite HMR)
pnpm build      # Build de produção
pnpm start      # Iniciar em produção
pnpm db:push    # Aplicar schema no banco
pnpm test       # Testes unitários
```
