# Guia de Teste Manual - 5 Chamados Reais

## 🎯 Objetivo
Validar que o sistema de chamados está salvando e recuperando dados corretamente do banco de dados.

## 📋 Pré-requisitos
- Servidor rodando em http://localhost:3000
- Estar autenticado como usuário Manus
- Acesso ao dashboard MegaDesk

---

## ✅ Passo 1: Acessar a Página de Chamados

1. Clique em **"Acessar Dashboard"** na página inicial
2. Faça login com sua conta Manus (se necessário)
3. No sidebar esquerdo, clique no ícone de **Chamados** (📋)
4. Você deve ver uma tabela tipo Excel com colunas: **ID | Abertura | Nome e Cliente | Título | Atendente**

**Validação:** A página carrega sem erros e mostra a tabela vazia ou com chamados existentes.

---

## ✅ Passo 2: Criar Primeiro Chamado (CRÍTICO)

Procure por um botão "+ Novo Chamado" ou similar na página. Se não encontrar, use a interface existente para criar um novo chamado com os dados abaixo:

### Chamado #1 - Sistema de Login
```
Nome do Cliente:      João Silva
Empresa:             Empresa XYZ Ltda
Título:              Sistema de login não funciona
Observações:         Erro 500 ao tentar fazer login. Afeta todos os usuários.
Prioridade:          Crítica
```

**Validação:**
- [ ] Chamado aparece na tabela com número #0001
- [ ] Status é "open" (aberto)
- [ ] Data de criação é hoje
- [ ] Prioridade mostra badge "Crítica" em vermelho

---

## ✅ Passo 3: Criar Segundo Chamado (ALTA)

### Chamado #2 - Relatório de Vendas
```
Nome do Cliente:      Maria Santos
Empresa:             Consultoria ABC
Título:              Relatório de vendas com erro
Observações:         Números não batem com o período anterior
Prioridade:          Alta
```

**Validação:**
- [ ] Chamado aparece na tabela com número #0002
- [ ] Aparece abaixo do chamado #0001
- [ ] Prioridade mostra badge "Alta" em laranja

---

## ✅ Passo 4: Criar Terceiro Chamado (MÉDIA)

### Chamado #3 - Integração ERP
```
Nome do Cliente:      Pedro Costa
Empresa:             Indústria DEF
Título:              Integração com sistema ERP
Observações:         Precisa conectar com SAP para sincronizar dados
Prioridade:          Média
```

**Validação:**
- [ ] Chamado aparece com número #0003
- [ ] Prioridade mostra badge "Média" em amarelo

---

## ✅ Passo 5: Criar Quarto Chamado (ALTA)

### Chamado #4 - Backup Automático
```
Nome do Cliente:      João Silva
Empresa:             Empresa XYZ Ltda
Título:              Backup automático não está funcionando
Observações:         Última execução foi há 5 dias
Prioridade:          Alta
```

**Validação:**
- [ ] Chamado aparece com número #0004
- [ ] Mesmo cliente do chamado #1 (João Silva)
- [ ] Prioridade em laranja

---

## ✅ Passo 6: Criar Quinto Chamado (MÉDIA)

### Chamado #5 - Autenticação 2FA
```
Nome do Cliente:      Ana Oliveira
Empresa:             Startup Tech
Título:              Configurar autenticação de dois fatores
Observações:         Implementar 2FA para aumentar segurança
Prioridade:          Média
```

**Validação:**
- [ ] Chamado aparece com número #0005
- [ ] Prioridade em amarelo

---

## ✅ Passo 7: Validar Tabela Completa

Após criar os 5 chamados, verifique:

