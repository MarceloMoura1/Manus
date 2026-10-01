# Automacao local segura do MegaDesk

Esta automacao substitui, para o fluxo atual, os arquivos `.bat` legados. Ela nao
usa os instaladores `.bat` legados, nao controla Evolution, n8n, MySQL fora do
container existente ou qualquer volume Docker.

## Autostart seguro e separado do deploy

O supervisor `MegaDesk.Autostart.ps1` restaura somente a `activeRelease` registrada.
Ele pode solicitar o start do Docker Desktop pela CLI oficial, aguarda Docker e o
MySQL existente com retry limitado, e entao chama `Iniciar-MegaDesk.ps1 -NoBrowser`.
O supervisor nunca executa updater, publish, migration, DNS ou selecao de candidate.

A instalacao e explicita e exige PowerShell elevado porque usa `BootTrigger`:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\windows\Instalar-Autostart-Seguro-MegaDesk.ps1
```

A tarefa usa a conta instaladora com logon S4U, `StartWhenAvailable`, restart
limitado pelo Task Scheduler e `IgnoreNew` para impedir supervisores duplicados.
O supervisor tambem usa mutex global e o bootstrap preserva seu lifecycle mutex.

Para remover somente a tarefa, sem encerrar runtime ou alterar state:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\windows\Desinstalar-Autostart-Seguro-MegaDesk.ps1 -Confirm
```

A validacao final exige reboot controlado. Em especial, Docker Desktop com backend
WSL2 precisa ser comprovado no contexto S4U deste host; a presenca do script ou da
tarefa, isoladamente, nao prova operacao 24x7 sem sessao interativa.

## Identidade composta, switch e recovery

PID isolado nunca identifica uma runtime. O record do Node combina PID, creation
time, executavel, command line canonica, caminho imutavel da release, SHA, porta,
`operationId` e `runtimeInstanceId`. Antes de qualquer stop, o modulo repete a
prova sobre snapshot e handle; PID reutilizado ou owner desconhecido bloqueiam em
fail-closed e nenhum processo e encerrado.

O lifecycle V2 preserva os estados `PREPARING`, `READY`, `SWITCHING`, `ACTIVE`,
`ROLLING_BACK` e `FAILED`, com uma fase causal adicional. A ordem do publish e:

```text
READY
  -> ACTIVE_RUNTIME_CLASSIFIED
  -> OLD_RUNTIME_STOPPED
  -> CANDIDATE_STARTED
  -> CANDIDATE_HEALTH_PASSED
  -> ACTIVE_COMMITTED
```

A classificacao ocorre antes do marcador destrutivo `SWITCHING`. Assim, uma falha
de identidade pre-stop permanece `PRE_SWITCH_FAILED`. Se houver crash posterior,
`Resolve-MegaDeskActiveRuntimeRecovery` reconcilia a autoridade da release ACTIVE:
preserva a ACTIVE valida, limpa record stale somente com porta comprovadamente
livre e interrompe uma candidate apenas quando sua identidade composta e a tupla
da operation forem inequivocas. O recovery nunca promove candidate, executa
migration ou publica implicitamente.

O supervisor usa as mesmas provas compostas do modulo e o mesmo lifecycle mutex.
As combinacoes Node/tunnel sao tratadas separadamente: tunnel vivo nao prova Node
vivo, e Node vivo nao prova tunnel vivo.

Cada Node possui stdout/stderr exclusivos, observer de exit, stop-intent atomico e
confirmacao imutavel gravada somente depois do encerramento validado. A telemetria
V2 distingue `NODE_EXITED` de `NODE_KILLED_BY_OFFICIAL_STOP` apenas quando intent e
confirmacao correspondem ao mesmo PID, SHA, operation/runtime id e motivo. Ela
registra exit code quando disponivel e uptime aproximado, sem persistir environment
ou secrets.

O rehearsal adversarial nao produtivo e executado por:

```powershell
powershell.exe -NoProfile -File .\windows\tests\Invoke-MegaDesk.PublishIdentityRehearsal.ps1
```

Ele cria somente um Node sintetico sob `%TEMP%`, escolhe porta entre 33120 e 33220,
prova stale PID, PID reuse, owner desconhecido, health vinculado ao SHA e listener
unico, e remove apenas os recursos que criou. Porta 3000 e `.env.local` real nunca
sao usados.

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

## Bootstrap Zero (primeira ativacao)

`Atualizar-MegaDesk.ps1` continua sendo exclusivamente o launcher do updater normal. Ele exige uma `activeRelease` V2 valida e nunca executa Bootstrap Zero de forma implicita.

O Bootstrap Zero e um comando one-shot separado, `Inicializar-UpdaterV2.ps1`. Ele exige `CandidateSha` e `MigrationBaselineSha` completos e explicitos. Nenhum SHA e inferido de `HEAD^`, state legado ou do parent Git. A baseline precisa ser autorizada operacionalmente antes de qualquer execucao real.

O Bootstrap somente aceita state V2 inexistente ou vazio, sem `activeRelease` nem `previousRelease`. Ele prepara uma release imutavel usando o mesmo build isolado do updater, mas artefato preparado e somente `artifact-valid`: ele nao se torna `activeRelease` em disco.

O state registra `operation.kind = BOOTSTRAP_ZERO`, o SHA candidato e a baseline explicita. A sequencia permitida e `PREPARING -> READY -> SWITCHING -> ACTIVE`, ou `FAILED`. `READY` reaproveita apenas uma release revalidada. `PREPARING`, `FAILED` e `SWITCHING` ambiguo permanecem fail-closed; nenhuma promocao ocorre apenas porque o state declara `SWITCHING`.

No Bootstrap Start nao existe `previousRelease`: se a candidata falhar, ela so pode ser encerrada quando a identidade managed for comprovada. Nao ha rollback ficticio, start pelo worktree ou importacao de `automation-state.json`. A release permanece para diagnostico.

Assim como no updater normal, a promocao para `activeRelease` depende de health local com SHA esperado e readiness publico. No Bootstrap, a config do Cloudflared e validada antes de iniciar processos. Depois de iniciar e registrar o Node da release candidata e confirmar seu health local, o Bootstrap estabelece ou reutiliza somente um Cloudflared V2 com identidade forte e executa o readiness publico.

Cloudflared criado pela invocacao atual e registrado no state ainda durante `SWITCHING`; isso nao o torna `activeRelease`. Se o readiness ou o save final falhar antes do commit point, o cleanup seletivo encerra primeiro apenas esse tunnel e depois apenas o Node criado pela mesma invocacao, sempre revalidando identidade forte. Um Cloudflared V2 preexistente e valido pode ser reutilizado, mas nunca e marcado como criado pela invocacao nem encerrado por sua compensacao. Processo externo, sem record V2, stale ambiguo ou identidade nao comprovada continuam bloqueados e nunca sao adotados ou mortos por PID.

`Save-MegaDeskState` com `activeRelease` candidata, `previousRelease = null` e `operation.status = ACTIVE` e o commit point da primeira ativacao. Apos esse save, falha de logging nao encerra Node ou Cloudflared e nao reverte `ACTIVE`.
