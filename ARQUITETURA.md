# Arquitetura da Plataforma MegaDesk

## Visão Geral

MegaDesk é uma plataforma multi-tenant de helpdesk e comunicação que oferece:

- **Atendimento Ativo**: Busca e contato proativo com clientes
- **Conversas Receptivas**: Gerenciamento de mensagens de clientes
- **Chamados (Tickets)**: Sistema completo de gestão de tickets com timeline
- **Rastreio**: Acompanhamento de encomendas e pedidos
- **ERP**: Registros operacionais e integração
- **Bot Gemini IA**: Assistente inteligente com treinamento customizável
- **MegaAdmin**: Painel administrativo para gerenciar clientes e usuários

## Arquitetura Técnica

### Stack Tecnológico

```
Frontend:
├── React 19
├── TypeScript
├── Tailwind CSS 4
├── shadcn/ui
├── React Query (tRPC)
└── Wouter (routing)

Backend:
├── Express 4
├── tRPC 11
├── Node.js
├── TypeScript
└── Drizzle ORM

Banco de Dados:
├── MySQL/TiDB
├── Drizzle Migrations
└── Multi-tenant (por cliente)

Testes:
├── Vitest (unit/integration)
├── Playwright (E2E)
└── 260+ testes passando

IA:
├── Google Gemini API
├── Whisper (transcrição de áudio)
├── Image Generation
└── LLM Integration
```

### Estrutura de Diretórios

```
megadesk-platform/
├── client/                          # Frontend React
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Home.tsx            # Dashboard principal (MegaDesk)
│   │   │   ├── AdminPanel.tsx      # Dashboard administrativo (MegaAdmin)
│   │   │   ├── ActiveAttendance.tsx # Página de atendimento ativo
│   │   │   └── TicketsPageNew.tsx  # Página de tickets (modular)
│   │   ├── components/
│   │   │   ├── DashboardLayout.tsx # Layout com sidebar
│   │   │   ├── ChamadoDetailModal.tsx # Modal de detalhes com timeline
│   │   │   ├── AIChatBox.tsx       # Chat com IA
│   │   │   ├── Map.tsx             # Integração Google Maps
│   │   │   └── ui/                 # shadcn/ui components
│   │   ├── lib/
│   │   │   └── trpc.ts             # Cliente tRPC
│   │   └── contexts/
│   │       └── ThemeContext.tsx    # Tema (dark/light)
│   └── index.html
│
├── server/                          # Backend Express + tRPC
│   ├── _core/
│   │   ├── index.ts                # Servidor Express
│   │   ├── context.ts              # Contexto tRPC (autenticação)
│   │   ├── oauth.ts                # Autenticação Manus OAuth
│   │   ├── llm.ts                  # Integração Gemini
│   │   ├── voiceTranscription.ts   # Whisper API
│   │   ├── imageGeneration.ts      # Geração de imagens
│   │   ├── notification.ts         # Notificações
│   │   └── heartbeat.ts            # Jobs periódicos
│   ├── db.ts                        # Helpers de banco de dados
│   ├── db-chamados.ts              # Helpers específicos de chamados
│   ├── db-conversas.ts             # Helpers específicos de conversas
│   ├── routers.ts                  # Routers tRPC principais
│   ├── routers-chamados.ts         # Router tRPC de chamados
│   ├── routers-conversas.ts        # Router tRPC de conversas
│   ├── storage.ts                  # S3 storage helpers
│   └── *.test.ts                   # Testes Vitest
│
├── drizzle/                         # Schema e migrações
│   ├── schema.ts                   # Definição de tabelas
│   ├── relations.ts                # Relacionamentos
│   └── migrations/                 # SQL migrations
│
├── shared/                          # Código compartilhado
│   ├── types.ts                    # Tipos TypeScript
│   ├── const.ts                    # Constantes
│   └── _core/errors.ts             # Tipos de erro
│
├── e2e/                             # Testes E2E com Playwright
│   └── chamados.spec.ts            # Testes de chamados
│
├── references/                      # Documentação de referência
│   └── periodic-updates.md         # Configuração de jobs periódicos
│
└── ARQUITETURA.md                  # Este arquivo
```

## Fluxos de Dados

### 1. Autenticação e Contexto de Tenant

```
Usuário acessa app
    ↓
Manus OAuth (getLoginUrl)
    ↓
Callback em /api/oauth/callback
    ↓
Session cookie criado (JWT)
    ↓
Context tRPC extrai user e tenantId
    ↓
Todas as queries/mutations usam ctx.tenantId para isolamento
```