- [ ] Todos os 5 chamados aparecem na tabela
- [ ] Números incrementam corretamente (#0001 a #0005)
- [ ] Nomes de clientes estão corretos
- [ ] Títulos estão corretos
- [ ] Status badges mostram cores corretas
- [ ] Datas de criação são todas "Hoje"

---

## ✅ Passo 8: Testar Modal de Detalhes

1. Clique na linha do **Chamado #1** (Sistema de login)
2. Um modal deve abrir mostrando:
   - Título: "Sistema de login não funciona"
   - Status: "Aberto"
   - Prioridade: "Crítica"
   - Timeline vazia ou com atividades

**Validação:**
- [ ] Modal abre sem erros
- [ ] Dados do chamado estão corretos
- [ ] Botões "Registrar Atividade", "Status do Chamado", "Atendente Responsável" aparecem

---

## ✅ Passo 9: Adicionar Atividade ao Chamado

1. No modal do Chamado #1, clique em **"Registrar Atividade"**
2. Adicione uma atividade:
   ```
   Descrição: Primeiro contato com cliente, sistema offline
   Atendente: João Silva
   ```
3. Clique em **"Salvar"**

**Validação:**
- [ ] Atividade aparece na timeline
- [ ] Timeline mostra data/hora da atividade
- [ ] Atendente é exibido corretamente

---

## ✅ Passo 10: Testar Persistência

1. Feche o modal (clique em X ou fora do modal)
2. **Recarregue a página** (F5 ou Ctrl+R)
3. Clique novamente no **Chamado #1**

**Validação:**
- [ ] Todos os 5 chamados ainda aparecem na tabela
- [ ] Chamado #1 ainda tem a atividade que foi adicionada
- [ ] Dados não foram perdidos após recarregar

---

## ✅ Passo 11: Testar Filtros

1. Clique no card **"Total"** no topo
2. Verifique que mostra todos os 5 chamados (excluindo fechados)

3. Clique no card **"Abertos"**
4. Verifique que mostra apenas chamados com status "open"

5. Clique em um chamado e mude o status para **"Em Progresso"**
6. Clique no card **"Em Progresso"**
7. Verifique que o chamado aparece neste filtro

**Validação:**
- [ ] Filtros funcionam corretamente
- [ ] Números de chamados mudam ao filtrar
- [ ] Filtro "Total" exclui chamados fechados

---

## ✅ Passo 12: Testar Paginação

Com 5 chamados, a paginação deve estar ativa (10 por página):

- [ ] Botão "Próxima" está desabilitado (só 1 página)
- [ ] Botão "Anterior" está desabilitado
- [ ] Informação de página mostra "Página 1 de 1"

Se criar mais de 10 chamados:
- [ ] Botão "Próxima" fica habilitado
- [ ] Clicando "Próxima" mostra próximos 10 chamados
- [ ] Clicando "Anterior" volta para primeira página

**Validação:**
- [ ] Paginação funciona corretamente

---

## 📊 Checklist Final de Validação

Marque todos os itens abaixo para confirmar que o sistema está funcionando perfeitamente:

- [ ] 5 chamados criados com sucesso
- [ ] Todos os chamados aparecem na tabela
- [ ] Números incrementam corretamente (#0001 a #0005)
- [ ] Dados persistem após recarregar página
- [ ] Modal de detalhes abre corretamente
- [ ] Atividades são salvas e exibidas
- [ ] Atividades persistem após recarregar
- [ ] Filtros funcionam corretamente
- [ ] Paginação funciona
- [ ] Status badges mostram cores corretas
- [ ] Datas de criação estão corretas
- [ ] Clientes corretos aparecem em cada chamado
- [ ] Prioridades corretas aparecem em cada chamado

---

## 🔍 Diagnóstico do Banco de Dados

Se algo não funcionar, execute as queries abaixo para diagnosticar:

```sql
-- Verificar quantos chamados foram criados
SELECT COUNT(*) as total_chamados FROM megadesk_domain_tickets;

-- Ver últimos 5 chamados criados
SELECT chamadoNumber, problem, status, customer, company, createdAt 
FROM megadesk_domain_tickets 
ORDER BY createdAt DESC 
LIMIT 5;

-- Verificar atividades
SELECT COUNT(*) as total_atividades FROM megadesk_domain_chamado_activities;

-- Ver atividades por chamado
SELECT ca.chamadoId, ca.description, ca.attendant, ca.createdAt
FROM megadesk_domain_chamado_activities ca
ORDER BY ca.createdAt DESC
LIMIT 10;

-- Verificar sequência de chamados
SELECT * FROM megadesk_domain_chamado_sequence;
```

---

## ✨ Conclusão

Se todos os itens do checklist foram marcados como ✅, o sistema de chamados está **100% funcional** e pronto para produção!

Parabéns! 🎉
