# MegaDesk Platform - TODO

## Fase 1: Integração e Configuração
- [x] Analisar código-fonte fornecido
- [x] Integrar código-fonte com scaffold Manus
- [x] Configurar schema Drizzle com tabelas multitenante
- [x] Executar migrações de banco de dados

## Fase 2: Autenticação e Contexto
- [x] Implementar autenticação JWT para MegaAdmin
- [x] Criar contexto de tenant para isolamento de dados
- [x] Implementar middleware de autenticação

## Fase 3: MegaAdmin - Backend (tRPC)
- [x] Criar router para gestão de administradores (CRUD)
- [x] Criar router para gestão de clientes (CRUD, módulos, tokens)
- [x] Criar router para dashboard (totais, logs de auditoria)
- [x] Criar router para login/logout de admin

## Fase 4: MegaDesk - Backend (tRPC)
- [x] Criar router para conversas receptivas (CRUD, status, histórico)
- [x] Criar router para chamados/tickets (CRUD, categorização, status)
- [x] Criar router para atendimento ativo (envio de mensagens)
- [x] Criar router para rastreio de encomendas (integração)
- [x] Criar router para ERP (registros operacionais)
- [x] Criar router para configuração do bot Gemini

## Fase 5: Integração IA
- [x] Integrar Gemini IA para assistente
- [x] Implementar roteamento automático por plataforma (URL)
- [x] Criar router para assistente IA
- [x] Criar componente UIAssistant com chat interativo

## Fase 6: MegaAdmin - Frontend
- [x] Implementar página de login com JWT
- [x] Implementar dashboard do MegaAdmin
- [x] Implementar gestão de administradores (CRUD UI)
- [x] Implementar gestão de clientes (CRUD UI, módulos, tokens)
- [x] Implementar logs de auditoria

## Fase 7: MegaDesk - Frontend
- [x] Implementar página de login/acesso de cliente
- [x] Implementar dashboard do MegaDesk
- [x] Implementar módulo de atendimento ativo
- [x] Implementar módulo de conversas receptivas
- [x] Implementar módulo de chamados
- [x] Implementar módulo de rastreio
- [x] Implementar módulo de ERP
- [x] Implementar módulo de configuração do bot
- [x] Implementar assistente IA integrado

## Fase 8: Testes e Validação
- [x] Escrever testes para autenticação
- [x] Escrever testes para CRUD de clientes
- [x] Escrever testes para isolamento de tenant
- [x] Validar sincronização entre MegaAdmin e MegaDesk
- [x] Testar fluxos de atendimento
- [x] Testar integração com Gemini IA

## Fase 9: Deployment
- [x] Criar checkpoint final
- [x] Validar ambiente de produção
- [x] Expor URLs públicas


## Fase 10: Correção de Bugs
- [x] Corrigir falha no login do MegaAdmin
- [x] Validar autenticação JWT
- [x] Testar roteamento entre MegaAdmin e MegaDesk


## Fase 11: Melhorias de UX
- [x] Refatorar permissões para ser por usuário individual
- [x] Remover seção de "Permissões por função"
- [x] Melhorar layout da página de permissões


## Fase 12: Correções Críticas
- [x] Investigar e corrigir cliente teste desaparecendo (aumentado refetchInterval)
- [x] Refatorar layout de permissões com ícone de engrenagem
- [x] Simplificar interface de permissões por usuário


## Fase 13: Correções Finais
- [x] Remover seção de Módulos do Sistema da aba de Permissões
- [x] Melhorar layout da seção de Permissões por Usuário (cards com fundo preto e borda laranja)
- [x] Corrigir erro de sincronização de senha entre MegaAdmin e MegaDesk (adicionado password_hash)


## Fase 14: BUG CRÍTICO - Clientes Desaparecendo
- [x] Investigar persistência de clientes após cadastro (causa: DELETE FROM megadesk_domain_clients)
- [x] Corrigir desaparecimento de clientes (solução: usar UPSERT em vez de DELETE/INSERT)
- [x] Implementar persistência em banco de dados (convertido para INSERT ... ON DUPLICATE KEY UPDATE)


## Fase 15: Correções Finais de UX
- [x] Corrigir erro de alteração de senha do usuário (INSERT com conexão direta ao banco)
- [x] Ajustar paleta de cores para padrão com o site (azul/slate em vez de preto/laranja)
- [x] Melhorar layout da seção de permissões do usuário (cards brancos, borda azul)


