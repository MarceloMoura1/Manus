# MegaDesk — Relatório de Arquitetura (Etapa 1)

## Serviços e Portas

| Serviço          | Comando de início                          | Porta | Obrigatório |
|------------------|--------------------------------------------|-------|-------------|
| MegaDesk (App)   | `pnpm dev`                                 | 3000  | ✅ Sim      |
| Evolution API    | `node server.js` (pasta evolution-api)     | 8080  | ✅ Sim (WhatsApp) |
| MySQL            | Serviço do Windows                         | 3306  | ✅ Sim      |
| n8n              | `npx n8n`                                  | 5678  | ⚡ Opcional |
| Cloudflare Tunnel| `cloudflared tunnel run megadesk-server`   | —     | ✅ Sim (produção) |

## Comandos de Início

### MegaDesk (Frontend + Backend juntos — porta 3000)
```bash
pnpm dev
# equivalente: NODE_ENV=development tsx watch server/_core/index.ts
```

### Evolution API (WhatsApp — porta 8080)
```bash
# Na pasta da Evolution API:
npm start
# ou
node server.js
```

### n8n (Automações — porta 5678)
```bash
npx n8n
# ou se instalado globalmente:
n8n
```

### Cloudflare Tunnel
```bash
cloudflared tunnel --config config.yml run megadesk-server
```

## Variáveis de Ambiente Obrigatórias (.env)

```env
# Banco de dados MySQL
DATABASE_URL=mysql://megadesk:senha@localhost:3306/megadesk_main

# Autenticação JWT
JWT_SECRET=sua-chave-secreta-aqui

# Node environment
NODE_ENV=development

# App ID
VITE_APP_ID=megadesk-prod

# Evolution API (WhatsApp)
EVOLUTION_API_URL=http://localhost:8080
EVOLUTION_API_KEY=sua-api-key-evolution

# Webhook URL (para Evolution enviar eventos)
WEBHOOK_BASE_URL=https://api.megadesk.online

# Domínios
APP_URL=https://app.megadesk.online
ADMIN_URL=https://admin.megadesk.online
API_URL=https://api.megadesk.online
COOKIE_DOMAIN=.megadesk.online
```

## Serviços Necessários para Funcionar

1. **MySQL** — banco de dados principal (tabelas MegaDesk)
2. **MegaDesk** (porta 3000) — frontend React + backend tRPC + API
3. **Evolution API** (porta 8080) — gerencia WhatsApp (QR Code, mensagens)
4. **Cloudflare Tunnel** — expõe localhost:3000 para os domínios públicos

**n8n é opcional** — necessário apenas para automações avançadas.
