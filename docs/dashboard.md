# Dashboard: como funciona

O dashboard é onde você revisa as vagas que o Radar encontrou e pontuou, decide o que fazer com cada uma e ajusta o que o Radar procura. Ele roda só no seu computador.

## Como abrir

```bash
pnpm build:web && pnpm api   # http://localhost:3333
```

`pnpm api` sobe a API e serve o dashboard já compilado. Para mexer no código com recarga automática, use `pnpm api & pnpm web` (Vite em outra porta, com proxy para a API).

O dashboard só mostra o que já está no banco. Quem busca vagas novas é o worker (`pnpm worker`): ele roda às 8h e às 18h (horário de João Pessoa) e manda o resumo do dia no Telegram às 18h. Também dá para rodar uma varredura na hora com `pnpm cli scan`.

## De onde vêm os dados

```
fontes (Gupy, Sólides, CIEE, GitHub, Greenhouse, Lever, Ashby, Himalayas)
  → filtro (nível pelo título, palavras, modalidade, cidade)
  → duplicatas (mesma vaga em outra fonte ou repostada)
  → nota da IA (Claude Haiku: 0 a 100, com resumo, alertas e tecnologias)
  → banco SQLite (data/radar.db)
  → dashboard e Telegram
```

Tudo o que você faz no dashboard (status, nota pessoal, ajustes) é gravado no mesmo banco. O worker e o bot do Telegram enxergam as mudanças na hora.

## Layout

O visual segue a Apple: macOS no computador e iOS 27 no celular. A tela muda de forma conforme a largura.

| Largura | Como fica |
| --- | --- |
| 1280 px ou mais (monitor, MacBook com a janela cheia) | Três colunas, como o Mail: barra lateral, lista e detalhe da vaga lado a lado |
| 768 a 1279 px (janela menor, iPad) | Barra lateral e lista; a vaga abre num painel flutuante que entra pela direita |
| Menos de 768 px (celular) | Lista em tela cheia, barra de abas flutuante embaixo; a vaga abre numa folha que sobe de baixo |

### Barra lateral (computador)

- **Vagas**: as cinco listas inteligentes (abaixo). O número ao lado é quantas vagas há nela.
- **Organizar › Quadro**: as vagas em colunas por status.
- **Ajustes**: o que o Radar procura e quando avisa.
- **Varredura há…**: quando o worker terminou a última busca. A bolinha fica verde se todas as fontes responderam e laranja se alguma falhou (o texto diz quantas).

### Barra de abas (celular)

Três abas: **Vagas**, **Quadro** e **Ajustes**. As listas inteligentes viram botões em formato de pílula logo abaixo do título. Se não couberem todos, deslize para o lado.

## Listas inteligentes

Cada lista é um filtro de status já pronto, como as caixas do Mail.

| Lista | Mostra | Nota mínima inicial |
| --- | --- | --- |
| **Para você** | Vagas em aberto: novas e salvas | 50 |
| **Novas** | Vagas que você ainda não marcou | qualquer |
| **Salvas** | Vagas que você guardou para depois | qualquer |
| **Candidaturas** | Vagas em que você marcou "Candidatei" | qualquer |
| **Descartadas** | Vagas que você descartou (dá para recuperar) | qualquer |

"Para você" é a lista principal e abre por padrão. Ela começa em nota 50 para esconder o que claramente não serve. Por isso não tem contador na barra lateral: um número sem o filtro de nota não bateria com a lista.

Trocar de lista zera a busca e os filtros.

## Uma vaga na lista

Cada linha é como uma mensagem no Mail:

- **Anel de nota**, à esquerda: a nota da IA de 0 a 100. O anel enche até a nota, e a cor segue as faixas das notificações:
  - verde: 85 ou mais, a faixa do alerta imediato;
  - roxo: 70 a 84, a faixa do resumo diário;
  - laranja: 50 a 69;
  - vermelho: abaixo de 50;
  - cinza com "–": ainda não pontuada.
- **Título** e, à direita, **há quanto tempo** a vaga foi publicada.
- **Empresa · modalidade · local**:
  - um globo azul marca vaga no exterior;
  - um marcador azul indica que está salva;
  - um ✓ verde indica que você se candidatou.