## Fase 16: BUG CRÍTICO - Clientes Desaparecem ao Fazer Logout
- [x] Investigar perda de dados ao fazer logout (causa: syncStateHydrated não era resetado)
- [x] Implementar carregamento de clientes do banco ao iniciar (reset do flag ao logout)
- [x] Garantir persistência real em banco de dados (dados agora são carregados do banco)

## Fase 17: Implementar Sistema de Permissões de Usuário
- [x] Investigar estrutura de permissões no banco de dados
- [x] Criar interface de edição de permissões no MegaAdmin
- [x] Implementar API de atualização de permissões
- [x] Sincronizar permissões com MegaDesk
- [x] Remover fundo branco da seção de permissões
- [x] Aplicar design consistente com MegaAdmin
- [x] Testar fluxo completo de permissões (testes automatizados passando)

## Fase 18: BUG CRÍTICO - Login do MegaDesk Falha Após Cadastro
- [x] Investigar sincronização de dados entre MegaAdmin e MegaDesk
- [x] Validar se cliente está sendo criado corretamente
- [x] Verificar se usuários estão sendo sincronizados (bug: status era sempre "blocked")
- [x] Corrigir fluxo de login no MegaDesk (usuários agora respeitam statusType)
- [x] Testar login completo (cadastro → login) - VALIDADO NO NAVEGADOR: cliente Ativo criado com sucesso, usuário com status active

## Fase 19: BUG CRÍTICO - Senha Não Sincroniza Entre MegaAdmin e MegaDesk
- [x] Investigar como a senha é armazenada no MegaAdmin (problema: usuários não eram criados com passwordHash na tabela megadeskDomainClientUsers)
- [x] Verificar como o MegaDesk valida a senha no login (procura por passwordHash na tabela megadeskDomainClientUsers)
- [x] Diagnosticar se há problema na sincronização de dados (usuários criados em memória mas não sincronizados com banco)
- [x] Implementar correção de sincronização de senha (adicionar passwordHash ao tipo MegaClient e sincronizar ao criar usuário)
- [x] Testar login com senha configurada (VALIDADO COMPLETO: login com senha padrão 123456, redefinir senha para SenhaNovaTest123, sincronizacao 100% funcional)

## Fase 20: Melhorias de UX - Filtros Clicáveis
- [x] Filtros clicáveis (Abertas, Atendimento BOT, Fechadas) com linhas separadoras
- [x] Adicionar efeito visual ao filtro selecionado (font-semibold)
- [x] Adicionar linhas finas separando os filtros
- [x] Testar interatividade dos filtros

## Fase 21: Animações dos Filtros
- [x] Implementar animação de pulse ao clicar nos filtros (scale 1 -> 1.05 -> 1)
- [x] Adicionar animação de underline ao filtro selecionado
- [x] Adicionar animação de slide-down no ponto colorido do filtro
- [x] Usar easing cubic-bezier(0.23, 1, 0.32, 1) para animações suaves
- [x] Testar animações em todos os filtros (Abertas, Atendimento BOT, Fechadas)

## Fase 22: Sistema de Atendimento Ativo com Busca de Cliente
- [x] Criar campo de entrada para numero do cliente
- [x] Implementar busca no banco de dados por numero de telefone
- [x] Exibir dados do cliente se existir (nome, empresa)
- [x] Criar formulario para novo cliente (nome, empresa) se nao existir
- [x] Adicionar opcao "abrir chamado?" com sim/nao
- [x] Se sim: adicionar campos de titulo e observacao do chamado
- [x] Se nao: redirecionar para pagina de Conversas
- [x] Integrar com tRPC (procedures searchCustomer, createCustomer, createTicket)
- [x] Testar fluxo completo (cliente existente e novo cliente)
- [x] Testar criacao de chamado com redirecionamento para Conversas
- [x] Criar tabela de clientes no banco de dados (megadesk_domain_customers)
- [x] Adicionar helpers de banco (searchCustomerByPhone, createCustomer, createTicket)
- [x] Corrigir procedures tRPC para usar banco de dados real
- [x] Adicionar testes Vitest para as procedures (7 testes passando)
- [x] Corrigir redirecionamento para pagina de Conversas

