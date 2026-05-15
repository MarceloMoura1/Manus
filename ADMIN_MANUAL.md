# Manual do Administrador - MegaDesk Platform

## Bem-vindo ao MegaAdmin!

MegaAdmin é o painel administrativo da plataforma MegaDesk, onde você gerencia clientes, usuários, permissões e configurações globais.

## Índice

1. [Acesso ao MegaAdmin](#acesso-ao-megaadmin)
2. [Dashboard Administrativo](#dashboard-administrativo)
3. [Gestão de Clientes](#gestão-de-clientes)
4. [Gestão de Usuários](#gestão-de-usuários)
5. [Gestão de Administradores](#gestão-de-administradores)
6. [Permissões](#permissões)
7. [Logs de Auditoria](#logs-de-auditoria)
8. [Configurações](#configurações)
9. [Troubleshooting](#troubleshooting)

## Acesso ao MegaAdmin

### Login

1. Acesse `/admin` na plataforma
2. Clique em **"Entrar como Administrador"**
3. Faça login com sua conta de administrador
4. Você será redirecionado para o dashboard

### Permissões Necessárias

- Você deve ter role `admin` no banco de dados
- Contato com suporte para ser promovido a admin

## Dashboard Administrativo

### Visão Geral

O dashboard mostra:
- **Total de Clientes**: Número de clientes ativos
- **Total de Usuários**: Número de usuários registrados
- **Total de Administradores**: Número de admins
- **Atividades Recentes**: Últimas ações no sistema

### Navegação

Menu lateral com opções:
- **Dashboard**: Visão geral
- **Clientes**: Gerenciar clientes
- **Usuários**: Gerenciar usuários
- **Administradores**: Gerenciar admins
- **Logs de Auditoria**: Ver histórico de ações
- **Configurações**: Ajustes globais

## Gestão de Clientes

### Visualizar Clientes

1. Clique em **"Clientes"** no menu lateral
2. Veja tabela com todos os clientes
3. Cada linha mostra:
   - **Nome**: Nome da empresa
   - **Email**: Email de contato
   - **Telefone**: Número de telefone
   - **Status**: Ativo, Inativo ou Bloqueado
   - **Ações**: Editar, Deletar, Ver Detalhes

### Criar Novo Cliente

1. Clique em **"+ Novo Cliente"** (botão azul)
2. Preencha os dados:
   - **Nome**: Nome da empresa
   - **Email**: Email de contato
   - **Telefone**: Número de telefone
   - **Endereço**: Endereço da empresa
   - **Cidade**: Cidade
   - **Estado**: Estado
   - **CEP**: Código postal
3. Clique **"Criar"**
4. Novo cliente é criado e ativado automaticamente

### Editar Cliente

1. Clique em **"Editar"** na linha do cliente
2. Altere os dados desejados
3. Clique **"Salvar"**
4. Mudanças são salvas automaticamente

### Deletar Cliente

1. Clique em **"Deletar"** na linha do cliente
2. Confirme a ação
3. Cliente é deletado (não pode ser desfeito)
4. Todos os dados do cliente são removidos

### Status do Cliente

- **Ativo**: Cliente pode acessar a plataforma
- **Inativo**: Cliente não pode acessar (dados preservados)
- **Bloqueado**: Cliente foi bloqueado (dados preservados)

### Módulos do Cliente

Cada cliente pode ter acesso a módulos específicos:
- Atendimento Ativo
- Conversas Receptivas
- Chamados
- Rastreio
- ERP
- Bot Gemini IA
- Assistente IA

Para modificar módulos:
1. Clique em **"Ver Detalhes"** do cliente
2. Seção **"Módulos Disponíveis"**
3. Marque/desmarque módulos desejados
4. Clique **"Salvar"**

### Token de API

Cada cliente tem um token de API para integração:
1. Clique em **"Ver Detalhes"** do cliente
2. Seção **"Token de API"**
3. Copie o token
4. Use em integrações externas

Para regenerar token:
1. Clique em **"Regenerar Token"**
2. Confirme a ação
3. Novo token é gerado (antigo fica inválido)

## Gestão de Usuários

### Visualizar Usuários

1. Clique em **"Usuários"** no menu lateral
2. Veja tabela com todos os usuários
3. Cada linha mostra:
   - **Nome**: Nome do usuário
   - **Email**: Email
   - **Cliente**: Cliente associado
   - **Status**: Ativo ou Bloqueado
   - **Ações**: Editar, Deletar, Ver Permissões

### Criar Novo Usuário

1. Clique em **"+ Novo Usuário"** (botão azul)
2. Preencha os dados:
   - **Nome**: Nome completo
   - **Email**: Email do usuário
   - **Senha**: Senha inicial (mínimo 8 caracteres)
   - **Cliente**: Selecione cliente
   - **Status**: Ativo ou Bloqueado
3. Clique **"Criar"**
4. Novo usuário é criado

### Editar Usuário

1. Clique em **"Editar"** na linha do usuário
2. Altere os dados desejados
3. Clique **"Salvar"**

### Deletar Usuário

1. Clique em **"Deletar"** na linha do usuário
2. Confirme a ação
3. Usuário é deletado (não pode ser desfeito)

### Redefinir Senha

1. Clique em **"Ver Permissões"** do usuário
2. Seção **"Redefinir Senha"**
3. Digite nova senha
4. Clique **"Redefinir"**
5. Usuário recebe notificação de mudança

### Permissões de Usuário

Cada usuário tem permissões individuais para módulos:
1. Clique em **"Ver Permissões"** do usuário
2. Veja cards de cada módulo
3. Marque/desmarque permissões
4. Clique **"Salvar"**

## Gestão de Administradores

### Visualizar Administradores

1. Clique em **"Administradores"** no menu lateral
2. Veja tabela com todos os admins
3. Cada linha mostra:
   - **Nome**: Nome do admin
   - **Email**: Email
   - **Data de Criação**: Quando foi promovido
   - **Ações**: Editar, Remover

### Promover Usuário a Administrador

1. Vá para **"Usuários"**
2. Encontre o usuário desejado
3. Clique em **"Promover a Admin"** (se disponível)
4. Confirme a ação
5. Usuário agora é administrador

### Remover Administrador

1. Clique em **"Remover"** na linha do admin
2. Confirme a ação
3. Admin volta a ser usuário comum
4. Perde acesso ao MegaAdmin

## Permissões

### Estrutura de Permissões

Cada usuário pode ter permissões para:
- **Atendimento Ativo**: Buscar e contatar clientes
- **Conversas Receptivas**: Gerenciar conversas
- **Chamados**: Criar e gerenciar tickets
- **Rastreio**: Acompanhar encomendas
- **ERP**: Acessar registros operacionais
- **Bot Gemini IA**: Configurar e treinar bot
- **Assistente IA**: Usar assistente inteligente

### Atribuir Permissões

1. Clique em **"Usuários"** no menu lateral
2. Clique em **"Ver Permissões"** do usuário
3. Para cada módulo:
   - Marque para **permitir** acesso
   - Desmarque para **negar** acesso
4. Clique **"Salvar"**
5. Permissões são aplicadas imediatamente

### Permissões Padrão

Novos usuários recebem permissões padrão:
- ✅ Atendimento Ativo
- ✅ Conversas Receptivas
- ✅ Chamados
- ❌ Rastreio
- ❌ ERP
- ❌ Bot Gemini IA
- ✅ Assistente IA

## Logs de Auditoria

### Visualizar Logs

1. Clique em **"Logs de Auditoria"** no menu lateral
2. Veja tabela com todas as ações
3. Cada linha mostra:
   - **Ação**: Tipo de ação (criar, editar, deletar)
   - **Usuário**: Quem fez a ação
   - **Recurso**: O que foi modificado
   - **Data/Hora**: Quando aconteceu
   - **Detalhes**: Informações adicionais

### Filtrar Logs

1. Use filtros disponíveis:
   - **Tipo de Ação**: Criar, Editar, Deletar, Login, etc
   - **Usuário**: Filtrar por usuário
   - **Recurso**: Filtrar por tipo de recurso
   - **Data**: Intervalo de datas
2. Clique **"Aplicar Filtros"**
3. Resultados são atualizados

### Exportar Logs

1. Clique em **"Exportar"** (botão azul)
2. Escolha formato:
   - **CSV**: Para Excel
   - **JSON**: Para análise
   - **PDF**: Para impressão
3. Arquivo é baixado automaticamente

### Retenção de Logs

- Logs são mantidos por **90 dias**
- Logs antigos são deletados automaticamente
- Exportar logs importantes antes de expirar

## Configurações

### Configurações Globais

1. Clique em **"Configurações"** no menu lateral
2. Opções disponíveis:
   - **Tema**: Claro ou Escuro
   - **Idioma**: Português, Inglês, Espanhol
   - **Fuso Horário**: Selecione seu fuso horário
   - **Email de Notificação**: Email para alertas

### Integração com Serviços Externos

1. Seção **"Integrações"**
2. Serviços disponíveis:
   - **Google Gemini**: Configure API key
   - **WhatsApp**: Configure webhook
   - **Slack**: Configure notificações
   - **Email**: Configure servidor SMTP

### Backup e Restauração

1. Seção **"Backup"**
2. **Criar Backup**:
   - Clique em **"Criar Backup Agora"**
   - Aguarde conclusão
   - Download automático
3. **Restaurar Backup**:
   - Clique em **"Restaurar"**
   - Selecione arquivo de backup
   - Confirme a ação
   - Sistema é restaurado (não pode ser desfeito)

## Troubleshooting

### Não consigo acessar MegaAdmin

**Problema**: Erro "Acesso restrito"
**Solução**:
1. Verifique se sua conta é administrador
2. Contato com outro admin para ser promovido
3. Verifique se sua conta não foi bloqueada

### Usuário não consegue fazer login

**Problema**: Erro "Credenciais inválidas"
**Solução**:
1. Verifique se o usuário existe
2. Verifique se o usuário está ativo (não bloqueado)
3. Redefina a senha do usuário
4. Verifique se o cliente do usuário está ativo

### Cliente desapareceu

**Problema**: Cliente não aparece na lista
**Solução**:
1. Verifique se o cliente não foi deletado
2. Verifique logs de auditoria
3. Contato com suporte se necessário

### Performance lenta

**Problema**: Sistema está lento
**Solução**:
1. Feche abas desnecessárias
2. Limpe cache do navegador
3. Recarregue a página
4. Verifique sua conexão com internet

### Erro ao criar cliente

**Problema**: Erro ao criar novo cliente
**Solução**:
1. Verifique se todos os campos estão preenchidos
2. Verifique se o email é válido
3. Verifique se o email não está duplicado
4. Tente novamente em alguns segundos

## Melhores Práticas

### Segurança

1. **Senhas Fortes**: Use senhas com pelo menos 8 caracteres
2. **Autenticação**: Ative autenticação de dois fatores se disponível
3. **Permissões**: Atribua apenas permissões necessárias
4. **Logs**: Revise logs de auditoria regularmente

### Gestão de Clientes

1. **Ativação**: Ative cliente apenas após pagamento confirmado
2. **Módulos**: Configure módulos de acordo com plano do cliente
3. **Suporte**: Mantenha contato com cliente para suporte
4. **Renovação**: Renove tokens de API regularmente

### Gestão de Usuários

1. **Criação**: Crie usuários apenas quando necessário
2. **Permissões**: Revise permissões regularmente
3. **Senhas**: Redefina senhas de usuários inativos
4. **Deletar**: Delete usuários que não usam mais a plataforma

### Monitoramento

1. **Logs**: Revise logs de auditoria semanalmente
2. **Performance**: Monitore performance do sistema
3. **Alertas**: Configure alertas para atividades suspeitas
4. **Backup**: Faça backup regularmente

## Suporte

Para dúvidas ou problemas:
1. Consulte esta documentação
2. Revise logs de auditoria
3. Entre em contato com o suporte técnico

## Changelog

### Versão 1.0.0
- ✅ Gestão de Clientes (CRUD)
- ✅ Gestão de Usuários (CRUD)
- ✅ Gestão de Administradores
- ✅ Permissões por Usuário
- ✅ Logs de Auditoria
- ✅ Configurações Globais
- ✅ Backup e Restauração
- ✅ Integrações Externas

---

**Última atualização**: Maio de 2026
**Versão**: 1.0.0
