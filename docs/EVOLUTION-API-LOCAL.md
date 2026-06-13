# Evolution API — Setup Local (Docker)

A Evolution API roda em Docker separado do MegaDesk.
O MegaDesk continua rodando normalmente via CMD.

---

## Variáveis de ambiente do MegaDesk (CMD Windows)

Configure no CMD **antes** de subir o MegaDesk:

```cmd
set EVOLUTION_API_URL=http://localhost:8080
set EVOLUTION_API_KEY=megadesk-evolution-key
set WEBHOOK_BASE_URL=http://host.docker.internal:3000
```

Ou adicione ao seu `.env`:

```env
EVOLUTION_API_URL=http://localhost:8080
EVOLUTION_API_KEY=megadesk-evolution-key
WEBHOOK_BASE_URL=http://host.docker.internal:3000
```

> **Por que `host.docker.internal:3000`?**
> A Evolution API roda dentro do Docker. Para ela enviar webhooks ao MegaDesk
> (que roda no Windows), precisa usar `host.docker.internal` em vez de `localhost`.
> O MegaDesk, por sua vez, acessa a Evolution via `localhost:8080` normalmente.

---

## Subir a Evolution API

```cmd
docker compose -f docker-compose.evolution.yml up -d
```

---

## Parar

```cmd
docker compose -f docker-compose.evolution.yml down
```

---

## Ver logs em tempo real

```cmd
docker compose -f docker-compose.evolution.yml logs -f
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

---

## Testar com API Key

```cmd
curl http://localhost:8080/instance/fetchInstances -H "apikey: megadesk-evolution-key"
```

Resposta: lista de instâncias (vazia `[]` na primeira vez).

---

## Testar QR Code no MegaDesk

1. Subir Evolution API: `docker compose -f docker-compose.evolution.yml up -d`
2. Iniciar MegaDesk: `pnpm tsx watch server/_core/index.ts`
3. Abrir: `http://localhost:3000`
4. Fazer login MegaDesk
5. Ir em **Configurações → WhatsApp**
6. Clicar **"Gerar QR Code"**
7. Escanear com o WhatsApp do celular
8. Após conectar, o status muda para **"Conectado"**

---

## Sessão persistente

- A sessão é salva em volumes Docker (`megadesk_evolution_instances`)
- Após reiniciar `docker compose down/up`, a sessão é restaurada automaticamente
- O MegaDesk verifica o status ao vivo antes de pedir novo QR
- Novo QR só é pedido se a Evolution informar `disconnected`

---

## Reiniciar sem perder sessão

```cmd
docker compose -f docker-compose.evolution.yml restart
```

---

## Remover completamente (apaga sessão WhatsApp)

```cmd
docker compose -f docker-compose.evolution.yml down -v
```

> ⚠️ `-v` remove os volumes. Use apenas se quiser começar do zero.

---

## Sequência completa de primeiro uso

```cmd
:: 1. Subir Evolution API
docker compose -f docker-compose.evolution.yml up -d

:: 2. Aguardar ~10 segundos e verificar
curl http://localhost:8080

:: 3. Configurar ENVs do MegaDesk
set EVOLUTION_API_URL=http://localhost:8080
set EVOLUTION_API_KEY=megadesk-evolution-key
set WEBHOOK_BASE_URL=http://host.docker.internal:3000

:: 4. Subir MegaDesk
set NODE_ENV=development
set DATABASE_URL=mysql://megadesk:MegaDesk123@localhost:3306/megadesk_main
set JWT_SECRET=9fK28xPqLmN7vR4tYwE1zBcH6sJdQ3uA8nMxK5pRtV2gF9cW
pnpm tsx watch server/_core/index.ts

:: 5. Abrir http://localhost:3000/admin → login → Configurações → WhatsApp → Gerar QR Code
```