## Fase 23: Melhorias de Interface - Atendimento Ativo
- [x] Redesenhar layout com cards e gradientes modernos
- [x] Adicionar ícones visuais (telefone, usuário, empresa, etc)
- [x] Implementar estados visuais (carregando, sucesso, erro)
- [x] Adicionar animações de transição suaves
- [x] Melhorar hierarquia visual e espaçamento
- [x] Testar responsividade em mobile

## Fase 24: Correção de Bug - Interface Desaparecendo
- [x] Investigar causa do bug (estado active sendo resetado)
- [x] Implementar persistência do estado active no localStorage
- [x] Testar se a página persiste após recarregar
- [x] Validar que a interface não pisca mais
- [x] Bug corrigido com sucesso - página persiste após recarregar
- [x] Remover useLocation do wouter para evitar re-renderizações
- [x] Remover animações de fade-in que causavam piscar
- [x] Validar que o piscar foi eliminado (COMPLETO - interface renderiza suavemente)

## Fase 25: Diagnóstico e Correção do Piscar - Layout Fixo
- [x] Diagnosticar causa do piscar (conflito de renderização condicional)
- [x] Corrigir lógica de renderização para layout fixo
- [x] Remover renderizações condicionais que causam piscar
- [x] Verificar funcionalidade de busca de cliente (FUNCIONANDO: encontrou João Silva)
- [x] Verificar funcionalidade de criação de cliente (PRONTO)
- [x] Verificar funcionalidade de criação de ticket (PRONTO - chamado criado com sucesso!)
- [x] Validar que o layout permanece fixo sem piscar (COMPLETO - sem piscar!)
- [x] Corrigir mapeamento de dados do cliente (customerId vs id)
- [x] Testar fluxo completo com criação de chamado (100% FUNCIONAL)
- [x] FASE COMPLETA - Interface estável, bonita e totalmente funcional!

## Fase 26: Correção de Redirecionamento - Abrir Conversa
- [x] Implementar redirecionamento para página de Conversas ao clicar em "Abrir Conversa"
- [x] Passar ID da conversa como parâmetro na URL (clientId e phone)
- [x] Abrir automaticamente a conversa do cliente na página de Conversas
- [x] Testar fluxo completo (Atendimento Ativo → Conversas com parâmetros)
- [x] Capturar parâmetros na página de Conversas com useEffect
- [x] Limpar parâmetros da URL após captura
- [x] Corrigir redirecionamento para chamar onNavigate('conversations')
- [x] FASE COMPLETA - Redirecionamento 100% funcional! (TESTADO E VALIDADO NO NAVEGADOR)

## Fase 27: Criar Conversa e Exibir na Aba Abertas
- [x] Criar procedure tRPC para criar conversa no banco
- [x] Chamar procedure ao clicar em "Abrir Conversa"
- [x] Passar ID da conversa criada para página de Conversas
- [x] Exibir conversa automaticamente na aba "Abertas"
- [x] Testar fluxo completo (Atendimento Ativo → Conversas → Aba Abertas com nova conversa)

## Fase 28: Melhorias na Navegação e Exibição de Conversas
- [x] Atualizar navegação de ActiveAttendance para sempre enviar conversationId
- [x] Substituir mockConversations por dados reais em ConversationsPage
- [x] Auto-selecionar conversa criada no filtro "Abertas"
- [x] Adicionar testes Vitest para createConversation
- [x] Testar fluxo completo no navegador

## Fase 29: Integração de Conversas com Backend
- [x] Criar tRPC query para carregar conversas do banco de dados
- [x] Integrar query em ConversationsPage para carregar dados reais
- [x] Persistir nova conversa criada no localStorage/estado
- [x] Garantir que conversa criada apareça na lista antes de auto-selecionar
- [x] Testar fluxo completo: Atendimento Ativo → Criar Conversa → Aparecer em Abertas

## Fase 30: Encerramento de Conversa e Edição de Cliente
- [x] Criar procedure tRPC para encerrar conversa (mover para status "closed")
- [x] Criar procedure tRPC para atualizar dados do cliente (nome e empresa)
- [x] Implementar botão de encerrar conversa na UI
- [x] Implementar modal de edição de cliente com ícone de engrenagem
- [x] Integrar mutations no frontend (ConversationsPage)
- [x] Adicionar testes Vitest para as novas procedures
- [x] Testar fluxo completo: encerrar conversa e editar cliente

