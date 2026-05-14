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
