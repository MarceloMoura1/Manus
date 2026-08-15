# MegaDesk — Guia de Instalação

## Pré-requisitos

| Software | Versão mínima | Link |
|----------|--------------|------|
| Node.js | 20 LTS | https://nodejs.org |
| pnpm | 10+ | `npm install -g pnpm` |
| MySQL | 8.0+ | https://dev.mysql.com/downloads/ |
| Git | 2.0+ | https://git-scm.com |
| cloudflared | Última | https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/ |

## Windows

### 1. Pré-requisitos
```powershell
# Instalar Node.js via winget
winget install OpenJS.NodeJS.LTS

# Instalar pnpm
npm install -g pnpm

# Instalar MySQL Community Server 8.0
# Download: https://dev.mysql.com/downloads/installer/
```

### 2. Clonar o projeto
```cmd
git clone -b cursor/megadesk-stabilization-5131 https://github.com/MarceloMoura1/Manus.git megadesk
cd megadesk
```

### 3. Configurar banco
```sql
-- No MySQL Workbench ou linha de comando:
CREATE DATABASE megadesk_main CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'megadesk'@'localhost' IDENTIFIED BY 'SuaSenha123';
GRANT ALL PRIVILEGES ON `megadesk_%`.* TO 'megadesk'@'localhost';
FLUSH PRIVILEGES;
```

### 4. Configurar ambiente
```cmd
copy .env.example .env
:: Edite .env com seu editor preferido
:: Obrigatório: DATABASE_URL e JWT_SECRET
```

### 5. Instalar e iniciar
```cmd
pnpm install
pnpm db:validate
pnpm db:migrate:main
ADMIN_EMAIL=seu@email.com ADMIN_PASSWORD=SuaSenha123 node seed-admin.mjs
pnpm dev
```

### 6. Inicialização automática (Windows)
```cmd
:: Execute como Administrador:
windows\install-autostart.bat
```

## Linux/Ubuntu

### 1. Pré-requisitos
```bash
# Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# pnpm
npm install -g pnpm

# MySQL 8.0
sudo apt-get install -y mysql-server
sudo systemctl start mysql
sudo systemctl enable mysql
```

### 2. Configurar banco
```bash
sudo mysql -e "CREATE DATABASE megadesk_main CHARACTER SET utf8mb4;"
sudo mysql -e "CREATE USER 'megadesk'@'localhost' IDENTIFIED BY 'SuaSenha123';"
sudo mysql -e "GRANT ALL ON \`megadesk_%\`.* TO 'megadesk'@'localhost';"
sudo mysql -e "FLUSH PRIVILEGES;"
```

### 3. Clonar e configurar
```bash
git clone -b cursor/megadesk-stabilization-5131 https://github.com/MarceloMoura1/Manus.git megadesk
cd megadesk
cp .env.example .env
nano .env  # Configure DATABASE_URL e JWT_SECRET
```

### 4. Instalar e iniciar
```bash
pnpm install
pnpm db:validate
pnpm db:migrate:main
ADMIN_EMAIL=seu@email.com ADMIN_PASSWORD=SuaSenha123 node seed-admin.mjs
pnpm dev
```

## Login multi-tenant

O login da MegaDesk exige o identificador público da empresa (`clientId`) junto com e-mail e senha. Esse identificador é emitido pelo provisionamento e deve ser entregue ao administrador do tenant. E-mail isolado não resolve tenant e não há fallback que selecione o primeiro cadastro encontrado.

## Variáveis de ambiente obrigatórias

| Variável | Descrição |
|----------|-----------|
| `DATABASE_URL` | `mysql://megadesk:SENHA@127.0.0.1:3306/megadesk_main` |
| `JWT_SECRET` | String longa e aleatória para JWT (mín. 32 chars) |
| `NODE_ENV` | `development` ou `production` |

Ver arquivo `.env.example` para todas as variáveis.