## Fase 31: Ajustes de UI - Botão de Encerrar Conversa
- [x] Mover botão de encerrar conversa para canto superior direito
- [x] Posicionar ao lado da engrenagem de edição
- [x] Reduzir tamanho do botão para ícone
- [x] Usar ícone apropriado (X ou Close)
- [x] Testar layout responsivo

## Fase 32: Reorganizar Abas de Conversas e Ajustar UI
- [x] Reorganizar lógica de filtro para separar conversas por status correto
  - [x] "Abertas" = status "open" (atendimento ativo)
  - [x] "Bot" = status "bot" (mensagens receptivas)
  - [x] "Fechadas" = status "closed" (atendimentos finalizados)
- [x] Mover engrenagem de edição para inline com nome do cliente
- [x] Remover botão X de encerrar do header
- [x] Adicionar botão "Encerrar Conversa" com texto no painel de chat
- [x] Implementar dialog de confirmação (Sim/Não) para encerrar
- [x] Testar fluxo completo de criação, edição e encerramento

## Fase 33: Ajustar Card de Conversa na Aba Abertas
- [x] Mostrar nome da empresa no lugar do número
- [x] Substituir "Conversa Iniciada" pela última mensagem
- [x] Destacar em negrito mensagens não lidas do cliente
- [x] Adicionar campo de status de leitura na conversa

## Fase 34: Reorganizar Sistema de Chamados (UI/Mock Data)
- [x] Implementar UI com cards clicáveis por status
- [x] Adicionar detalhes do chamado (cliente, título, observações)
- [x] Implementar controle de status (Aberto, Em Progresso, Aguardando)
- [x] Adicionar botão de encerrar chamado no canto superior direito
- [x] Implementar busca básica com mock data
- [x] Testar layout e interações

## Fase 35: Melhorias no Sistema de Chamados (UI/Layout)
- [x] Melhorar layout dos cards da lista de chamados com status badges
- [x] Adicionar campos editáveis para título e observações
- [x] Reorganizar layout: diminuir cards de status, aumentar lista e detalhes
- [x] Refatorar painel de detalhes com status/prioridade/responsável em 1 linha
- [x] Implementar modo de edição geral com botão "Salvar Edição"

## Fase 36: REFATORAÇÃO COMPLETA - Layout Tipo Excel
- [x] Remover painel de detalhes do lado direito
- [x] Manter cards de status (Total, Abertos, Em Progresso, etc) no topo
- [x] Manter filtro de pesquisa
- [x] Criar tabela tipo Excel com colunas: ID | Abertura | Nome e Cliente | Título | Atendente
- [x] Implementar clique em linha para abrir modal de detalhes com timeline
- [x] Refatorar TicketsPage com novo layout e mock data com timeline

## Fase 37: Modal de Detalhes com Timeline
- [x] Criar modal que abre ao clicar em linha da tabela
- [x] Exibir título geral do chamado no topo
- [x] Implementar timeline vertical com atividades cronológicas
- [x] Adicionar botões: "Registrar atividade", "Status do chamado", "Atendente Responsável"
- [x] Implementar ícone de edição em cada balão de atividade
- [x] Permitir edição de atividades existentes
- [x] Adicionar testes Vitest para timeline (27 testes de integração passando)

## Fase 38: Integração de Chamados com Backend
- [x] Criar schema de chamados com numeração sequencial no banco
- [x] Criar procedures tRPC para CRUD de chamados (list, getDetail, create, update, addActivity, editActivity)
- [x] Criar helpers de banco de dados para chamados
- [x] Implementar isolamento de chamados por cliente autenticado
- [x] Adicionar filtro "Total" excluindo chamados fechados
- [x] Integrar TicketsPage com dados reais do banco (tabela Excel + modal timeline)
- [x] Implementar busca avançada (nome, nº cliente, nº chamado)
- [x] Adicionar testes Vitest para procedures tRPC (22 testes passando)
- [x] Testar fluxo completo com persistência real


## Fase 39: Testes de Fluxo Completo
- [x] Testar navegação para aba de Chamados
- [x] Testar exibição da tabela Excel com dados do backend
- [x] Testar clique em linha para abrir modal
- [x] Testar timeline com atividades
- [x] Testar filtros (Total, Abertos, Em Progresso, etc)
- [x] Testar busca avançada
- [x] Testar registrar nova atividade
- [x] Testar editar atividade existente
- [x] Testar alterar status do chamado
- [x] Testar alterar atendente responsável (33 testes E2E passando)

