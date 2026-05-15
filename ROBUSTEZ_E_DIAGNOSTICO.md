# Documentação de Robustez e Diagnóstico - Sistema de Chamados

## 📋 Visão Geral

Este documento descreve as melhorias de robustez implementadas no sistema de chamados para evitar problemas futuros e garantir operação confiável em produção.

## 🛡️ Melhorias de Robustez Implementadas

### 1. Validação Rigorosa de Inputs

**Arquivo:** `server/routers-chamados.ts`

Todos os inputs são validados com Zod schemas rigorosos:

```typescript
// Exemplos de validações
const StringFieldSchema = z.string()
  .min(1, 'Campo não pode estar vazio')
  .max(500, 'Campo muito longo');

const ObservationsSchema = z.string()
  .max(2000, 'Observações muito longas');

const PrioritySchema = z.enum(['baixa', 'media', 'alta', 'critica']);
const StatusSchema = z.enum(['open', 'in_progress', 'waiting', 'closed']);
```

**Benefícios:**
- Rejeita inputs inválidos antes de chegar ao banco
- Mensagens de erro claras para o cliente
- Type-safe em todo o pipeline

### 2. Sanitização de Strings

**Arquivo:** `server/db-chamados.ts`

Todas as strings são sanitizadas para remover:
- Caracteres de controle ASCII (0x00-0x1F, 0x7F)
- Espaços em branco extras
- Truncamento automático para limites definidos

```typescript
function sanitizeString(str: string, maxLength: number = MAX_STRING_LENGTH): string {
  if (!str) return '';
  
  let sanitized = str
    .replace(/[\x00-\x1F\x7F]/g, '') // Remove caracteres de controle
    .trim()                           // Remove espaços extras
    .substring(0, maxLength);         // Trunca para limite
  
  return sanitized;
}
```

**Limites de Tamanho:**
- Campos normais: 500 caracteres
- Observações: 2000 caracteres
- Descrições de atividades: 2000 caracteres

### 3. Retry Logic com Backoff Exponencial

**Arquivo:** `server/db-chamados.ts`

Operações de banco implementam retry automático:

```typescript
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  delayMs: number = 100
): Promise<T>
```

**Comportamento:**
- 3 tentativas por padrão
- Delay exponencial: 100ms → 200ms → 400ms
- Não faz retry em erros de validação
- Logging de cada tentativa

**Benefícios:**
- Recuperação automática de falhas temporárias
- Reduz impacto de timeouts de rede
- Evita sobrecarga do banco

### 4. Isolamento de Tenant Garantido

**Arquivo:** `server/routers-chamados.ts` e `server/db-chamados.ts`

Todas as operações validam `clientId`:

```typescript
const clientId = ctx.tenantId || String(ctx.user.id);

if (!clientId || clientId.trim() === '') {
  throw new TRPCError({
    code: "UNAUTHORIZED",
    message: "Identificação de cliente inválida",
  });
}
```

**Garantias:**
- Usuário só acessa dados do seu cliente
- Queries sempre filtram por `clientId`
- Updates validam ownership antes de modificar
- Isolamento em nível de banco de dados

### 5. Rate Limiting

**Arquivo:** `server/routers-chamados.ts`

Implementação simples de rate limiting por cliente:

```typescript
const RATE_LIMIT_WINDOW = 60000;      // 1 minuto
const RATE_LIMIT_MAX_REQUESTS = 100;  // 100 requisições/min

function checkRateLimit(clientId: string): void {
  // Verifica e incrementa contador
  // Lança erro se limite excedido
}
```

**Benefícios:**
- Protege contra abuso
- Previne DDoS
- Mantém performance para usuários legítimos

### 6. Logging Estruturado

**Arquivo:** `server/db-chamados.ts` e `server/routers-chamados.ts`

Logging em múltiplos níveis:

```typescript
console.log('[DEBUG] Listing chamados for clientId:', clientId);
console.log('[LOG] Criando chamado #${chamadoNumber}');
console.log('[SUCCESS] Chamado criado com sucesso');
console.error('[ERROR] Failed to create chamado:', error);
```

