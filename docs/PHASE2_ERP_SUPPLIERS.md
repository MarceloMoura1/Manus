# Fase 2 ERP — Fornecedores

## Escopo

Esta segunda fatia adiciona `/erp/fornecedores` ao ERP existente. Ela cobre cadastro, edição, ativação, inativação, consulta, filtros, ordenação e paginação. Compras, Financeiro, Fiscal, integrações cadastrais e exclusão física permanecem fora do escopo.

## Modelo e normalização

`erp_suppliers` usa `id` interno e `public_id` opaco, sempre associado a `client_id`. Razão social/nome e tipo de pessoa são obrigatórios. Nome fantasia, CPF/CNPJ, inscrição estadual, contato, endereço e observações são opcionais. Strings opcionais vazias viram `NULL`; textos são aparados; e-mail fica em minúsculas; UF em maiúsculas; CEP e CPF/CNPJ são persistidos somente com dígitos.

O CPF/CNPJ é opcional. Quando informado, pessoa jurídica exige 14 dígitos e pessoa física 11. A constraint `UNIQUE(client_id, tax_id)` impede duplicidade não nula no tenant e, pelo comportamento de `NULL` no MySQL 8, permite vários fornecedores sem documento. O mesmo documento pode existir em tenants distintos.

## Permissões e isolamento

`admin`, `manager`, `agent` e `viewer` podem ler. Somente `admin` e `manager` podem criar, editar ou mudar o status. A UI não renderiza ações de escrita para perfis somente leitura, e o service repete a autorização independentemente do frontend. O `client_id` vem exclusivamente da sessão; listagem, detalhe e mutations usam tenant e `public_id`, sem expor IDs internos.

## Fluxo

```text
SuppliersPage → tRPC suppliers router → SupplierService → SupplierRepository → MySQL
```

O router valida contratos e traduz erros públicos. O service normaliza, autoriza, trata duplicidade preventiva e física e publica eventos após a transação. O repository usa parâmetros SQL, allowlist de ordenação e `limit`/`offset` inteiros normalizados.

## Realtime

As mutations publicam `erp:supplier.changed` na room operacional do tenant somente após commit. O payload contém apenas `publicId`, `operation` (`created`, `updated`, `activated`, `deactivated`) e `occurredAt`. CPF/CNPJ, contato, endereço, observações e `client_id` não são transmitidos. O frontend invalida apenas `erp.suppliers`.

## Migration

`0006_broken_green_goblin.sql` é aditiva e cria somente a tabela e seus índices. Snapshot e journal acompanham a migration. A segunda geração confirmou ausência de mudanças adicionais. A migration não foi aplicada nesta rodada.

## Testes preparados

- Unitários: normalização, validação por pessoa, filtros, paginação, ordenação, roles, payload realtime e tradução de erros.
- Físicos condicionais: migration/constraints, CRUD sem exclusão, tenants, roles, duplicidade preventiva/física/concorrente, rollback, paginação/filtros e eventos pós-commit isolados.
- E2E controlado: cadastro, edição, duplicidade, filtros, paginação, status, viewer, vazio, erro/retry e viewports 390×844, 768×1024, 1024×768 e 1440×900.

## Limitações e próximo passo

Não há validação algorítmica de CPF/CNPJ, consulta de CEP/Receita, importação, anexos ou vínculo com pedidos. A futura fatia Compras poderá referenciar `supplier.public_id` dentro do mesmo tenant e integrar recebimentos ao service de estoque; nenhum fluxo de Compras foi iniciado aqui.