## Fase 40: Proteção de Autenticação nas Procedures
- [x] Migrar chamadosRouter para usar protectedProcedure
- [x] Derivar clientId do ctx.user em vez de receber como parâmetro
- [x] Validar que usuário só acessa chamados do seu cliente
- [x] Adicionar testes para isolamento de autenticação
- [x] Testar acesso negado para clientes não autorizados
- [x] Validar segurança de dados entre clientes

## Fase 41: Implementar Paginação na Tabela
- [x] Adicionar estado de página (currentPage, pageSize)
- [x] Modificar procedure list para aceitar offset e limit
- [x] Adicionar controles de navegação (Anterior, Próxima, Ir para página)
- [x] Exibir informação de total de registros e página atual
- [x] Implementar salto para página específica
- [x] Testar paginação com diferentes tamanhos de página
- [x] Otimizar performance com paginação (10 registros por página)


## Fase 42: Teste Manual de 5 Chamados Reais

### Instruções para Testar:

1. **Acessar o Dashboard:**
   - Clique em "Acessar Dashboard" na página inicial
   - Faça login com sua conta Manus

2. **Navegar para Chamados:**
   - No sidebar, clique no ícone de "Chamados" (📋)
   - Você verá a página de chamados com tabela tipo Excel

3. **Criar 5 Chamados:**
   - Clique no botão "+ Novo Chamado" (se disponível) ou use a interface
   - Preencha os dados:

   **Chamado 1 - CRÍTICO:**
   - Nome: João Silva
   - Empresa: Empresa XYZ Ltda
   - Título: Sistema de login não funciona
   - Observações: Erro 500 ao tentar fazer login. Afeta todos os usuários.
   - Prioridade: Crítica

   **Chamado 2 - ALTA:**
   - Nome: Maria Santos
   - Empresa: Consultoria ABC
   - Título: Relatório de vendas com erro
   - Observações: Números não batem com o período anterior
   - Prioridade: Alta

   **Chamado 3 - MÉDIA:**
   - Nome: Pedro Costa
   - Empresa: Indústria DEF
   - Título: Integração com sistema ERP
   - Observações: Precisa conectar com SAP para sincronizar dados
   - Prioridade: Média

   **Chamado 4 - ALTA:**
   - Nome: João Silva
   - Empresa: Empresa XYZ Ltda
   - Título: Backup automático não está funcionando
   - Observações: Última execução foi há 5 dias
   - Prioridade: Alta

   **Chamado 5 - MÉDIA:**
   - Nome: Ana Oliveira
   - Empresa: Startup Tech
   - Título: Configurar autenticação de dois fatores
   - Observações: Implementar 2FA para aumentar segurança
   - Prioridade: Média

4. **Validar Persistência:**
   - Após criar cada chamado, verifique se aparece na tabela
   - Clique em um chamado para abrir o modal de detalhes
   - Verifique se os dados estão corretos
   - Adicione uma atividade ao chamado
   - Feche e reabra o modal - a atividade deve estar lá

5. **Testar Filtros:**
   - Clique nos cards de status (Total, Abertos, etc)
   - Verifique se a tabela filtra corretamente

6. **Testar Paginação:**
   - Com 5 chamados, a paginação deve funcionar
   - Clique em "Próxima" e "Anterior"

### Checklist de Validação:

- [x] Guia de teste manual criado (TESTE_MANUAL_5_CHAMADOS.md)
- [x] Instruções passo a passo para criar 5 chamados
- [x] Checklist de validação de persistência
- [x] Queries SQL para diagnóstico do banco

### Diagnóstico do Banco:

Após criar os chamados, execute:
```bash
# Verificar tabela de chamados
SELECT COUNT(*) FROM megadesk_domain_tickets WHERE clientId = 'seu-cliente-id';

# Ver últimos chamados
SELECT chamadoNumber, problem, status, createdAt FROM megadesk_domain_tickets 
ORDER BY createdAt DESC LIMIT 5;

# Verificar atividades
SELECT COUNT(*) FROM megadesk_domain_chamado_activities;
```


## Fase 43: Criar Interface de Novo Chamado
- [ ] Adicionar botão "+ Novo Chamado" na página de chamados
- [ ] Criar modal/dialog para novo chamado
- [ ] Implementar formulário com campos: Nome Cliente, Empresa, Título, Observações, Prioridade
- [ ] Validar campos obrigatórios
- [ ] Integrar com procedure tRPC chamados.create
- [ ] Exibir mensagem de sucesso/erro
- [ ] Limpar formulário após sucesso
- [ ] Testar criação de novo chamado via interface

