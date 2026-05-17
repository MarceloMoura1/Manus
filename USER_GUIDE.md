# Guia de Uso - MegaDesk Platform

## Bem-vindo ao MegaDesk!

MegaDesk é uma plataforma completa de helpdesk e comunicação que permite gerenciar atendimento ao cliente de forma eficiente e inteligente.

## Índice

1. [Começando](#começando)
2. [Atendimento Ativo](#atendimento-ativo)
3. [Conversas](#conversas)
4. [Chamados](#chamados)
5. [Rastreio](#rastreio)
6. [ERP](#erp)
7. [Bot & Configurações](#bot--configurações)
8. [Assistente IA](#assistente-ia)
9. [Dicas e Truques](#dicas-e-truques)

## Começando

### Login

1. Acesse a plataforma MegaDesk
2. Clique em "Acessar Dashboard"
3. Faça login com sua conta Manus
4. Você será redirecionado para o dashboard principal

### Dashboard Principal

O dashboard mostra:
- **Atalhos Principais**: Acesso rápido aos módulos mais usados
- **Atividades Recentes**: Últimas ações realizadas
- **Estatísticas**: KPIs e métricas importantes

## Atendimento Ativo

O módulo de Atendimento Ativo permite buscar e contatar clientes proativamente.

### Como Usar

1. Clique em **"Atendimento Ativo"** no menu lateral
2. Digite o **número de telefone** do cliente
3. Clique em **"Buscar"**

### Cenários

#### Cliente Encontrado
- Dados do cliente aparecem (nome, empresa)
- Pergunta: "Deseja abrir um chamado?"
  - **Sim**: Preencha título e observações do chamado
  - **Não**: Abre conversa com o cliente

#### Cliente Não Encontrado
- Formulário para criar novo cliente
- Preencha nome e empresa
- Escolha se deseja abrir chamado ou conversa
- Cliente é criado e conversa é aberta

### Dicas
- Use números com formato: 11999999999 (sem caracteres especiais)
- Dados do cliente são salvos automaticamente
- Conversa é criada automaticamente ao abrir

## Conversas

O módulo de Conversas gerencia comunicação receptiva com clientes.

### Abas de Conversas

#### 🟢 Abertas
- Conversas ativas com clientes
- Requerem resposta do atendente

#### 🤖 Atendimento BOT
- Conversas gerenciadas por bot IA
- Podem ser escaladas para atendente

#### ⚫ Fechadas
- Conversas finalizadas
- Arquivo histórico

### Como Usar

1. Clique em **"Conversas"** no menu lateral
2. Selecione uma aba (Abertas, Bot, Fechadas)
3. Clique em uma conversa para abrir
4. Veja histórico de mensagens
5. Digite resposta e envie

### Ações Disponíveis

- **Enviar Mensagem**: Digite e clique "Enviar"
- **Editar Cliente**: Clique na engrenagem ⚙️
  - Altere nome e empresa
  - Clique "Salvar"
- **Encerrar Conversa**: Clique "Encerrar Conversa"
  - Confirme a ação
  - Conversa move para "Fechadas"

### Dicas
- Mensagens não lidas aparecem em **negrito**
- Última mensagem aparece no card da conversa
- Histórico é salvo automaticamente

## Chamados

O módulo de Chamados gerencia tickets de suporte com timeline completa.

### Visualizar Chamados

1. Clique em **"Chamados"** no menu lateral
2. Veja tabela com todos os chamados
3. Filtros disponíveis:
   - **Total**: Todos os chamados (exceto fechados)
   - **Abertos**: Status "Aberto"
   - **Em Progresso**: Status "Em Progresso"
   - **Aguardando**: Status "Aguardando"
   - **Fechados**: Status "Fechado"

### Criar Novo Chamado

1. Clique em **"+ Novo Chamado"** (botão azul)
2. Preencha os dados:
   - **Nome do Cliente**: Nome da pessoa
   - **Empresa**: Empresa do cliente\n   - **Título**: Resumo do problema
   - **Observações**: Detalhes adicionais
   - **Prioridade**: Baixa, Média, Alta ou Crítica
3. Clique **"Criar"**
4. Novo chamado aparece na tabela

### Detalhes do Chamado

1. Clique em uma linha da tabela
2. Modal abre com:
   - **Timeline Vertical**: Histórico de atividades
   - **Datas em Laranja**: Data/hora de cada atividade
   - **Ícones Coloridos**: Tipo de atividade
   - **Botões de Ação**: Registrar atividade, Status, Atendente

### Registrar Atividade

1. Abra detalhes do chamado
2. Clique em **"Registrar Atividade"**
3. Digite a descrição
4. Clique **"Adicionar"**
5. Atividade aparece na timeline

### Alterar Status

1. Abra detalhes do chamado
2. Clique em **"Status do Chamado"**
3. Selecione novo status
4. Clique **"Salvar"**
5. Timeline atualiza automaticamente

### Atribuir Responsável

1. Abra detalhes do chamado
2. Clique em **"Atendente Responsável"**
3. Selecione atendente
4. Clique **"Salvar"**

### Busca Avançada

1. Clique em **"Avançado"** (botão expandível)
2. Filtros disponíveis:
   - **Nº Chamado**: #0001, #0002, etc
   - **Nome Cliente**: Busca por nome
   - **Data Início**: Data mínima
   - **Data Fim**: Data máxima
3. Filtros são aplicados em tempo real
4. Clique **"Limpar Filtros"** para resetar

### Exportar Relatório

1. Abra página de Chamados
2. Clique em **"CSV"** para exportar em CSV
3. Ou clique em **"Relatório"** para exportar em texto
4. Arquivo é baixado automaticamente
5. Exportação respeita filtros aplicados

### Dicas
- Prioridade Crítica aparece em vermelho
- Chamados recentes aparecem no topo
- Paginação: 10 chamados por página
- Busca é case-insensitive

## Rastreio

O módulo de Rastreio permite acompanhar encomendas e pedidos.

### Como Usar

1. Clique em **"Rastreio"** no menu lateral
2. Digite número de rastreamento
3. Veja status e histórico da encomenda
4. Compartilhe link com cliente se necessário

## ERP

O módulo de ERP gerencia registros operacionais.

### Como Usar

1. Clique em **"ERP"** no menu lateral
2. Veja registros operacionais
3. Crie novo registro se necessário
4. Edite ou delete registros existentes

## Bot & Configurações

### Configurar Bot

1. Clique em **"Bot & Configurações"** no menu lateral
2. Seção **"Configurar Bot & Testador"**:
   - Treine o bot com exemplos
   - Defina respostas automáticas
   - Configure escalação para atendente

### Novo Roteiro

1. Clique em **"Novo Roteiro"**
2. Defina fluxo de conversa
3. Configure respostas por intenção
4. Teste com "Testador de Bot"

### Testador de Bot

1. Clique em **"Testador de Bot"**
2. Digite mensagem de teste
3. Veja resposta do bot
4. Ajuste se necessário

## Assistente IA

O Assistente IA está disponível em qualquer página (botão flutuante no canto inferior direito).

### Como Usar

1. Clique no ícone de **"Chat"** (canto inferior direito)
2. Escreva sua pergunta ou comando
3. Assistente responde em tempo real
4. Histórico é mantido na conversa

### Exemplos de Uso

- "Resuma os últimos 5 chamados"
- "Quais conversas estão aguardando resposta?"
- "Crie um novo chamado para João Silva"
- "Qual é o status do chamado #0042?"
- "Gere relatório de chamados por prioridade"

## Dicas e Truques

### Atalhos de Teclado

- **Tab**: Navega entre campos
- **Enter**: Envia mensagem ou confirma ação
- **Esc**: Fecha modal ou dialog

### Navegação Rápida

- Clique no logo para voltar ao dashboard
- Use breadcrumb para navegar entre páginas
- Menu lateral sempre visível (desktop)

### Dark Mode

1. Clique no ícone de **"Tema"** (lua/sol)
2. Escolha modo claro ou escuro
3. Preferência é salva automaticamente

### Filtros e Busca

- Filtros são aplicados em tempo real
- Busca é case-insensitive
- Use "Limpar Filtros" para resetar

### Performance

- Paginação automática para listas grandes
- Lazy loading de dados
- Cache automático do React Query

### Acessibilidade

- Navegação por teclado completa
- Suporte a leitores de tela
- Contraste adequado (WCAG AA)
- Touch targets de 44px (mobile)

## Troubleshooting

### Não consigo fazer login
- Verifique sua conexão com internet
- Limpe cookies do navegador
- Tente em outro navegador

### Dados não aparecem
- Aguarde carregamento (veja spinner)
- Recarregue a página (F5)
- Verifique sua conexão

### Mensagem de erro
- Leia a mensagem com atenção
- Verifique dados preenchidos
- Tente novamente em alguns segundos

### Performance lenta
- Feche abas desnecessárias
- Limpe cache do navegador
- Recarregue a página

## Suporte

Para dúvidas ou problemas:
1. Consulte esta documentação
2. Entre em contato com o administrador
3. Use o Assistente IA para ajuda rápida

## Changelog

### Versão 1.0.0
- ✅ Atendimento Ativo
- ✅ Conversas Receptivas
- ✅ Chamados com Timeline
- ✅ Rastreio de Encomendas
- ✅ ERP
- ✅ Bot Gemini IA
- ✅ Assistente IA
- ✅ Dark Mode
- ✅ Responsividade Mobile
- ✅ Acessibilidade WCAG AA

---

**Última atualização**: Maio de 2026
**Versão**: 1.0.0
