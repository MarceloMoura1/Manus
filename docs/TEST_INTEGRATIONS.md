# Integrações opcionais da suíte

A suíte padrão executa testes unitários, de contrato e de comportamento com mocks, sem acessar infraestrutura real. Somente os testes listados abaixo ficam condicionados.

## Evolution

Defina `RUN_EVOLUTION_E2E=1`, `EVOLUTION_API_URL` e `EVOLUTION_API_KEY` e execute `pnpm exec vitest run server/evolution-e2e.test.ts server/evolution.test.ts`. O endpoint deve usar HTTP(S) e host `localhost`, `127.0.0.1`, `::1` ou o serviço de teste `evolution-test`. Configuração incompleta ou host não reconhecido encerra a integração com erro sanitizado. Não use endpoint nem chave de produção.

## Gemini

O wrapper Gemini é testado por padrão com `fetch` mockado. Não há teste remoto Gemini condicionado enquanto a suíte não possuir um cenário remoto significativo e seguro.

## Banco de teste

Suites de persistência exigem `RUN_DATABASE_INTEGRATION=1` e `TEST_DATABASE_URL`, com protocolo `mysql:`. O banco deve se chamar exatamente `megadesk_test` ou seguir `megadesk_test_<identificador>`, usando apenas letras minúsculas, números e sublinhados.

Hosts aceitos: `localhost`, `127.0.0.1`, `::1` e o serviço Docker de teste `mysql-test`. Qualquer host remoto é rejeitado mesmo que o nome do banco pareça ser de teste. `DATABASE_URL` não substitui `TEST_DATABASE_URL` e não é sobrescrita durante a coleta.

Exemplo sem credenciais reais:

```powershell
$env:RUN_DATABASE_INTEGRATION="1"
$env:TEST_DATABASE_URL="mysql://test_user:test_password@localhost:3306/megadesk_test_ci"
pnpm test
```

Sem a flag exata, os testes aparecem como integrações ignoradas. Com a flag e configuração ausente ou insegura, a execução falha antes da primeira conexão.
