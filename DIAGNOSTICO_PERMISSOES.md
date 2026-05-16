# DIAGNÓSTICO COMPLETO - Sistema de Permissões MegaAdmin ↔ MegaDesk

## 🔴 BUGS CRÍTICOS IDENTIFICADOS

### BUG 1: Mapeamento de Módulos Inconsistente

**Descrição:** Os nomes dos módulos são diferentes em cada parte do sistema.

| Componente | Nome do Módulo | Formato |
|-----------|-----------------|---------|
| MegaAdmin (ClientEditPage.tsx) | `atendimento_ativo` | underscore |
| MegaAdmin (AdminPanel.tsx) | `atendimento_ativo` | underscore |
| Backend (server/routers.ts) | `active-attendance` | hífen |
| MegaDesk (Home.tsx) | `active-attendance` | hífen |

**Impacto:** Quando o usuário seleciona permissões no MegaAdmin com underscore, o backend não consegue sincronizar com o MegaDesk que usa hífen.

**Mapeamento Completo Necessário:**
```
atendimento_ativo → active-attendance
conversas → conversations
chamados → tickets
rastreio → tracking
erp → erp
configurar_bot → bot-config
assistente_ia → ai-assistant
```

---

### BUG 2: Permissões Customizadas Misturadas com Role Padrão

**Localização:** `server/routers.ts`, linha 650

```typescript
// PROBLEMA: Mistura permissões da role com customizadas
return { ok: true, user: { ...user, permissions: Array.from(new Set([...rolePermissions(user.role), ...user.permissions])) } };
```

**Impacto:** Se um usuário é "agent", ele sempre terá as permissões padrão de agent (atendimento_ativo, conversas, chamados) mesmo que o admin tenha removido algumas.

**Comportamento Esperado:** 
- Se há permissões customizadas, usar APENAS as customizadas
- Se não há permissões customizadas, usar as da role

---

### BUG 3: Permissões Customizadas não Respeitam Módulos do Cliente

**Localização:** `server/routers.ts`, função `resolveUserPermissions`

**Problema:** Se um cliente tem apenas módulo "atendimento_ativo" liberado, mas o usuário tem permissão customizada "conversas", o usuário ainda vê "conversas" no MegaDesk.

**Fluxo Atual:**
1. MegaAdmin libera módulos: ["atendimento_ativo"]
2. Admin configura permissões customizadas do usuário: ["atendimento_ativo", "conversas"]
3. Backend retorna permissões: ["atendimento_ativo", "conversas"]
4. MegaDesk mostra: Atendimento Ativo + Conversas ❌

**Fluxo Esperado:**
1. MegaAdmin libera módulos: ["atendimento_ativo"]
2. Admin configura permissões customizadas do usuário: ["atendimento_ativo", "conversas"]
3. Backend filtra por módulos do cliente: ["atendimento_ativo"] ✅
4. MegaDesk mostra: Atendimento Ativo ✅

---

### BUG 4: Formato de Permissões Inconsistente no Banco de Dados

**Localização:** `server/db.ts`, função `saveMegaDeskStructuredState`

**Problema:** As permissões são armazenadas no banco com underscore (do MegaAdmin), mas o backend espera hífen.

```json
// Armazenado no banco:
{ "permissions_json": "[\"atendimento_ativo\", \"conversas\"]" }

// Esperado pelo backend:
{ "permissions": ["active-attendance", "conversations"] }
```

---

### BUG 5: Sincronização de Permissões ao Login

**Localização:** `server/routers.ts`, função `loginByEmail`

**Problema:** Ao fazer login, as permissões não são sincronizadas corretamente com os módulos do cliente.

**Fluxo Atual:**
1. Usuário faz login
2. Backend retorna permissões da role
3. MegaDesk recebe permissões sem considerar módulos do cliente

**Fluxo Esperado:**
1. Usuário faz login
2. Backend resolve permissões considerando: role + customizações + módulos do cliente
3. MegaDesk recebe permissões finais corretas

---

## 📋 ESTRUTURA CORRETA ESPERADA

### MegaAdmin (Frontend)
- Módulos: `atendimento_ativo`, `conversas`, `chamados`, `rastreio`, `erp`, `configurar_bot`, `assistente_ia`
- Labels: "Atendimento Ativo", "Conversas", "Chamados", "Rastreio", "ERP", "Configurar Bot", "Assistente IA"

### Backend (Server)
- Módulos: `active-attendance`, `conversations`, `tickets`, `tracking`, `erp`, `bot-config`, `ai-assistant`
- Permissões: Mesmo que módulos
- Mapeamento: Converter underscore → hífen ao receber do frontend

### MegaDesk (Frontend)
- Permissões: `active-attendance`, `conversations`, `tickets`, `tracking`, `erp`, `bot-config`, `ai-assistant`
- Labels: "Atendimento Ativo", "Conversas", "Chamados", "Rastreamento", "ERP", "Configurar Bot", "Assistente IA"

---

## 🔧 SOLUÇÃO PROPOSTA

### Passo 1: Normalizar Nomes de Módulos
- Criar função de conversão: `normalizeModuleName(name: string): string`
- Converter underscore → hífen ao receber do MegaAdmin
- Converter hífen → underscore ao enviar para MegaAdmin

### Passo 2: Corrigir Lógica de Permissões
- Se há permissões customizadas, usar APENAS as customizadas
- Aplicar filtro de módulos do cliente
- Não misturar com permissões da role

### Passo 3: Sincronizar Permissões ao Login
- Resolver permissões finais: role + customizações + módulos do cliente
- Retornar permissões em formato hífen (para MegaDesk)

### Passo 4: Atualizar Banco de Dados
- Converter permissões armazenadas de underscore → hífen
- Garantir consistência em todas as operações

---

## ✅ CHECKLIST DE VALIDAÇÃO

- [ ] Todos os módulos têm nomes consistentes (hífen no backend/MegaDesk, underscore no MegaAdmin)
- [ ] Permissões customizadas não são misturadas com role padrão
- [ ] Permissões customizadas respeitam módulos do cliente
- [ ] Permissões são sincronizadas corretamente ao login
- [ ] Banco de dados armazena permissões em formato consistente
- [ ] Testes cobrem todos os cenários de permissões
- [ ] MegaDesk mostra apenas módulos liberados
- [ ] MegaAdmin reflete exatamente o que MegaDesk mostra

