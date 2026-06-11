# MegaDesk — Deploy VPS Contabo (Ubuntu 24.04)

## Checklist de deploy

### 1. Preparar o servidor

```bash
# Atualizar sistema
sudo apt update && sudo apt upgrade -y

# Instalar dependências
sudo apt install -y git curl wget nginx certbot python3-certbot-nginx

# Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
npm install -g pnpm pm2

# MySQL 8.0
sudo apt install -y mysql-server
sudo systemctl start mysql
sudo systemctl enable mysql

# cloudflared
wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared-linux-amd64.deb
```

### 2. Configurar banco de dados

```bash
sudo mysql -e "CREATE DATABASE megadesk_main CHARACTER SET utf8mb4;"
sudo mysql -e "CREATE USER 'megadesk'@'localhost' IDENTIFIED BY 'SENHA_FORTE_AQUI';"
sudo mysql -e "GRANT ALL ON \`megadesk_%\`.* TO 'megadesk'@'localhost';"
sudo mysql -e "FLUSH PRIVILEGES;"
```

### 3. Clonar o projeto

```bash
cd /opt
sudo git clone -b cursor/megadesk-stabilization-5131 https://github.com/MarceloMoura1/Manus.git megadesk
sudo chown -R $USER:$USER /opt/megadesk
cd /opt/megadesk
```

### 4. Configurar variáveis de ambiente

```bash
cp .env.example .env
nano .env
```

```env
NODE_ENV=production
DATABASE_URL=mysql://megadesk:SENHA@127.0.0.1:3306/megadesk_main
JWT_SECRET=GERE_COM_openssl_rand_-base64_64
PORT=3000
APP_URL=https://app.megadesk.online
ADMIN_URL=https://admin.megadesk.online
API_URL=https://api.megadesk.online
COOKIE_DOMAIN=.megadesk.online
EVOLUTION_API_URL=http://localhost:8080
EVOLUTION_API_KEY=SUA_EVOLUTION_API_KEY
WEBHOOK_BASE_URL=https://api.megadesk.online
```

### 5. Instalar dependências e preparar banco

```bash
pnpm install --frozen-lockfile
pnpm db:push
ADMIN_EMAIL=seu@email.com ADMIN_PASSWORD=SuaSenha node seed-admin.mjs
```

### 6. Build de produção

```bash
pnpm build
```

### 7. Configurar PM2

```bash
# Criar arquivo de configuração PM2
cat > ecosystem.config.cjs << 'EOF'
module.exports = {
  apps: [{
    name: 'megadesk',
    script: 'dist/index.js',
    instances: 1,
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    error_file: '/var/log/megadesk/error.log',
    out_file: '/var/log/megadesk/out.log',
    restart_delay: 5000,
    max_memory_restart: '1G'
  }]
};
EOF

sudo mkdir -p /var/log/megadesk
sudo chown $USER:$USER /var/log/megadesk

pm2 start ecosystem.config.cjs
pm2 save
pm2 startup  # Siga as instruções para auto-start
```

### 8. Configurar Cloudflare Tunnel

```bash
# Login
cloudflared tunnel login

# Criar tunnel (se não existir)
cloudflared tunnel create megadesk

# Configurar rotas
cloudflared tunnel route dns megadesk app.megadesk.online
cloudflared tunnel route dns megadesk admin.megadesk.online
cloudflared tunnel route dns megadesk api.megadesk.online

# Criar config
cat > ~/.cloudflared/config.yml << 'EOF'
tunnel: SEU_TUNNEL_ID
credentials-file: /home/SEU_USER/.cloudflared/SEU_TUNNEL_ID.json

ingress:
  - hostname: app.megadesk.online
    service: http://localhost:3000
  - hostname: admin.megadesk.online
    service: http://localhost:3000
  - hostname: api.megadesk.online
    service: http://localhost:3000
  - service: http_status:404
EOF

# Instalar como serviço
sudo cloudflared service install
sudo systemctl start cloudflared
sudo systemctl enable cloudflared
```

### 9. Evolution API (WhatsApp)

```bash
cd /opt
git clone https://github.com/EvolutionAPI/evolution-api.git
cd evolution-api
# Configurar .env conforme documentação da Evolution API
# DATABASE_PROVIDER=mysql
# AUTHENTICATION_API_KEY=SUA_KEY_AQUI
npm install
npm start
```

Para PM2:
```bash
pm2 start npm --name "evolution-api" -- start
pm2 save
```

## Checklist final antes de ir ao ar

- [ ] `pnpm build` sem erros
- [ ] `pnpm test` passando
- [ ] `.env` configurado (sem valores padrão)
- [ ] MySQL rodando e banco criado
- [ ] `pnpm db:push` executado
- [ ] Admin criado com `seed-admin.mjs`
- [ ] PM2 rodando (`pm2 status`)
- [ ] Cloudflare Tunnel ativo
- [ ] https://app.megadesk.online respondendo 200
- [ ] https://admin.megadesk.online respondendo 200
- [ ] https://api.megadesk.online respondendo 200
- [ ] Login admin funcionando
- [ ] Evolution API rodando
- [ ] Backup configurado

## Comandos úteis

```bash
pm2 logs megadesk          # Ver logs
pm2 restart megadesk       # Reiniciar
pm2 monit                  # Monitoramento
cloudflared tunnel list    # Status do tunnel
mysql megadesk_main -e "SHOW TABLES;"  # Verificar banco
```
