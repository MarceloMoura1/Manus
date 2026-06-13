# Evolution API — Setup Local (Docker)

A Evolution API roda em Docker com banco MySQL próprio.
O MegaDesk continua usando o MySQL local (`megadesk_main`).
**Nenhuma dependência do root do MySQL local.**

---

## Arquitetura

```
Windows Host
│
├── MegaDesk (CMD local)          → MySQL local :3306 / megadesk_main
│
└── Docker
    ├── evolution-api :8080       → evolution-db:3306 / evolution_api
    └── evolution-db  (interno)   → volume: megadesk_evolution_db
```

---

## Variáveis do MegaDesk (CMD Windows)

Configure no CMD **antes** de subir o MegaDesk:

```cmd
set EVOLUTION_API_URL=http://localhost:8080
set EVOLUTION_API_KEY=megadesk-evolution-key
set WEBHOOK_BASE_URL=http://host.docker.internal:3000
```

> **Por que `host.docker.internal:3000`?**
> A Evolution API roda dentro do Docker. Para enviar webhooks ao MegaDesk
> (que roda no Windows), precisa de `host.docker.internal` — não `localhost`.
> O MegaDesk acessa a Evolution normalmente via `localhost:8080`.

---

## Imagem utilizada

**`evoapicloud/evolution-api:2.4.0`** — versão estável com correções MySQL:
- Fix do bug `wavoipToken` (migration fora de ordem)
- Fix de defaults inválidos para `createdAt` no MySQL
- Fix de tipos boolean/integer no MySQL
- Migrações executadas automaticamente no startup

> ⚠️ **Não use `atendai/evolution-api:latest`** — essa imagem tem o bug do `wavoipToken` e schema Prisma incompatível com MySQL.

---

## Comandos

### PRIMEIRA VEZ ou após erro de migration — Limpar e subir do zero
```cmd
:: Parar e remover containers E volumes (limpa banco corrompido)
docker compose -f docker-compose.evolution.yml down -v

:: Subir tudo limpo
docker compose -f docker-compose.evolution.yml up -d
```

> O `-v` remove os volumes e o banco MySQL da Evolution.
> Na primeira vez ou após erro, use sempre `down -v` antes de `up -d`.

### Uso normal (mantém dados e sessão)
```cmd
docker compose -f docker-compose.evolution.yml down
docker compose -f docker-compose.evolution.yml up -d
```

> Na primeira vez, aguarde ~30 segundos para o MySQL do Docker inicializar.

### Ver logs em tempo real
```cmd
docker compose -f docker-compose.evolution.yml logs -f
```

### Ver logs só da Evolution API
```cmd
docker compose -f docker-compose.evolution.yml logs -f evolution-api
```

### Ver logs só do banco
```cmd
docker compose -f docker-compose.evolution.yml logs -f evolution-db
```

---

## Testar se está online

```cmd
curl http://localhost:8080
```

Resposta esperada:
```json
{"status":200,"message":"Welcome to the Evolution API..."}
```

### Testar com API Key
```cmd
curl http://localhost:8080/instance/fetchInstances -H "apikey: megadesk-evolution-key"
```

Resposta: `[]` (lista vazia na primeira vez — normal).

---

## Testar QR Code

1. Subir Evolution API: `docker compose -f docker-compose.evolution.yml up -d`
2. Aguardar ~30s (banco inicializando)
3. Verificar: `curl http://localhost:8080`
4. Subir MegaDesk com as ENVs corretas (ver acima)
5. Abrir `http://localhost:3000`
6. Fazer login → **Configurações → WhatsApp**
7. Clicar **"Gerar QR Code"**
8. Escanear com o WhatsApp do celular
9. Status muda para **"Conectado"**

---

## Sequência completa de primeiro uso

```cmd
:: 1. Parar containers antigos (se tiver)
docker compose -f docker-compose.evolution.yml down

:: 2. Subir Evolution API + banco próprio
docker compose -f docker-compose.evolution.yml up -d

:: 3. Aguardar inicialização (banco MySQL leva ~30s)
::    Verificar:
curl http://localhost:8080

:: 4. Configurar ENVs do MegaDesk
set EVOLUTION_API_URL=http://localhost:8080
set EVOLUTION_API_KEY=megadesk-evolution-key
set WEBHOOK_BASE_URL=http://host.docker.internal:3000
set NODE_ENV=development
set DATABASE_URL=mysql://megadesk:MegaDesk123@localhost:3306/megadesk_main
set JWT_SECRET=9fK28xPqLmN7vR4tYwE1zBcH6sJdQ3uA8nMxK5pRtV2gF9cW

:: 5. Subir MegaDesk
pnpm tsx watch server/_core/index.ts

:: 6. Abrir http://localhost:3000 → login → Configurações → WhatsApp → Gerar QR Code
```

---

## Sessão persistente

- Sessões WhatsApp ficam nos volumes Docker `megadesk_evolution_instances` e `megadesk_evolution_store`
- O banco da Evolution fica em `megadesk_evolution_db`
- Após `docker compose restart`, sessão é restaurada automaticamente
- Novo QR só é pedido se o celular desconectar

---

## Reiniciar sem perder sessão

```cmd
docker compose -f docker-compose.evolution.yml restart
```

---

## Parar preservando dados

```cmd
docker compose -f docker-compose.evolution.yml down
```

> Dados e sessão são preservados nos volumes Docker.

---

## Remover tudo (apaga sessão e banco)

```cmd
docker compose -f docker-compose.evolution.yml down -v
```

> ⚠️ `-v` remove os volumes. Use só para começar do zero.

---

## Bancos de dados — separação clara

| Banco | Onde | Usado por |
|-------|------|-----------|
| `megadesk_main` | MySQL local (Windows) | MegaDesk |
| `evolution_api` | MySQL Docker (evolution-db) | Evolution API |

**Os dois bancos são completamente independentes.**
