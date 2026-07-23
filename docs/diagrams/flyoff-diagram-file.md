# Flyoff Diagram File

O formato nativo de diagramas do Flyoff usa a extensão `.flyd` e o MIME type
`application/vnd.flyoff.diagram`. Cada arquivo contém um diagrama UML em JSON
UTF-8. O nome apresentado na interface continua armazenado no nó da página do
projeto, não dentro do documento.

O documento atual usa `format: "flyoff-diagram"` e `formatVersion: 1`. IDs de
documento, elementos, relações e apresentações são UUIDs estáveis. A geometria
fica separada do modelo UML em `presentations`, enquanto preferências próprias do
documento ficam em `settings`.

Antes de ler ou gravar, Flyoff valida versão, profundidade, tamanho, tipos,
limites de coleções, números finitos e unicidade de IDs. A revisão usada para
autosave e detecção de conflito é o SHA-256 dos bytes persistidos. A gravação usa
arquivo temporário, sincronização e substituição atômica. Apenas violações
estruturais bloqueiam a persistência; diagnósticos semânticos UML permanecem
visíveis no inspetor.

## Migrações

A leitura aplica migrações antes da validação atual. A migração `0 → 1` adiciona
as configurações de grade, snap e tamanho da grade. Novas versões devem manter
migrações incrementais e nunca alterar silenciosamente arquivos incompatíveis.

## Interoperabilidade

Flyoff importa `.flyd`, `.spinel`, `.spinel-import.json`, `.xmi`, `.xml` e
`.drawio`. XMI e Draw.io podem perder informações de apresentação e, por isso,
produzem diagnósticos de fidelidade. A exportação está disponível em `.flyd` e
`.drawio`.

Arquivos `.asta` e `.astah` são proprietários e não são interpretados
diretamente. Use o Astah Bridge baseado no SDK oficial para gerar
`.spinel-import.json`, ou exporte XMI/XML quando fidelidade parcial for aceitável.
