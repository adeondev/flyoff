// Generates the sample "Apollo 11" project used to showcase the graph's orbit
// (solar system) mode. Run with: npx tsx scripts/seed-apollo-11.ts
//
// It drives the real ProjectRepository API (pure Node, no Electron) so the
// on-disk `.flyoff` metadata is always valid and openable by the app.

import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ProjectRepository } from '../src/main/projects/project-repository';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..', 'samples', 'Apollo 11');

async function main(): Promise<void> {
  await rm(projectRoot, { recursive: true, force: true });
  await mkdir(path.dirname(projectRoot), { recursive: true });

  const repository = await ProjectRepository.create(projectRoot, 'Apollo 11', {
    trashItem: (absolutePath) =>
      rm(absolutePath, { recursive: true, force: true }),
  });

  const folder = async (parentId: string | null, name: string) =>
    (await repository.createFolder(parentId, name)).nodeId;

  const note = async (parentId: string | null, name: string, body: string) => {
    const page = await repository.createMarkdownPage(parentId, name);
    await repository.saveMarkdown(page.nodeId, `${body.trim()}\n`, '', true);
  };

  // --- Root-level notes ---
  await note(
    null,
    'Apollo 11',
    `# Apollo 11

A [[Missão]] que pousou os primeiros humanos na Lua em julho de 1969.

- Tripulação: [[Neil Armstrong]], [[Buzz Aldrin]] e [[Michael Collins]]
- Foguete: [[Saturno V]]
- Naves: [[Módulo de Comando Columbia]] e [[Módulo Lunar Eagle]]
- Base em Terra: [[Centro de Controle Houston]]

Veja a [[Cronologia]] completa e o [[Um pequeno passo|primeiro passo]] na Lua.`,
  );

  await note(
    null,
    'Cronologia',
    `# Cronologia

1. [[Lançamento]] — 16 de julho de 1969
2. [[Aterrissagem]] — 20 de julho de 1969
3. [[Caminhada Lunar]] — [[Neil Armstrong]] e [[Buzz Aldrin]]
4. [[Retorno]] — 24 de julho de 1969

Cada etapa foi coordenada pelo [[Centro de Controle Houston]].`,
  );

  // --- Tripulação ---
  const crew = await folder(null, 'Tripulação');
  await note(
    crew,
    'Neil Armstrong',
    `# Neil Armstrong

Comandante da [[Apollo 11]] e primeiro humano a pisar na Lua durante a
[[Caminhada Lunar]]. Sua frase abre a nota [[Um pequeno passo]].

Trabalhou ao lado de [[Buzz Aldrin]] no [[Módulo Lunar Eagle]] enquanto
[[Michael Collins]] permanecia no [[Módulo de Comando Columbia]].`,
  );
  await note(
    crew,
    'Buzz Aldrin',
    `# Buzz Aldrin

Piloto do [[Módulo Lunar Eagle]] e segundo humano na Lua, logo após
[[Neil Armstrong]]. Participou da [[Aterrissagem]] e da [[Caminhada Lunar]].`,
  );
  await note(
    crew,
    'Michael Collins',
    `# Michael Collins

Piloto do [[Módulo de Comando Columbia]], permaneceu em órbita lunar durante a
[[Aterrissagem]]. Reencontrou [[Neil Armstrong]] e [[Buzz Aldrin]] para o
[[Retorno]].`,
  );

  // --- Missão ---
  const mission = await folder(null, 'Missão');
  await note(
    mission,
    'Missão',
    `# A Missão

Sequência: [[Lançamento]] → [[Aterrissagem]] → [[Caminhada Lunar]] → [[Retorno]].

Usou o foguete [[Saturno V]] e as naves do módulo [[Módulos]].`,
  );
  await note(
    mission,
    'Lançamento',
    `# Lançamento

O [[Saturno V]] decolou do Centro Espacial Kennedy em 16 de julho de 1969,
levando a tripulação da [[Apollo 11]]. Próxima etapa: [[Aterrissagem]].`,
  );
  await note(
    mission,
    'Aterrissagem',
    `# Aterrissagem

O [[Módulo Lunar Eagle]] pousou no Mar da Tranquilidade com
[[Neil Armstrong]] e [[Buzz Aldrin]]. "The Eagle has landed" foi ouvido no
[[Centro de Controle Houston]]. Em seguida veio a [[Caminhada Lunar]].`,
  );
  await note(
    mission,
    'Caminhada Lunar',
    `# Caminhada Lunar

[[Neil Armstrong]] e [[Buzz Aldrin]] caminharam sobre a Lua, coletando
[[Rochas lunares]] e cumprindo o [[Impacto científico]]. Ver [[Um pequeno passo]].`,
  );
  await note(
    mission,
    'Retorno',
    `# Retorno

Após a [[Caminhada Lunar]], o [[Módulo Lunar Eagle]] reencontrou o
[[Módulo de Comando Columbia]] pilotado por [[Michael Collins]]. A [[Apollo 11]]
amerissou em 24 de julho de 1969.`,
  );

  // --- Missão/Módulos (subpasta aninhada) ---
  const modules = await folder(mission, 'Módulos');
  await note(
    modules,
    'Módulos',
    `# Módulos

- [[Saturno V]] — foguete lançador
- [[Módulo de Comando Columbia]] — abrigou [[Michael Collins]]
- [[Módulo Lunar Eagle]] — levou [[Neil Armstrong]] e [[Buzz Aldrin]] à
  [[Aterrissagem]]`,
  );
  await note(
    modules,
    'Saturno V',
    `# Saturno V

O foguete que realizou o [[Lançamento]] da [[Apollo 11]]. Impulsionou o
[[Módulo de Comando Columbia]] e o [[Módulo Lunar Eagle]].`,
  );
  await note(
    modules,
    'Módulo de Comando Columbia',
    `# Módulo de Comando Columbia

Pilotado por [[Michael Collins]] em órbita lunar durante a [[Aterrissagem]].
Trouxe a tripulação de volta no [[Retorno]].`,
  );
  await note(
    modules,
    'Módulo Lunar Eagle',
    `# Módulo Lunar Eagle

Levou [[Neil Armstrong]] e [[Buzz Aldrin]] à superfície na [[Aterrissagem]] e
serviu de base para a [[Caminhada Lunar]].`,
  );

  // --- Controle ---
  const control = await folder(null, 'Controle');
  await note(
    control,
    'Centro de Controle Houston',
    `# Centro de Controle Houston

Coordenou toda a [[Cronologia]] da [[Missão]], da [[Aterrissagem]] ao
[[Retorno]]. Liderado por [[Gene Kranz]].`,
  );
  await note(
    control,
    'Gene Kranz',
    `# Gene Kranz

Diretor de voo no [[Centro de Controle Houston]] durante a [[Aterrissagem]] da
[[Apollo 11]].`,
  );

  // --- Legado ---
  const legacy = await folder(null, 'Legado');
  await note(
    legacy,
    'Um pequeno passo',
    `# Um pequeno passo

"Um pequeno passo para o homem, um salto gigantesco para a humanidade" —
[[Neil Armstrong]] durante a [[Caminhada Lunar]].`,
  );
  await note(
    legacy,
    'Impacto científico',
    `# Impacto científico

Amostras de [[Rochas lunares]] coletadas na [[Caminhada Lunar]] transformaram
o entendimento sobre a Lua. Parte do legado da [[Apollo 11]].`,
  );
  await note(
    legacy,
    'Rochas lunares',
    `# Rochas lunares

Trazidas pelo [[Módulo Lunar Eagle]] após a [[Caminhada Lunar]], sustentam o
[[Impacto científico]] da [[Missão]].`,
  );

  console.log(`Seeded Apollo 11 sample project at ${projectRoot}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