### 2. Fluxo de Atendimento Ativo

```
Usuário acessa "Atendimento Ativo"
    ↓
Digita número de telefone
    ↓
Busca cliente no banco (searchCustomer)
    ↓
Se encontrado:
    ├─ Exibe dados do cliente
    └─ Pergunta "Abrir chamado?"
       ├─ Sim: Cria chamado + conversa
       └─ Não: Abre conversa apenas
    ↓
Se não encontrado:
    ├─ Formulário para novo cliente
    └─ Cria cliente + conversa/chamado
    ↓
Redireciona para Conversas
```

### 3. Fluxo de Chamados

```
Usuário acessa "Chamados"
    ↓
Carrega lista de chamados (chamados.list)
    ↓
Usuário clica em um chamado
    ↓
Modal abre com timeline vertical
    ├─ Atividades cronológicas
    ├─ Datas em laranja
    ├─ Ícones circulares
    └─ Botões: Registrar atividade, Status, Atendente
    ↓
Usuário pode:
    ├─ Adicionar nova atividade
    ├─ Alterar status
    ├─ Alterar atendente responsável
    └─ Editar atividades existentes
```

### 4. Fluxo de Conversas

```
Usuário acessa "Conversas"
    ↓
Carrega conversas (conversas.list)
    ↓
Filtra por status:
    ├─ "Abertas" (status = 'open')
    ├─ "Bot" (status = 'bot')
    └─ "Fechadas" (status = 'closed')
    ↓
Usuário seleciona conversa
    ↓
Carrega histórico de mensagens
    ↓
Usuário pode:
    ├─ Enviar mensagem
    ├─ Editar cliente (nome, empresa)
    └─ Encerrar conversa
```

## Modelo de Dados

### Tabelas Principais

#### `megadesk_domain_clients`
```sql
- id (UUID, PK)
- client_id (UUID, FK para cliente)
- name (string)
- email (string)
- phone (string)
- company (string)
- status (enum: active, inactive, blocked)
- created_at (timestamp)
- updated_at (timestamp)
```

#### `megadesk_domain_chamados`
```sql
- id (UUID, PK)
- client_id (UUID, FK)
- chamado_number (int, sequencial por cliente)
- title (string)
- observations (string)
- status (enum: open, in_progress, waiting, closed)
- priority (enum: baixa, media, alta, critica)
- assigned_to (string, opcional)
- created_at (timestamp)
- updated_at (timestamp)

Índice único: (client_id, chamado_number)
```

#### `megadesk_domain_chamado_activities`
```sql
- id (UUID, PK)
- chamado_id (UUID, FK)
- type (enum: created, updated, comment, status_change)
- description (string)
- created_by (string, opcional)
- created_at (timestamp)
```

#### `megadesk_domain_conversations`
```sql
- id (UUID, PK)
- client_id (UUID, FK)
- customer_id (UUID, FK)
- status (enum: open, bot, closed)
- last_message (string)
- last_message_from (enum: customer, attendant)
- is_read (boolean)
- created_at (timestamp)
- updated_at (timestamp)
```

## Segurança e Isolamento de Tenant

### Princípios

1. **Isolamento por Tenant**: Cada cliente (tenant) só acessa seus próprios dados
2. **Autenticação Obrigatória**: Todas as procedures usam `protectedProcedure`
3. **Validação de Autorização**: `ctx.tenantId` é derivado do usuário autenticado
4. **Sanitização de Inputs**: Todos os inputs são validados com Zod
5. **Rate Limiting**: 100 requisições por minuto por cliente

### Implementação

```typescript
// Exemplo de procedure protegida
export const chamadosRouter = router({
  list: protectedProcedure
    .input(z.object({ offset: z.number(), limit: z.number() }))
    .query(async ({ ctx, input }) => {
      // ctx.tenantId é derivado automaticamente do usuário
      return listChamados(ctx.tenantId, input.offset, input.limit);
    }),
});

// Validação de autorização
function listChamados(clientId: string, offset: number, limit: number) {
  // Query sempre filtra por clientId
  return db
    .select()
    .from(megadeskDomainChamados)
    .where(eq(megadeskDomainChamados.clientId, clientId))
    .limit(limit)
    .offset(offset);
}
```

## Performance e Otimizações

### Problema N+1 Resolvido

**Antes**: 1 query principal + 50 queries de atividades = 1382ms
**Depois**: 2 queries com JOIN = 121ms
**Melhoria**: 91% mais rápido