## Fase 44: Implementar Busca Avançada
- [ ] Adicionar filtro por data (data inicial e final)
- [ ] Adicionar filtro por atendente responsável
- [ ] Adicionar busca por número do chamado (#0001, #0002, etc)
- [ ] Adicionar busca por nome do cliente
- [ ] Combinar múltiplos filtros
- [ ] Exibir quantidade de resultados
- [ ] Adicionar botão "Limpar Filtros"
- [ ] Testar busca avançada com diferentes combinações

## Fase 45: Adicionar Exportação de Relatórios
- [ ] Criar botão "Exportar" na página de chamados
- [ ] Implementar exportação para CSV
- [ ] Implementar exportação para PDF
- [ ] Incluir filtros aplicados na exportação
- [ ] Adicionar cabeçalho com data/hora da exportação
- [ ] Testar exportação com diferentes filtros
- [ ] Validar integridade dos dados exportados


## Fase 43: Criar Interface de Novo Chamado
- [x] Botão "+Novo Chamado" na tabela
- [x] Modal com formulário
- [x] Campos: Nome Cliente, Empresa, Título, Observações, Prioridade
- [x] Validação de campos obrigatórios
- [x] Integração com tRPC
- [x] Mensagens de sucesso/erro
- [x] Novo chamado aparece imediatamente na tabela

## Fase 44: Implementar Busca Avançada
- [x] Botão "Avançado" para expandir filtros
- [x] Filtro por Nº Chamado (#0001)
- [x] Filtro por Nome Cliente
- [x] Filtro por Data Início
- [x] Filtro por Data Fim
- [x] Botão "Limpar Filtros"
- [x] Exibir quantidade de resultados
- [x] Filtros aplicados em tempo real

## Fase 45: Adicionar Exportação de Relatórios
- [x] Botão "CSV" para exportar em CSV
- [x] Botão "Relatório" para exportar em texto
- [x] Exportação respeita filtros aplicados
- [x] Cabeçalho com data/hora de exportação
- [x] Validação antes de exportar
- [x] Mensagens de sucesso/erro
- [x] Arquivo baixado automaticamente

## Fase 46: Testes e Validação
- [x] 20 testes Vitest passando
- [x] Testes de validação de formulário
- [x] Testes de filtros avançados
- [x] Testes de exportação
- [x] Testes de integração
- [x] Cobertura de casos de sucesso e erro


## Fase 47: Verificar Funcionalidade de Abrir Chamado no Atendimento Ativo - COMPLETA
- [x] Verificar se botão "Abrir Chamado?" está funcional (VERIFICADO)
- [x] Validar se chamado é criado corretamente (VALIDADO)
- [x] Verificar se dados do cliente são sincronizados (VERIFICADO)
- [x] Testar redirecionamento para página de Conversas (TESTADO)
- [x] Confirmar que chamado aparece na aba "Abertas" de Chamados (CONFIRMADO)

## Fase 48: Adicionar Opção de Abrir Conversa na Página de Chamados - COMPLETA
- [x] Adicionar botão "Abrir Conversa" em cada linha da tabela (IMPLEMENTADO)
- [x] Implementar funcionalidade de abrir conversa do cliente (IMPLEMENTADO)
- [x] Sincronizar com página de Conversas (IMPLEMENTADO)
- [x] Passar dados do cliente e chamado para Conversas (IMPLEMENTADO)
- [x] Testar fluxo completo (TESTADO)

## Fase 49: Integração com WhatsApp - Sincronizar Chamados - ADIADA
- [~] Criar estrutura de integração com WhatsApp API (ADIADA - requer configuração externa)
- [~] Implementar webhook para receber mensagens do WhatsApp (ADIADA)
- [~] Criar procedure tRPC para sincronizar mensagens com chamados (ADIADA)
- [~] Adicionar campo de número WhatsApp no cliente (ADIADA)
- [~] Sincronizar conversas do WhatsApp com chamados (ADIADA)
- [~] Testar recebimento de mensagens do WhatsApp (ADIADA)

## Fase 50: Testes e Validação - COMPLETA
- [x] Testar fluxo completo de Atendimento Ativo → Chamado → Conversa (TESTADO)
- [~] Testar sincronização de WhatsApp com chamados (ADIADA)
- [x] Testar abrir conversa da página de Chamados (TESTADO)
- [x] Validar persistência de dados (VALIDADO)
- [x] Criar testes Vitest para novas funcionalidades (80+ testes passando)

## Fase 51: Adicionar Botão "Novo Chamado" em Home.tsx
- [x] Adicionar estado para modal de novo chamado em Home.tsx
- [x] Adicionar botão "Novo Chamado" na barra de filtro
- [x] Implementar modal de criação de chamado com validação
- [x] Integrar com mutation tRPC para criar chamado
- [x] Testar fluxo completo de criação de chamado

## Fase 52: Sugestões de Acompanhamento - Performance e Otimização
- [ ] Implementar paginação lazy-loading na tabela de chamados
- [ ] Adicionar cache de dados com React Query
- [ ] Otimizar queries tRPC com select e include
- [x] Implementar debounce na busca
- [ ] Adicionar índices no banco de dados para queries frequentes

## Fase 53: Sugestões de Acompanhamento - Validações Avançadas
- [x] Validar email do cliente no formulário de novo chamado
- [x] Validar telefone com máscara
- [x] Adicionar validação de comprimento máximo de campos
- [ ] Implementar validação de duplicação de chamados
- [x] Adicionar confirmação antes de deletar/encerrar chamado

## Fase 54: Sugestões de Acompanhamento - Testes Adicionais
- [x] Adicionar testes de validações
- [ ] Adicionar testes de performance
- [ ] Implementar testes de acessibilidade (a11y)
- [ ] Adicionar testes de responsividade
- [ ] Criar testes de integração com banco de dados

## Fase 55: Sugestões de Acompanhamento - UX/UI Melhorias
- [x] Adicionar animações de transição entre páginas
- [x] Implementar skeleton loaders para tabelas
- [x] Adicionar ícones visuais para status de chamados
- [x] Melhorar feedback visual de ações
- [x] Implementar dark mode completo

## Fase 56: Sugestões de Acompanhamento - Documentação
- [ ] Criar guia de uso para usuários finais
- [ ] Documentar APIs tRPC
- [ ] Criar diagrama de arquitetura
- [ ] Documentar fluxos de negócio
- [ ] Criar manual de administrador

## Fase 57: Sugestões de Acompanhamento - Testes E2E
- [ ] Implementar testes E2E com Playwright
- [ ] Testar fluxo completo de criação de chamado
- [ ] Testar fluxo de conversas
- [ ] Testar exportação de relatórios
- [ ] Testar integração entre módulos


## Fase 58: Melhorar Layout do Formulário de Novo Chamado
- [x] Melhorar fundo e borda do modal
- [x] Adicionar cores e estilos profissionais
- [x] Melhorar visibilidade dos campos
- [x] Adicionar sombras e efeitos visuais
- [x] Testar no navegador


## BUG: Erro ao Criar Chamado - RESOLVIDO ✅
- [x] Investigar erro ao criar chamado - Problema: colisão de chamadoNumber único global
- [x] Verificar logs do servidor - Confirmado: erro de SQL com unique constraint
- [x] Verificar console do navegador - Sem erros específicos
- [x] Corrigir db-chamados.ts para usar megadeskDomainChamados em vez de megadeskDomainTickets
- [x] Criar fallback de autenticação em context.ts
- [x] Remover unique() global e adicionar índice único composto (client_id, chamado_number)
- [x] Aplicar migration SQL para remover unique global
- [x] Testar fluxo completo com autenticação - RESOLVIDO: Removido clientId de todas as queries/mutations, agora derivado de ctx.tenantId


## Fase 59: Diagnóstico Completo e Melhorias de Robustez - CONCLUÍDO ✅
- [x] Diagnosticar saúde do servidor Node.js
- [x] Verificar integridade do banco de dados
- [x] Analisar schema Drizzle para inconsistências
- [x] Revisar procedures tRPC para validações inadequadas
- [x] Implementar logging estruturado
- [x] Implementar retry logic com backoff exponencial
- [x] Adicionar validações Zod mais rigorosas
- [x] Implementar sanitização de inputs
- [x] Adicionar rate limiting
- [x] Adicionar health checks
- [x] Criar testes de robustez (39 testes passando)
- [x] Documentar arquitetura de tratamento de erros
- [x] Criar guia de diagnóstico completo
