# Runtime de normalizacao de audio outbound

O envio de audio das Conversas reconstrói a timeline a partir das amostras
decodificadas e produz OGG/Opus antes de chamar a Evolution. Por isso, o runtime
do app precisa disponibilizar `ffmpeg` com demuxer WebM, muxer Ogg, decoder Opus
e encoder `libopus`.

## Escopo e capacidade

O contrato de envio distingue `mediaSource: "recording"` de
`mediaSource: "attachment"`. Somente o primeiro representa o Blob do
MediaRecorder e e reconstruido para OGG/Opus. Anexos de audio permanecem com
os bytes, MIME e nome originais. Clientes antigos sem `mediaSource` tambem sao
tratados como anexos para preservar compatibilidade.

No processo do app, no maximo duas normalizacoes podem executar ao mesmo tempo.
Nao existe fila: quando a capacidade esta ocupada, o envio falha de forma
controlada e pode ser repetido pelo fluxo existente. O slot e liberado em
sucesso, falha do FFmpeg, timeout, falha de output e falha de cleanup.

O arquivo `Dockerfile.app-runtime` versiona a menor extensao da imagem atualmente
usada pelo app (`node:22-bookworm`) e instala o pacote `ffmpeg` sem recomendações.

## Integracao futura em producao

A configuracao de producao permanece externa ao Git em
`/opt/megadesk/compose/app.compose.yml`, e o updater permanece em
`/opt/megadesk/bin/update-megadesk`. Nenhum dos dois e alterado por esta mudanca.

Antes de publicar esta funcionalidade, o deploy controlado deve:

1. construir uma imagem versionada a partir de `Dockerfile.app-runtime` para a
   arquitetura do host (`linux/arm64`);
2. verificar dentro da imagem `ffmpeg -version`, o demuxer WebM, o muxer Ogg, o
   decoder Opus e o encoder `libopus`;
3. atualizar explicitamente somente a imagem do servico `app` no compose externo;
4. recriar somente `megadesk-app`, sem reiniciar MySQL ou Evolution;
5. executar um smoke test de WebM para OGG/Opus antes de liberar o envio.

A captura diagnostica pre-Evolution continua desligada por padrao. Ela deve ser
ativada apenas para um tenant explicitamente autorizado e, quando ativa, captura
o buffer OGG normalizado que sera enviado ao provider.
