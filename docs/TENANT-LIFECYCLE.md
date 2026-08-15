# Ciclo de vida e quarentena de tenants

## Ações distintas

- **Desativar / colocar em quarentena:** ação administrativa comum. Define `status=paused`, remove a liberação de acesso e bloqueia os usuários do tenant. O cadastro, dados relacionados e banco físico são preservados.
- **Reativar:** muda o tenant para `active`, mantendo `accessReleased=0` e todos os usuários bloqueados.
- **Liberar empresa:** habilita `accessReleased` somente para tenant já ativo; não desbloqueia usuários.
- **Desbloquear usuário:** operação individual já existente, realizada separadamente.
- **Excluir fisicamente:** não está disponível no fluxo administrativo nem nos helpers de persistência. A implementação permanece bloqueada até existir um processo separado com autorização operacional forte e evidência verificável de backup.

A quarentena exige um código enumerado: `non_payment`, `customer_request`, `policy_violation`, `contract_termination`, `security` ou `controlled_other`. Texto livre não é gravado na auditoria. A reativação libera o tenant, mas mantém todos os usuários bloqueados até liberação individual.

Não foi necessária migration: `paused`, `accessReleased` e bloqueio de usuários já fazem parte do contrato persistido.