- **Resumo da IA** em até duas linhas. Se a IA achou um impedimento (exige experiência, contrato PJ, cidade fora da sua lista…), o primeiro aparece em vermelho no lugar do resumo.

Clique ou toque na linha para abrir os detalhes. No layout de três colunas, a vaga aberta fica destacada em azul claro.

## Busca e filtros

Ficam fixos no topo da lista quando você rola:

- **Busca**: procura no título e no nome da empresa. Espera você parar de digitar por um instante antes de buscar.
- **Todas / Brasil / Exterior**: separa as vagas no exterior, que só aparecem se você ligar "Remoto no exterior" em Ajustes.
- **Nota mínima**: qualquer nota, 50+, 70+ ou 85+.
- **Ordenar**: maior nota primeiro, ou mais recentes primeiro.

A lista carrega 30 vagas por vez. Use **Mostrar mais** no fim da lista para ver as próximas. Se nada aparecer com os filtros atuais, o botão **Limpar filtros** volta ao padrão da lista.

## Detalhe da vaga

O mesmo conteúdo aparece no painel ao lado, no painel flutuante ou na folha do celular:

1. **Cabeçalho**: anel de nota maior, título, empresa e local. Ele fica fixo enquanto você rola.
2. **Salvar · Candidatei · Descartar**: muda o status na hora.
   - O botão ativo fica colorido: azul para salva, verde para candidatei e vermelho para descartada.
   - Apertar o botão ativo de novo volta a vaga para "nova", o que serve de desfazer.
   - Um aviso no topo confirma cada mudança.
   - Se a API recusar, a mudança é revertida e o aviso explica o erro.
3. **Abrir no Gupy / Himalayas / …**: abre a vaga original numa aba nova, onde você se candidata.
   - Logo abaixo aparecem as outras fontes que publicaram a mesma vaga ("Também em…") e até quando vão as inscrições, quando a fonte informa.
4. **Análise**: o resumo da IA, os impedimentos em vermelho e as tecnologias, divididas em "Você tem" (verde) e "Falta".
5. **Sua nota**: anotação livre só sua, por exemplo "enviei pelo LinkedIn em 28/10". É salva quando você sai do campo.
6. **Mensagem de apresentação**: **Gerar rascunho** pede ao Claude Sonnet uma mensagem curta a partir do seu currículo e da vaga.
   - Cada geração custa alguns centavos de API, por isso só acontece quando você pede.
   - Depois você pode **Copiar** ou **Gerar outro**.
   - O rascunho fica guardado e reaparece quando você reabre a vaga.
7. **Descrição**: o texto completo da vaga. Se for longo, aparece recolhido com **Mostrar descrição completa**.

**Para fechar o painel ou a folha:**
- o botão ✕;
- a tecla Esc;
- um clique fora;
- no celular, arrastar o cabeçalho para baixo. Uma puxada rápida basta, sem precisar levar até o fim. Um arrasto curto e lento devolve a folha ao lugar.

## Quadro

As vagas em quatro colunas: **Novas**, **Salvas**, **Candidatei** e **Descartadas**. Para mudar o status, arraste um cartão para outra coluna.

- **Pelo teclado**: Tab até o cartão, Espaço para pegar, setas para escolher a coluna e Espaço para soltar. O leitor de tela anuncia cada passo.
- **Para abrir os detalhes**: um clique simples no cartão.
- **Limite**: o quadro mostra as 200 vagas com maior nota.
- **No celular**: as colunas deslizam para o lado, uma de cada vez.

## Ajustes

Organizado como o app Ajustes do iPhone. Os botões **Salvar** e **Desfazer** ficam no topo e só se ativam quando você mudou algo. As mudanças valem a partir da próxima varredura.

- **Notificações no Telegram**:
  - **Nota para o resumo diário**: vagas a partir desta nota entram no resumo das 18h.
  - **Nota para alerta imediato** (padrão 85): vagas a partir desta nota geram mensagem na hora.
