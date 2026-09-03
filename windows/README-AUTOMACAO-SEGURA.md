# Automacao local segura do MegaDesk

Esta automacao substitui, para o fluxo atual, os arquivos `.bat` legados. Ela nao
configura inicializacao automatica, nao instala servicos e nao controla Evolution,
n8n, MySQL fora do container existente ou qualquer volume Docker.

## Instalar atalhos

No Windows PowerShell 5.1, sem privilegios administrativos:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\windows\Instalar-Atalhos-MegaDesk.ps1
```

Sao criados tres atalhos na Area de Trabalho: `Iniciar MegaDesk`,
`Atualizar MegaDesk` e `Parar MegaDesk`.

## Estado e logs

PIDs, identidade dos processos, estado atomico, logs operacionais sanitizados e
releases imutaveis ficam em `%LOCALAPPDATA%\MegaDesk`. Cada release pronta possui
`releases\<sha>\dist`, `node_modules` production proprio e `release.json`. As
dependencias sao preparadas por `pnpm deploy --prod --legacy` a partir do lockfile
daquele SHA; links para o `node_modules` do worktree sao recusados. O `.env.local`
continua fora da release e e passado ao Node por caminho absoluto, sem copiar
valores secretos.

## Atualizacao com testes

O atalho de atualizacao nao executa a suite completa. Para habilita-la explicitamente:

```powershell
powershell.exe -NoProfile -File .\windows\Atualizar-MegaDesk.ps1 -RunTests
```

O fluxo faz `git fetch`, exige worktree/staging/untracked limpos e `HEAD == upstream`.
Ele nunca executa migrations ou comandos Git mutantes. Se a diferenca entre a release
ativa e a candidata tocar schema, migrations, snapshots ou o executor canonico, a
publicacao e bloqueada. O switch so marca a candidata como ativa depois de health
local e publico confirmarem seu SHA; em falha, relanca a release anterior e valida
o rollback. Falha ou dados incompletos ao identificar o dono da porta tambem
bloqueiam a operacao; somente uma porta comprovadamente livre pode receber a
release candidata.

## Observacao sobre os scripts legados

`start-megadesk.bat`, `stop-megadesk.bat` e os instaladores de auto-start foram
preservados apenas por compatibilidade historica. Eles nao possuem os guardrails
desta automacao e nao devem ser usados para este fluxo.
