# MegaDesk — Guia de Instalação Windows

## Pré-requisitos (instalar antes)

| Software | Link | Versão |
|----------|------|--------|
| **Node.js** | https://nodejs.org | 20+ (LTS) |
| **pnpm** | `npm install -g pnpm` | 10+ |
| **MySQL** | https://dev.mysql.com/downloads/installer/ | 8.0+ |
| **cloudflared** | https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/ | Última |

## Configuração Inicial (fazer uma vez)

### 1. Configurar banco MySQL

```sql
-- No MySQL Workbench ou linha de comando:
CREATE DATABASE megadesk_main CHARACTER SET utf8mb4;
CREATE USER 'megadesk'@'localhost' IDENTIFIED BY 'SuaSenhaAqui';
GRANT ALL ON `megadesk_%`.* TO 'megadesk'@'localhost';
FLUSH PRIVILEGES;
```

### 2. Configurar variáveis de ambiente

```
Copie windows\.env.exemplo para .env (na raiz do projeto)
Edite o arquivo .env com suas configurações
```

### 3. Instalar dependências

```cmd
pnpm install
```

### 4. Criar tabelas no banco

```cmd
pnpm db:push
```

### 5. Configurar Cloudflare Tunnel

```cmd
cloudflared tunnel login
cloudflared tunnel create megadesk-server
cloudflared tunnel route dns --overwrite-dns megadesk-server app.megadesk.online
cloudflared tunnel route dns --overwrite-dns megadesk-server admin.megadesk.online
cloudflared tunnel route dns --overwrite-dns megadesk-server api.megadesk.online
```

## Uso Diário

### Iniciar tudo:
```
Duplo clique em: windows\start-megadesk.bat
```

### Parar tudo:
```
Duplo clique em: windows\stop-megadesk.bat
```

### Iniciar com Windows automaticamente:
```
Executar como Administrador: windows\install-autostart.bat
```

## URLs

| URL | O que é |
|-----|---------|
| http://localhost:3000 | MegaDesk local |
| https://app.megadesk.online | Plataforma clientes |
| https://admin.megadesk.online | Painel Admin |
| https://api.megadesk.online | API/Backend |
| http://localhost:5678 | n8n (automações) |
| http://localhost:8080 | Evolution API (WhatsApp) |

## Login Admin (após configuração)
- Email: `marcelo.mouraadmpro@gmail.com`
- Senha: `123456`

## Arquivos Criados

| Arquivo | Função |
|---------|--------|
| `windows/start-megadesk.bat` | Inicia todos os serviços |
| `windows/stop-megadesk.bat` | Para todos os serviços |
| `windows/install-autostart.bat` | Configura início automático com Windows |
| `windows/uninstall-autostart.bat` | Remove início automático |
| `windows/.env.exemplo` | Modelo de variáveis de ambiente |