**Níveis:**
- `[DEBUG]` - Informações detalhadas
- `[LOG]` - Operações normais
- `[SUCCESS]` - Operações bem-sucedidas
- `[WARN]` - Avisos
- `[ERROR]` - Erros

### 7. Tratamento de Erros Detalhado

**Arquivo:** `server/routers-chamados.ts`

Cada procedure trata erros especificamente:

```typescript
catch (error) {
  if (error instanceof TRPCError) throw error;
  
  let errorMessage = "Erro ao criar chamado";
  if (error instanceof Error) {
    if (error.message.includes('inválid')) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: error.message,
      });
    }
    errorMessage = error.message;
  }
  
  throw new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: errorMessage,
  });
}
```

**Benefícios:**
- Erros específicos para cada situação
- Mensagens úteis para debugging
- Códigos de erro padronizados

### 8. Health Check Endpoint

**Arquivo:** `server/routers-chamados.ts`

Procedure para diagnosticar saúde do sistema:

```typescript
healthCheck: protectedProcedure.query(async ({ ctx }) => {
  // Valida autenticação
  // Retorna status e timestamp
  // Útil para monitoramento
})
```

## 🔍 Guia de Diagnóstico

### Problema: Chamado não é criado

**1. Verificar logs do servidor:**
```bash
# Procurar por [ERROR] ou [WARN]
grep -i "error\|warn" .manus-logs/devserver.log | tail -20
```

**2. Verificar validação de inputs:**
- Campo vazio? → Validação Zod rejeita
- String muito longa? → Será truncada automaticamente
- Status/prioridade inválida? → Será rejeitada

**3. Verificar isolamento de tenant:**
```bash
# Verificar se clientId está correto
grep "clientId:" .manus-logs/devserver.log | tail -5
```

**4. Verificar rate limiting:**
- Muitas requisições? → Aguarde 1 minuto
- Verificar: `Limite de requisições excedido`

### Problema: Dados inconsistentes entre clientes

**1. Verificar isolamento:**
```sql
-- Verificar chamados por cliente
SELECT clientId, COUNT(*) FROM megadesk_domain_chamados 
GROUP BY clientId;

-- Verificar se há chamados sem clientId
SELECT * FROM megadesk_domain_chamados 
WHERE clientId IS NULL;
```

**2. Verificar integridade:**
```sql
-- Verificar atividades órfãs
SELECT a.* FROM megadesk_domain_chamado_activities a
LEFT JOIN megadesk_domain_chamados c ON a.chamadoId = c.chamadoId
WHERE c.chamadoId IS NULL;
```

### Problema: Performance lenta

**1. Verificar índices:**
```sql
-- Verificar índices criados
SHOW INDEX FROM megadesk_domain_chamados;
SHOW INDEX FROM megadesk_domain_chamado_activities;
```

**2. Verificar queries N+1:**
```bash
# Procurar por múltiplas queries para mesmo chamado
grep "SELECT.*FROM megadesk_domain_chamado_activities" .manus-logs/devserver.log | wc -l
```

**3. Verificar paginação:**
- Usar limit/offset corretos
- Não carregar todos os registros

### Problema: Erro ao atualizar chamado

**1. Verificar se chamado existe:**
```sql
SELECT * FROM megadesk_domain_chamados 
WHERE chamadoId = 'seu-id' AND clientId = 'seu-cliente';
```

**2. Verificar permissões:**
- User está autenticado?
- clientId está correto?
- Chamado pertence ao cliente?

**3. Verificar validação:**
- Status válido?
- Prioridade válida?
- Campos não vazios?

## 📊 Métricas de Monitoramento

### Recomendações para Produção

**1. Monitorar Taxa de Erro:**
```bash
# Contar erros por tipo
grep "\[ERROR\]" .manus-logs/devserver.log | cut -d: -f2 | sort | uniq -c
```