### Estratégias de Otimização

1. **Batch Loading**: Carregar atividades em uma única query com JOIN
2. **Paginação**: Limitar resultados com offset/limit
3. **Índices**: Índices compostos em (client_id, chamado_number)
4. **Caching**: React Query cache automático
5. **Debounce**: Busca com debounce de 300ms

## Testes

### Cobertura de Testes

```
Total: 260+ testes passando

Validação:
├─ 39 testes de validação de chamados
├─ 36 testes de validação de conversas
└─ 12 testes de duplicação

Performance:
├─ 15 testes de performance
└─ Verificam tempo < 100ms para operações comuns

Acessibilidade:
├─ 31 testes de a11y e responsividade
├─ WCAG 2.1 AA compliance
└─ Testes de touch targets, contraste, navegação

E2E:
├─ 10 testes com Playwright
├─ Fluxos completos de criação/edição/encerramento
└─ Integração entre módulos

Integração:
├─ 27 testes de timeline
├─ 20 testes de features
├─ 22 testes de helpers
└─ 7 testes de atendimento
```

### Executar Testes

```bash
# Todos os testes
pnpm test

# Testes específicos
pnpm test -- chamados-validacao
pnpm test -- chamados-performance
pnpm test -- chamados-accessibility

# Testes E2E
pnpm test:e2e
pnpm test:e2e:ui
```

## Robustez e Tratamento de Erros

### Estratégias Implementadas

1. **Validação Rigorosa com Zod**
   - Schemas para todos os inputs
   - Mensagens de erro claras
   - Validação de UUIDs e enums

2. **Sanitização de Strings**
   - Remove caracteres de controle ASCII
   - Truncamento automático
   - Remove espaços em branco extras

3. **Retry Logic com Backoff Exponencial**
   - 3 tentativas por padrão
   - Delay: 100ms → 200ms → 400ms
   - Não faz retry em erros de validação

4. **Rate Limiting**
   - 100 requisições por minuto por cliente
   - Proteção contra abuso e DDoS

5. **Logging Estruturado**
   - 5 níveis: DEBUG, LOG, SUCCESS, WARN, ERROR
   - Rastreabilidade completa

6. **Health Checks**
   - Endpoint `/health` para diagnóstico
   - Verificação de banco de dados

## Integração com IA

### Google Gemini

```typescript
// Usar LLM para análise de ticket
const response = await invokeLLM({
  messages: [
    { role: "system", content: "Você é um assistente de suporte." },
    { role: "user", content: ticket.description },
  ],
});
```

### Whisper (Transcrição de Áudio)

```typescript
// Transcrever áudio para texto
const result = await transcribeAudio({
  audioUrl: "https://...",
  language: "pt",
});
```

### Image Generation

```typescript
// Gerar imagens
const { url } = await generateImage({
  prompt: "Uma imagem de suporte técnico",
});
```

## Deployment

### Ambiente de Produção

- **Hosting**: Manus (built-in)
- **Domínio**: megadesk-hqnjt6tz.manus.space
- **SSL**: Automático
- **CI/CD**: Git integration

### Variáveis de Ambiente

```
DATABASE_URL=mysql://...
JWT_SECRET=...
VITE_APP_ID=...
OAUTH_SERVER_URL=https://api.manus.im
GEMINI_API_KEY=...
VITE_FRONTEND_FORGE_API_KEY=...
```

### Checkpoint e Rollback

```bash
# Salvar checkpoint
webdev_save_checkpoint

# Rollback para versão anterior
webdev_rollback_checkpoint <version_id>
```

## Próximas Melhorias

1. **Integração com WhatsApp**: Sincronizar mensagens com chamados
2. **Dashboard de Métricas**: KPIs e relatórios
3. **Automação de Workflows**: Regras e triggers
4. **Integração com ERP**: Sincronizar com sistemas externos
5. **Mobile App**: Aplicativo nativo para iOS/Android
6. **Notificações em Tempo Real**: WebSocket para atualizações
7. **Busca Avançada**: Elasticsearch para buscas complexas
8. **Analytics**: Rastreamento de comportamento de usuários

## Suporte e Documentação

- **API Docs**: Disponível em `/api/docs`
- **User Guide**: Veja `USER_GUIDE.md`
- **Admin Manual**: Veja `ADMIN_MANUAL.md`
- **Troubleshooting**: Veja `TROUBLESHOOTING.md`

## Contato

Para dúvidas ou sugestões, entre em contato com a equipe de desenvolvimento.
