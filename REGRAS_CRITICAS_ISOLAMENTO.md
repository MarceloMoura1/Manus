# 🔒 REGRAS CRÍTICAS DE ISOLAMENTO DE DADOS — NUNCA ALTERAR

> **ATENÇÃO:** Este arquivo documenta regras de segurança fundamentais da plataforma MegaDesk.
> Qualquer alteração nas regras abaixo pode causar vazamento de dados entre clientes (tenants).
> **NÃO MODIFIQUE** sem revisão cuidadosa e testes completos de isolamento.

---

## PRINCÍPIO FUNDAMENTAL

Cada cliente (tenant) tem dados **100% isolados**.
Nenhum dado de um cliente pode vazar para outro, em nenhuma circunstância.

---

## REGRA 1 — TODA procedure do MegaDesk DEVE filtrar por `clientId`

- Toda query de leitura: `WHERE client_id = ?` (ou filtro equivalente no array em memória)
- Toda mutation: verificar que o recurso pertence ao `clientId` antes de alterar
- **Nunca retornar dados sem filtrar por `clientId`**

---

## REGRA 2 — `botScripts`: filtrar ESTRITAMENTE por `clientId`

```ts
// ✅ CORRETO
botScripts.filter(s => s.clientId === client.clientId)

// ❌ PROIBIDO — o fallback !s.clientId vaza scripts para TODOS os clientes
botScripts.filter(s => !s.clientId || s.clientId === client.clientId)
```

---

## REGRA 3 — `closeConversation` e operações por ID

Ao buscar um recurso por ID (conversa, chamado, cliente), **SEMPRE verificar**:

```ts
if (resource.clientId !== client.clientId) throw new TRPCError({ code: "FORBIDDEN" })
```

Nunca encerrar/editar um recurso apenas pelo ID sem verificar o dono.

---

## REGRA 4 — `updateCustomer` (e funções similares no `db.ts`)

Toda função de UPDATE no banco **DEVE incluir `AND client_id = ?`** no WHERE.

```sql
-- ✅ CORRETO
WHERE customer_id = ? AND client_id = ?

-- ❌ PROIBIDO (sem filtro de cliente)
WHERE customer_id = ?
```

---

## REGRA 5 — `passwordHash` NUNCA pode ser sobrescrito com `null`

Três camadas de proteção — **todas devem ser mantidas**:

- **CAMADA 1** (`db.ts` → `saveMegaDeskStructuredState`): prioridade `memHash ?? dbHash ?? null`
- **CAMADA 2** (SQL): `COALESCE(VALUES(password_hash), password_hash)` no `ON DUPLICATE KEY UPDATE`
- **CAMADA 3** (pós-save): verificação de integridade — detecta usuários sem hash e restaura `123456`

---

## REGRA 6 — `getReleasedClientOrThrow` é obrigatório

Toda procedure que acessa dados de cliente **DEVE chamar** `getReleasedClientOrThrow(clientId)`
antes de qualquer operação. Isso garante que o cliente existe, está ativo e liberado.

---

## REGRA 7 — Sessão MegaDesk usa a chave `"megadesk_session_v1"`

```ts
// ✅ CORRETO
localStorage.getItem("megadesk_session_v1")

// ❌ PROIBIDO
localStorage.getItem("megadesk-session")  // ou qualquer outra variação
```

Toda leitura de sessão no frontend MegaDesk **DEVE usar** `"megadesk_session_v1"`.

---

## REGRA 8 — `clientId` DEVE ser passado em TODAS as chamadas de mutation do MegaDesk

```ts
// O clientId vem sempre da sessão:
const { clientId } = JSON.parse(localStorage.getItem("megadesk_session_v1"))
```

**Nunca omitir o `clientId`** em chamadas tRPC do MegaDesk.

---

## Arquivos Críticos

| Arquivo | Descrição | Risco se alterado |
|---|---|---|
| `server/routers.ts` | Todas as procedures tRPC | Alto — pode quebrar isolamento |
| `server/db.ts` | Helpers de banco (`saveMegaDeskStructuredState`, `updateCustomer`, `searchCustomerByPhone`) | Alto — pode vazar dados entre clientes |
| `server/gemini-client.ts` | IA por cliente com quota | Médio — pode misturar tokens/histórico |

---

## Histórico de Correções de Isolamento

| Fase | Data | Problema | Correção |
|---|---|---|---|
| 94 | Mai/2026 | Procedures sem filtro por `clientId` | Todas as procedures passaram a filtrar por `clientId` |
| 95 | Mai/2026 | `botScripts` com fallback `!script.clientId` | Removido fallback — filtro estrito |
| 95 | Mai/2026 | `closeConversation` sem verificar dono | Adicionada verificação `conv.clientId !== client.clientId` |
| 95 | Mai/2026 | `updateCustomer` sem `AND client_id = ?` | SQL atualizado com filtro duplo |

---

*Última atualização: Fase 95 — Maio/2026*
