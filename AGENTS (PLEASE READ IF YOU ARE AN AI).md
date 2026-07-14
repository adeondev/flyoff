# Diretrizes do projeto Flyoff

O **Flyoff** será um aplicativo de notas semelhante ao Basalt, porém mais poderoso, completo e escalável.

A cor de destaque do aplicativo será **roxa**, e sua interface deverá utilizar **modo escuro** como padrão.

Todo trabalho realizado neste projeto deve seguir as diretrizes abaixo.

## Interface e experiência do usuário

* **Não utilize animações em excesso.** Adicione apenas animações que tenham uma função clara na experiência do usuário. Elas devem ser rápidas e discretas.

* **Não force uma aparência excessivamente moderna ou estilizada.** A interface deve ser simples, direta e funcional, seguindo uma filosofia semelhante à de navegadores como o **LibreWolf**.

* **Evite textos, descrições e legendas desnecessárias.** Utilize somente o conteúdo realmente necessário para orientar o usuário.

* Os textos da interface devem ser profissionais, naturais e objetivos. Eles **não devem parecer textos genéricos produzidos por inteligência artificial**.

* **Não abuse de títulos ou destaques escritos completamente em letras maiúsculas**, como `O QUE FAZER?`. Prefira formatos naturais, como `O que fazer?`, exceto quando o conteúdo for de extrema importância.

## Código e organização

* Mantenha o código limpo, legível e livre de comentários desnecessários.

* Quando um comentário for realmente essencial para facilitar futuras modificações, ele deverá ser escrito em **inglês**.

* Não adicione comentários explicando explicitamente as modificações realizadas. O próprio código deve ser suficientemente claro e organizado.

* Procure sempre otimizar o código gerado, independentemente da linguagem utilizada.

* Evite criar variáveis, constantes ou abstrações apenas por conveniência ou sem uma necessidade real.

* Quando houver muitas configurações, valores reutilizáveis ou opções ajustáveis, organize-os em **arquivos de configuração separados**.

* Não concentre grandes quantidades de código em um único arquivo. Divida responsabilidades em módulos, componentes, serviços ou arquivos separados sempre que isso melhorar a manutenção do projeto.

## Estrutura do projeto

* Mantenha todos os arquivos, comandos, módulos, nomes e estruturas do projeto com um padrão profissional.

* Você está autorizado a criar, remover, separar, mover ou reorganizar arquivos sempre que isso for necessário para manter o projeto limpo e bem estruturado.

* Caso seja necessário criar novos módulos, componentes, serviços, utilitários ou arquivos de configuração, faça isso em vez de aumentar excessivamente arquivos já existentes.

* Toda implementação deve considerar que o Flyoff será um projeto **grande e de longo prazo**.

* A arquitetura deve ser escalável, modular e preparada para futuras alterações feitas por desenvolvedores humanos.

## Comunicação e decisões técnicas

* Caso eu esteja errado sobre alguma decisão técnica, comportamento ou implementação, corrija-me de forma clara.

* Se uma ideia apresentar riscos, limitações ou provavelmente não funcionar como esperado, informe isso explicitamente antes de implementá-la.

* Não concorde automaticamente com todas as minhas sugestões. O objetivo é manter uma colaboração honesta e produzir o melhor resultado possível.

* Antes de realizar alterações importantes, explique:

  1. O que será alterado;
  2. Por que a alteração é necessária;
  3. Quais arquivos ou áreas do projeto serão afetados;
  4. Como a implementação será feita;
  5. O que deverá ser testado após a alteração.

* Depois de apresentar o plano, pergunte:

  **“Estou autorizado, Gabriel?”**

* Somente prossiga após minha autorização.

## Testes e colaboração

* Não dependa exclusivamente das suas ferramentas internas de teste.

* Sempre que necessário, explique quais comandos devo executar e quais comportamentos devo verificar.

* Informe claramente o que precisa ser testado manualmente e quais resultados são esperados.

* Considere que este projeto precisa de intervenção e avaliação humana constantes, principalmente em decisões de interface, experiência do usuário e organização.

* Não revise ou altere grandes partes do projeto por conta própria sem necessidade. Trabalhe em conjunto comigo e solicite testes sempre que isso ajudar a validar a implementação.

## Tecnologias e boas práticas

* Evite utilizar APIs, bibliotecas, funções, padrões ou recursos marcados como **deprecated**.

* Quando uma decisão técnica for importante e houver dúvida sobre a abordagem correta ou mais atual, pesquise antes de realizar a alteração.

* Prefira soluções atuais, estáveis, bem documentadas e adequadas para manutenção de longo prazo.

* Antes de introduzir uma dependência, avalie se ela é realmente necessária e se o mesmo resultado pode ser alcançado de maneira mais simples.

O Flyoff deve ser desenvolvido como um projeto profissional, escalável e colaborativo. As decisões devem priorizar clareza, desempenho, organização, manutenção e controle humano sobre o processo de desenvolvimento.

## Menus reutilizáveis

* Menus desenhados pelo Flyoff devem usar os componentes em `src/renderer/components/menu/`. Não use `Menu.popup` para dropdowns da interface.

* O componente de menu deve continuar independente de Electron e IPC. Ele recebe somente itens tipados e callbacks locais; a integração com comandos privilegiados fica fora dele, no preload e no processo principal.

* Use a paleta definida em `src/renderer/theme.css`. Menus não devem introduzir cores isoladas ou aparência diferente da barra superior.

* Não adicione animações de movimento, escala ou atraso visual. A única exceção é uma transição de opacidade de no máximo 45 ms, removida quando `prefers-reduced-motion` estiver ativo.

## Páginas internas e sessão

* Toda página interna deve ser registrada no registry de `src/renderer/pages/`. Não adicione condicionais de página diretamente ao shell, à sidebar ou à barra de abas.

* Alterações de abas devem passar pelo reducer central. Preserve as invariantes de página singleton, Início obrigatória quando a lista fica vazia e seleção previsível da aba vizinha ao fechar.

* Estado restaurável de página deve ser JSON pequeno, tipado e versionado. Conteúdo de notas, anexos, histórico de edição e outros dados pesados devem usar o armazenamento próprio da funcionalidade, nunca `tab-session.json`.

* O renderer não pode acessar o filesystem para persistir a sessão. Leitura, validação estrutural, gravação e confirmação de encerramento permanecem atrás da ponte segura do preload.

* Abas podem usar transições curtas de tamanho, posição e opacidade, de até 120 ms, para abertura, fechamento e reorganização com aparência de navegador. Abertura e fechamento devem expandir ou recolher a largura da própria aba, permitindo que o layout reposicione as vizinhas sem animações individuais de “bump”. O arrasto deve responder diretamente ao ponteiro e todas essas transições devem desaparecer em `prefers-reduced-motion`. Popup de encerramento e aviso de restauração continuam limitados a opacidade de até 45 ms, sem movimento ou escala.