- **Modalidade**: chaves para Remoto, Híbrido e Presencial. **Remoto no exterior** inclui estágios remotos de fora do Brasil.
  - Essas vagas ficam com prioridade menor e nunca geram alerta imediato.
  - Elas aparecem numa seção própria do resumo.
- **Cidades e estados aceitos**: valem para vagas presenciais e híbridas. Uma por linha. Siglas de estado valem (PB).
- **Bolsa e carga horária**: bolsa mínima e máximo de horas por semana. Deixe vazio para não filtrar.
- **Suas tecnologias**: contam a favor na nota e ajudam a achar vagas com título genérico.
- **Palavras obrigatórias**: pelo menos uma precisa aparecer na vaga. Vagas que o título já identifica como estágio passam mesmo sem elas.
- **Palavras bloqueadas no título**: por exemplo, vendas e comercial. Sênior, pleno, júnior e "lead" já são descartados sozinhos pelo nível no título.
- **Cargos de interesse**: termos usados pelas fontes que buscam por palavra.

## Segurança

- **Só neste computador**: a API escuta apenas em `127.0.0.1` e recusa pedidos com outro endereço no cabeçalho `Host`. Isso bloqueia o ataque de DNS rebinding.
- **Só o dashboard grava**: toda escrita (status, nota, rascunho, ajustes) exige um cabeçalho que só o dashboard envia. Um site aberto em outra aba não consegue mudar seus dados nem gerar rascunhos pagos.
- **Sem login**: por isso o dashboard não deve ser exposto na rede nem na internet.

## Decisões de design

- **Componentes conhecidos**: barra lateral do macOS, barra de abas flutuante e folha do iOS, lista agrupada, controle segmentado, chaves de liga/desliga e o menu nativo do sistema nos filtros.
- **Uma marca visual só**: o anel de nota. O resto fica neutro.
- **Cores**: as cores de sistema da Apple, nas variantes acessíveis. Todo texto passa de 4,5:1 de contraste, medido nos dois temas sobre fundos, tons e preenchimentos.
- **Tema**: claro e escuro seguem o sistema.
- **Fonte**: a do sistema (SF Pro no Mac e no iPhone). Os títulos grandes têm espaçamento negativo, como no iOS.
- **Vidro só no que flutua**: barra lateral, barra de abas e cabeçalhos fixos são translúcidos, e o conteúdo passa por baixo deles. Com "Reduzir transparência" ligado no sistema, eles ficam sólidos.
- **Movimento** (seguindo a skill emil-design-eng):
  - os botões encolhem levemente ao toque;
  - o painel e a folha entram com uma curva de desaceleração forte e saem mais rápido por onde entraram;
  - nada anima ao trocar de lista, que é algo que se faz muitas vezes por dia;
  - com "Reduzir movimento" ligado, tudo vira um esmaecimento curto.

## Onde está cada coisa no código

| Arquivo | O que faz |
| --- | --- |
| `apps/web/src/App.tsx` | Estrutura: barra lateral ou abas, página atual e quando abrir a folha |
| `apps/web/src/routes.ts` | As listas inteligentes e a navegação pelo endereço (`#/salvas`, `#/quadro`…) |
| `apps/web/src/pages/JobsPage.tsx` | Lista, busca, filtros e o layout de três colunas |
| `apps/web/src/pages/KanbanPage.tsx` | Quadro com arrastar e soltar |
| `apps/web/src/pages/PreferencesPage.tsx` | Ajustes |
| `apps/web/src/components/JobRow.tsx` | Uma vaga na lista |
| `apps/web/src/components/JobDetail.tsx` | Detalhe da vaga, nota pessoal e mensagem de apresentação |
| `apps/web/src/components/Sheet.tsx` | Folha e painel flutuante, com arrastar para fechar |
| `apps/web/src/components/Navigation.tsx` | Barra lateral, barra de abas e pílulas das listas |
| `apps/web/src/components/ScoreRing.tsx` | O anel de nota |
| `apps/web/src/index.css` | Cores, materiais, chaves e animações |
| `apps/web/src/api.ts` | Chamadas à API e atualização otimista do status |
| `apps/api/src/server.ts` | A API REST que o dashboard usa |
