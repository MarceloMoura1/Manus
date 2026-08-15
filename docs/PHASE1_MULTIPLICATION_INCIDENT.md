# Fase 1 — incidente histórico de multiplicação

## Limites da evidência

Em 15/08/2026 não havia MySQL local ativo, listener em 3306/3307/33060 ou credencial de banco legitimamente disponível no processo. O serviço Windows `MySQL84` e o container descartável conhecido estavam parados. Por isso, não foi possível confirmar se os registros multiplicados ainda existem, estimar sua quantidade ou correlacionar timestamps sem violar a regra de não inventar credenciais.

## Evidência de código

O caminho histórico `megaadmin.createClient` possuía as seguintes propriedades:

- identificadores derivados de `clients.length`;
- mutação do array em memória antes de concluir a persistência;
- ausência de chave de idempotência e rate limit;
- empresa e usuário inicial persistidos por etapas distintas;
- retry do cliente ou duplo envio podia repetir a operação;
- `saveMegaDeskStructuredState` sincronizava todo o estado em memória.

Isso comprova risco de multiplicação e estado parcial, mas não comprova que esse caminho gerou os aproximadamente cinco mil registros. A causa permanece **provável**, condicionada à futura correlação com agregados do banco suspeito.

Outras hipóteses:

- testes históricos contra banco não-test antes dos gates atuais: **possível**;
- startup atual criando dados demo: **descartada no estado revisado**;
- webhook criando empresas/tenants: **descartada no estado revisado**;
- retry/fila Evolution criando empresas: **descartada no estado revisado**;
- frontend em React StrictMode repetindo a mutation: **possível historicamente**, sem evidência de chamada automática; o botão atual bloqueia enquanto a mutation está pendente.

## Proteções da estabilização

- normalização centralizada de e-mail, documento, telefone e nome técnico;
- coalescência de chamadas concorrentes por chave idempotente;
- retry reutilizando a mesma chave do formulário;
- identificação natural como fallback de idempotência;
- rate limit administrativo em memória;
- máximo de 25 usuários por solicitação;
- rollback do estado em memória quando a persistência falha;
- unique constraints na baseline limpa para empresa/documento, usuário por tenant e cliente CRM por tenant;
- readiness fatal para schema incompleto;
- nenhuma criação automática de DDL ou dados no startup.

## Auditoria futura e limpeza separada

Para continuar a perícia, o proprietário deve iniciar explicitamente o MySQL local suspeito e disponibilizar ao processo uma credencial read-only legítima, informando host, porta e database sem colar segredo na conversa. A primeira execução deve usar somente `INFORMATION_SCHEMA`, `SHOW`, `EXPLAIN` e agregações sem PII.

Somente depois dessa auditoria deve ser produzida uma proposta de limpeza com contagens por tabela, tenants/bancos afetados e estimativa de remoção. Este documento não autoriza `DELETE`, `TRUNCATE`, `DROP` ou alteração de qualquer dado existente.