**2. Monitorar Latência:**
```bash
# Medir tempo de operações
grep "\[SUCCESS\]" .manus-logs/devserver.log | wc -l
```

**3. Monitorar Taxa de Rate Limit:**
```bash
# Verificar se clientes estão sendo throttled
grep "Limite de requisições" .manus-logs/devserver.log | wc -l
```

**4. Monitorar Retries:**
```bash
# Verificar quantos retries estão acontecendo
grep "\[RETRY\]" .manus-logs/devserver.log | wc -l
```

## 🧪 Testes Implementados

### Testes de Validação (39 testes)
- ✅ Strings vazias
- ✅ Status válidos/inválidos
- ✅ Prioridades válidas/inválidas
- ✅ Sanitização de caracteres de controle
- ✅ Truncamento de strings
- ✅ Espaços em branco
- ✅ Casos combinados
- ✅ Performance

**Executar testes:**
```bash
pnpm test -- chamados-validacao.test.ts
```

### Testes de Integração (80+ testes)
- ✅ Criação de chamados
- ✅ Atualização de chamados
- ✅ Atividades
- ✅ Filtros
- ✅ Paginação
- ✅ Isolamento de tenant
- ✅ Sequência de números

**Executar testes:**
```bash
pnpm test -- chamados
```

## 🚀 Checklist de Produção

Antes de fazer deploy em produção:

- [ ] Todos os testes passando (`pnpm test`)
- [ ] Sem erros TypeScript (`pnpm tsc --noEmit`)
- [ ] Sem warnings de linting
- [ ] Índices de banco criados
- [ ] Backups configurados
- [ ] Logging configurado
- [ ] Monitoramento ativo
- [ ] Rate limiting ajustado para produção
- [ ] Retry logic testado com falhas simuladas
- [ ] Isolamento de tenant verificado

## 📝 Exemplos de Uso

### Criar Chamado com Segurança

```typescript
// Frontend
const chamado = await trpc.chamados.create.mutate({
  customerId: 'cust-123',
  customerName: 'João Silva',
  company: 'Empresa XYZ',
  title: 'Sistema não funciona',
  observations: 'Erro ao fazer login',
  priority: 'alta',
  assignedTo: 'Atendente 1'
});
```

**Validações Automáticas:**
- ✅ Strings sanitizadas
- ✅ Tamanho validado
- ✅ Prioridade validada
- ✅ clientId isolado
- ✅ Retry automático se falhar

### Listar Chamados com Paginação

```typescript
// Frontend
const { chamados, total } = await trpc.chamados.list.query({
  status: 'open',
  limit: 10,
  offset: 0
});
```

**Validações Automáticas:**
- ✅ Status validado
- ✅ Limit entre 1-100
- ✅ Offset não negativo
- ✅ Isolamento de tenant
- ✅ Rate limiting

## 🔐 Segurança

### Proteções Implementadas

1. **Validação de Input** - Zod schemas rigorosos
2. **Sanitização** - Remove caracteres perigosos
3. **Isolamento de Tenant** - Cada cliente vê só seus dados
4. **Rate Limiting** - Protege contra abuso
5. **Autenticação** - Todas as procedures usam protectedProcedure
6. **Logging** - Rastreabilidade de operações

### Não Implementado (Fora do Escopo)

- Criptografia de dados em repouso
- Auditoria completa de acesso
- 2FA
- Backup automático

## 📞 Suporte

Para problemas:

1. Verificar logs: `.manus-logs/devserver.log`
2. Executar health check: `trpc.chamados.healthCheck.query()`
3. Verificar banco de dados
4. Consultar testes: `pnpm test`

## 📚 Referências

- **Validação:** `server/routers-chamados.ts` (Zod schemas)
- **Sanitização:** `server/db-chamados.ts` (sanitizeString)
- **Retry Logic:** `server/db-chamados.ts` (retryWithBackoff)
- **Testes:** `server/chamados-validacao.test.ts`
- **Isolamento:** `server/routers-chamados.ts` (clientId validation)
