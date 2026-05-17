# Documentação de API - MegaDesk Platform

## Visão Geral

MegaDesk usa **tRPC** para comunicação entre frontend e backend. tRPC oferece type-safety completo, sem necessidade de REST manual.

## Índice

1. [Conceitos Básicos](#conceitos-básicos)
2. [Autenticação](#autenticação)
3. [Procedures Disponíveis](#procedures-disponíveis)
4. [Exemplos de Uso](#exemplos-de-uso)
5. [Tratamento de Erros](#tratamento-de-erros)
6. [Rate Limiting](#rate-limiting)

## Conceitos Básicos

### O que é tRPC?

tRPC permite definir APIs type-safe sem necessidade de REST ou GraphQL. Você define procedures no backend e os consome no frontend com type-safety completo.

### Estrutura

```typescript
// Backend (server/routers.ts)
export const router = {
  chamados: {
    list: protectedProcedure
      .input(z.object({ offset: z.number(), limit: z.number() }))
      .query(async ({ ctx, input }) => {
        // Implementação
      }),
  },
};

// Frontend (client/src/pages/Home.tsx)
const { data } = trpc.chamados.list.useQuery({ offset: 0, limit: 10 });
```

### Tipos de Procedures

- **publicProcedure**: Sem autenticação
- **protectedProcedure**: Requer autenticação (ctx.user)
- **adminProcedure**: Requer role admin (ctx.user.role === 'admin')

## Autenticação

### Fluxo de Autenticação

```typescript
// 1. Obter URL de login
const loginUrl = getLoginUrl('/dashboard');

// 2. Usuário faz login
// Redirect para Manus OAuth

// 3. Callback em /api/oauth/callback
// Session cookie criado

// 4. Todas as requisições tRPC incluem cookie automaticamente
// ctx.user é preenchido automaticamente
```

### Verificar Autenticação

```typescript
// Frontend
const { data: user } = trpc.auth.me.useQuery();

if (!user) {
  return <LoginPage />;
}

// Backend
export const authRouter = router({
  me: publicProcedure.query(async ({ ctx }) => {
    return ctx.user || null;
  }),
});
```

### Logout

```typescript
// Frontend
const logoutMutation = trpc.auth.logout.useMutation();

const handleLogout = async () => {
  await logoutMutation.mutateAsync();
  // Redirecionar para login
};
```

## Procedures Disponíveis

### Autenticação

#### `auth.me`
- **Tipo**: Query
- **Autenticação**: Pública
- **Retorna**: Usuário autenticado ou null
- **Exemplo**:
  ```typescript
  const { data: user } = trpc.auth.me.useQuery();
  ```

#### `auth.logout`
- **Tipo**: Mutation
- **Autenticação**: Protegida
- **Retorna**: { success: boolean }
- **Exemplo**:
  ```typescript
  const logout = trpc.auth.logout.useMutation();
  await logout.mutateAsync();
  ```

### Chamados

#### `chamados.list`
- **Tipo**: Query
- **Autenticação**: Protegida
- **Input**:
  ```typescript
  {
    offset: number;    // Paginação
    limit: number;     // Quantidade por página
  }
  ```
- **Retorna**: Array de chamados
- **Exemplo**:
  ```typescript
  const { data: chamados } = trpc.chamados.list.useQuery({
    offset: 0,
    limit: 10,
  });
  ```

#### `chamados.getDetail`
- **Tipo**: Query
- **Autenticação**: Protegida
- **Input**:
  ```typescript
  {
    chamadoId: string;  // UUID do chamado
  }
  ```
- **Retorna**: Detalhes do chamado com atividades
- **Exemplo**:
  ```typescript
  const { data: detail } = trpc.chamados.getDetail.useQuery({
    chamadoId: "123e4567-e89b-12d3-a456-426614174000",
  });
  ```

#### `chamados.create`
- **Tipo**: Mutation
- **Autenticação**: Protegida
- **Input**:
  ```typescript
  {
    title: string;              // Título do chamado
    observations: string;       // Observações
    priority: "baixa" | "media" | "alta" | "critica";
  }
  ```
- **Retorna**: Chamado criado
- **Exemplo**:
  ```typescript
  const create = trpc.chamados.create.useMutation();
  const chamado = await create.mutateAsync({
    title: "Sistema não funciona",
    observations: "Erro 500 ao fazer login",
    priority: "critica",
  });
  ```

#### `chamados.update`
- **Tipo**: Mutation
- **Autenticação**: Protegida
- **Input**:
  ```typescript
  {
    chamadoId: string;
    title?: string;
    observations?: string;
    status?: "open" | "in_progress" | "waiting" | "closed";
    priority?: "baixa" | "media" | "alta" | "critica";
    assignedTo?: string;
  }
  ```
- **Retorna**: Chamado atualizado
- **Exemplo**:
  ```typescript
  const update = trpc.chamados.update.useMutation();
  await update.mutateAsync({
    chamadoId: "123e4567-e89b-12d3-a456-426614174000",
    status: "in_progress",
    assignedTo: "João Silva",
  });
  ```

#### `chamados.addActivity`
- **Tipo**: Mutation
- **Autenticação**: Protegida
- **Input**:
  ```typescript
  {
    chamadoId: string;
    description: string;
    type?: "created" | "updated" | "comment" | "status_change";
  }
  ```
- **Retorna**: Atividade criada
- **Exemplo**:
  ```typescript
  const addActivity = trpc.chamados.addActivity.useMutation();
  await addActivity.mutateAsync({
    chamadoId: "123e4567-e89b-12d3-a456-426614174000",
    description: "Cliente confirmou que problema foi resolvido",
    type: "comment",
  });
  ```

#### `chamados.editActivity`
- **Tipo**: Mutation
- **Autenticação**: Protegida
- **Input**:
  ```typescript
  {
    activityId: string;
    description: string;
  }
  ```
- **Retorna**: Atividade atualizada
- **Exemplo**:
  ```typescript
  const editActivity = trpc.chamados.editActivity.useMutation();
  await editActivity.mutateAsync({
    activityId: "activity-123",
    description: "Descrição corrigida",
  });
  ```

### Conversas

#### `conversas.list`
- **Tipo**: Query
- **Autenticação**: Protegida
- **Input**:
  ```typescript
  {
    status?: "open" | "bot" | "closed";
  }
  ```
- **Retorna**: Array de conversas
- **Exemplo**:
  ```typescript
  const { data: conversas } = trpc.conversas.list.useQuery({
    status: "open",
  });
  ```

#### `conversas.create`
- **Tipo**: Mutation
- **Autenticação**: Protegida
- **Input**:
  ```typescript
  {
    customerId: string;
    customerName: string;
    customerPhone: string;
  }
  ```
- **Retorna**: Conversa criada
- **Exemplo**:
  ```typescript
  const create = trpc.conversas.create.useMutation();
  const conversa = await create.mutateAsync({
    customerId: "customer-123",
    customerName: "João Silva",
    customerPhone: "11999999999",
  });
  ```

#### `conversas.close`
- **Tipo**: Mutation
- **Autenticação**: Protegida
- **Input**:
  ```typescript
  {
    conversaId: string;
  }
  ```
- **Retorna**: { success: boolean }
- **Exemplo**:
  ```typescript
  const close = trpc.conversas.close.useMutation();
  await close.mutateAsync({
    conversaId: "conversa-123",
  });
  ```

#### `conversas.updateCustomer`
- **Tipo**: Mutation
- **Autenticação**: Protegida
- **Input**:
  ```typescript
  {
    conversaId: string;
    customerName?: string;
    customerCompany?: string;
  }
  ```
- **Retorna**: Conversa atualizada
- **Exemplo**:
  ```typescript
  const update = trpc.conversas.updateCustomer.useMutation();
  await update.mutateAsync({
    conversaId: "conversa-123",
    customerName: "João Silva",
    customerCompany: "Empresa XYZ",
  });
  ```

### Atendimento Ativo

#### `megadesk.searchCustomer`
- **Tipo**: Query
- **Autenticação**: Protegida
- **Input**:
  ```typescript
  {
    phone: string;  // Número de telefone
  }
  ```
- **Retorna**: Cliente encontrado ou null
- **Exemplo**:
  ```typescript
  const { data: customer } = trpc.megadesk.searchCustomer.useQuery({
    phone: "11999999999",
  });
  ```

#### `megadesk.createCustomer`
- **Tipo**: Mutation
- **Autenticação**: Protegida
- **Input**:
  ```typescript
  {
    name: string;
    company: string;
    phone: string;
  }
  ```
- **Retorna**: Cliente criado
- **Exemplo**:
  ```typescript
  const create = trpc.megadesk.createCustomer.useMutation();
  const customer = await create.mutateAsync({
    name: "João Silva",
    company: "Empresa XYZ",
    phone: "11999999999",
  });
  ```

### MegaAdmin

#### `megaadmin.createClient`
- **Tipo**: Mutation
- **Autenticação**: Admin
- **Input**:
  ```typescript
  {
    name: string;
    email: string;
    phone: string;
  }
  ```
- **Retorna**: Cliente criado
- **Exemplo**:
  ```typescript
  const create = trpc.megaadmin.createClient.useMutation();
  const client = await create.mutateAsync({
    name: "Empresa ABC",
    email: "contato@empresa.com",
    phone: "1133333333",
  });
  ```

#### `megaadmin.updateClientAccess`
- **Tipo**: Mutation
- **Autenticação**: Admin
- **Input**:
  ```typescript
  {
    clientId: string;
    modules: string[];  // Array de módulos
  }
  ```
- **Retorna**: { success: boolean }
- **Exemplo**:
  ```typescript
  const update = trpc.megaadmin.updateClientAccess.useMutation();
  await update.mutateAsync({
    clientId: "client-123",
    modules: ["active-attendance", "conversations", "tickets"],
  });
  ```

## Exemplos de Uso

### Exemplo 1: Criar Chamado

```typescript
import { trpc } from "@/lib/trpc";

export function CreateTicket() {
  const utils = trpc.useUtils();
  const create = trpc.chamados.create.useMutation({
    onSuccess: () => {
      // Invalidar cache
      utils.chamados.list.invalidate();
      // Mostrar sucesso
      toast.success("Chamado criado com sucesso!");
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const handleSubmit = async (data: CreateTicketInput) => {
    await create.mutateAsync(data);
  };

  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      handleSubmit(/* dados */);
    }}>
      {/* Formulário */}
    </form>
  );
}
```

### Exemplo 2: Listar Chamados com Paginação

```typescript
import { trpc } from "@/lib/trpc";
import { useState } from "react";

export function TicketList() {
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const { data: chamados, isLoading } = trpc.chamados.list.useQuery({
    offset: (page - 1) * pageSize,
    limit: pageSize,
  });

  return (
    <div>
      {isLoading && <Spinner />}
      {chamados?.map((ticket) => (
        <TicketCard key={ticket.id} ticket={ticket} />
      ))}
      <Pagination page={page} onPageChange={setPage} />
    </div>
  );
}
```

### Exemplo 3: Atualizar Chamado com Otimismo

```typescript
import { trpc } from "@/lib/trpc";

export function UpdateTicket({ ticketId }: { ticketId: string }) {
  const utils = trpc.useUtils();
  const update = trpc.chamados.update.useMutation({
    onMutate: async (newData) => {
      // Cancelar queries pendentes
      await utils.chamados.list.cancel();

      // Snapshot dos dados antigos
      const previousData = utils.chamados.list.getData();

      // Atualizar cache otimisticamente
      utils.chamados.list.setData(
        { offset: 0, limit: 10 },
        (old) =>
          old?.map((ticket) =>
            ticket.id === ticketId ? { ...ticket, ...newData } : ticket
          )
      );

      return { previousData };
    },
    onError: (error, newData, context) => {
      // Reverter em caso de erro
      if (context?.previousData) {
        utils.chamados.list.setData(
          { offset: 0, limit: 10 },
          context.previousData
        );
      }
      toast.error("Erro ao atualizar chamado");
    },
    onSuccess: () => {
      toast.success("Chamado atualizado!");
    },
  });

  return (
    <button
      onClick={() =>
        update.mutate({
          chamadoId: ticketId,
          status: "in_progress",
        })
      }
    >
      Marcar como Em Progresso
    </button>
  );
}
```

## Tratamento de Erros

### Tipos de Erro

```typescript
// Erro de validação (Zod)
{
  code: "BAD_REQUEST",
  message: "Campo obrigatório: title"
}

// Erro de autenticação
{
  code: "UNAUTHORIZED",
  message: "Autenticação necessária"
}

// Erro de autorização
{
  code: "FORBIDDEN",
  message: "Você não tem permissão para esta ação"
}

// Erro interno
{
  code: "INTERNAL_SERVER_ERROR",
  message: "Erro ao processar requisição"
}
```

### Tratamento

```typescript
const mutation = trpc.chamados.create.useMutation({
  onError: (error) => {
    if (error.code === "BAD_REQUEST") {
      // Erro de validação
      toast.error(`Validação: ${error.message}`);
    } else if (error.code === "UNAUTHORIZED") {
      // Redirecionar para login
      window.location.href = getLoginUrl();
    } else if (error.code === "FORBIDDEN") {
      // Sem permissão
      toast.error("Você não tem permissão para esta ação");
    } else {
      // Erro genérico
      toast.error("Erro ao processar requisição");
    }
  },
});
```

## Rate Limiting

### Limites

- **100 requisições por minuto** por cliente
- Aplicado globalmente em todas as procedures

### Resposta de Rate Limit

```typescript
{
  code: "TOO_MANY_REQUESTS",
  message: "Limite de requisições excedido. Tente novamente em alguns segundos."
}
```

### Tratamento

```typescript
const mutation = trpc.chamados.create.useMutation({
  onError: (error) => {
    if (error.code === "TOO_MANY_REQUESTS") {
      toast.error("Muitas requisições. Aguarde alguns segundos.");
      // Implementar retry automático
      setTimeout(() => {
        mutation.mutate(data);
      }, 5000);
    }
  },
});
```

## Melhores Práticas

### 1. Sempre Invalidar Cache

```typescript
const utils = trpc.useUtils();

const mutation = trpc.chamados.create.useMutation({
  onSuccess: () => {
    // Invalidar cache de listagem
    utils.chamados.list.invalidate();
  },
});
```

### 2. Usar Otimismo para Melhor UX

```typescript
// Atualizar UI antes de confirmar no servidor
onMutate: async (newData) => {
  // Atualizar cache otimisticamente
  utils.chamados.list.setData(/* ... */);
},
onError: (error, newData, context) => {
  // Reverter em caso de erro
  utils.chamados.list.setData(/* context.previousData */);
},
```

### 3. Tratar Erros Apropriadamente

```typescript
// Diferenciar entre tipos de erro
if (error.code === "BAD_REQUEST") {
  // Erro de validação - mostrar ao usuário
} else if (error.code === "INTERNAL_SERVER_ERROR") {
  // Erro do servidor - oferecer retry
}
```

### 4. Implementar Loading States

```typescript
const { isLoading, isFetching } = trpc.chamados.list.useQuery();

if (isLoading) return <Skeleton />;
if (isFetching) return <Spinner />;
```

---

**Última atualização**: Maio de 2026
**Versão**: 1.0.0
