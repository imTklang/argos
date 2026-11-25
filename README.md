# Argos

> O nome vem de Argos Panoptes, o gigante de cem olhos da mitologia grega que nunca dormia.

Assistente pessoal que lê um currículo, varre fontes de vagas de estágio e avisa só das vagas que combinam com o perfil, explicando por quê. A candidatura é sempre manual.

Plano completo e fases em [PLAN.md](PLAN.md).

## Stack

TypeScript (Node 22+) · pnpm workspaces · SQLite + Drizzle · Zod · Vitest · Biome · Anthropic API

## Estrutura

```
apps/
  api/        # API REST (Fastify) e worker: varreduras agendadas e bot do Telegram
  web/        # dashboard React
  cli/        # comandos de linha de comando
packages/
  ai/         # chamadas ao Claude (extração de perfil, pontuação)
  core/       # tipos e schemas Zod
  db/         # schema Drizzle, migrations, cliente SQLite
  pipeline/   # scan, notificações e configuração, usados pelo CLI e pelo worker
  sources/    # adapters de fontes de vagas
config/       # fontes: empresas (Greenhouse, Lever, Ashby) e repositórios do GitHub
data/         # banco e currículo (fora do git)
```

## Use para você

O Argos foi feito para o meu perfil, mas tudo que é pessoal fica fora do código: currículo, preferências e fontes. Você precisa de:

- **Node 22+** e **pnpm** (`corepack enable` instala o pnpm na versão certa);
- uma **chave da API da Anthropic** ([console.anthropic.com](https://console.anthropic.com)) com crédito. A pontuação usa o Claude Haiku e cada varredura mostra o custo estimado no fim, em geral centavos de dólar. `SCAN_MAX_JOBS` e `DAILY_TOKEN_LIMIT` no `.env` limitam o gasto;
- opcional: um **token do GitHub** (só leitura) para a fonte de repositórios de vagas e um **bot do Telegram** para receber os avisos (veja [Telegram](#telegram)). Sem o Telegram, as vagas ficam só no dashboard.

```sh
git clone https://github.com/imTklang/argos.git && cd argos
corepack enable && pnpm install
cp .env.example .env                              # coloque ANTHROPIC_API_KEY (e o resto, se quiser)
cp ~/Downloads/seu-curriculo.pdf data/curriculo.pdf
pnpm cli profile import ./data/curriculo.pdf      # o Claude lê o currículo e mostra o perfil
pnpm cli prefs init                               # gera data/preferences.json
```

Antes da primeira varredura, **revise `data/preferences.json`** (ou a tela Ajustes do dashboard): as cidades, os cargos (`roles`, o primeiro é o preferido) e as palavras-chave vêm com valores de exemplo. Também vale trocar as empresas em `config/sources.json` pelas que interessam a você e ajustar `ARGOS_TIMEZONE` se não estiver em UTC-3.

```sh
pnpm cli scan --max 10           # primeira varredura, com no máximo 10 vagas pontuadas
pnpm build:web && pnpm api       # dashboard em http://localhost:3333
pnpm worker                      # varreduras às 8h e às 18h (ou veja "Sempre ligado no Mac" e "Deploy")
```

Para contribuir: `pnpm test`, `pnpm lint` e `pnpm typecheck` precisam passar (a CI roda os três).

## Comandos

```sh
pnpm cli profile import ./data/curriculo.pdf   # lê o currículo e gera o perfil
pnpm cli profile import ./data/curriculo.pdf --force   # extrai de novo
pnpm cli prefs init                            # gera data/preferences.json a partir do perfil
pnpm cli scan                                  # busca, filtra e pontua vagas de todas as fontes
pnpm cli scan --source github --max 10         # só algumas fontes, no máximo 10 pontuações
pnpm worker                                    # varreduras às 8h e 18h + bot do Telegram (Ctrl+C para parar)
pnpm worker --now --digest                     # roda uma varredura com resumo assim que inicia
pnpm build:web && pnpm api                     # dashboard em http://localhost:3333 (só nesta máquina)
pnpm api & pnpm web                            # desenvolvimento do dashboard com recarga automática (Vite)
```

## Sempre ligado no Mac

```sh
sh scripts/launchd/install.sh     # worker + dashboard iniciam no login e reiniciam se caírem
sh scripts/launchd/uninstall.sh   # remove
```

Logs em `data/logs/`. Se o Mac estiver dormindo às 8h ou às 18h, a varredura perdida roda assim que ele acordar (o worker confere a cada 10 minutos). Rode o `install.sh` de novo depois de atualizar o Node.

## Dashboard

Visual no estilo Apple, com Liquid Glass (macOS no computador, iOS 27 no celular): listas inteligentes como caixas do Mail (Para você, Novas, Salvas, Candidaturas, Descartadas), detalhe da vaga ao lado da lista em telas largas ou em painel nas menores, quadro por status com arrastar e soltar (também pelo teclado) e Ajustes no estilo do app Ajustes do iPhone. O detalhe traz a análise da IA, nota pessoal e rascunho de mensagem de apresentação gerado sob demanda pelo Claude Sonnet 5.5. A API escuta só em `127.0.0.1`: não há login, então o dashboard não deve ser exposto na rede. Guia completo em [docs/dashboard.md](docs/dashboard.md).

Vagas encerradas (issue fechada, fora do board da empresa, prazo vencido ou sem aparecer há 120 dias) somem das listas e dos avisos; as que você salvou ou em que se candidatou continuam, marcadas como **Encerrada**.

## Deploy

`docker compose up -d --build` sobe o dashboard e o worker num servidor, com o dashboard acessível só pela sua rede do Tailscale e backup opcional do banco com Litestream. Passo a passo em [docs/deploy.md](docs/deploy.md).

## Telegram

1. Crie um bot no [@BotFather](https://t.me/BotFather) e coloque o token em `TELEGRAM_BOT_TOKEN` no `.env`.
2. Rode `pnpm worker` e mande `/start` para o bot: ele responde com o ID do chat.
3. Coloque o ID em `TELEGRAM_CHAT_ID` e reinicie o worker.

Vagas com nota ≥ `instantAlertScore` (padrão 85) chegam na hora, com botões **Salvar** e **Descartar**. Às 18h chega o resumo das vagas com nota ≥ `minScoreToNotify`.

## Vagas remotas no exterior

Com `"abroad": "remote"` em `data/preferences.json`, o Argos também traz estágios remotos de empresas de fora que aceitam candidatos no Brasil (fonte [Himalayas](https://himalayas.app) e as vagas remotas no exterior das empresas de Greenhouse/Lever/Ashby). Elas ficam em segundo plano: são pontuadas depois das vagas do Brasil, nunca disparam alerta imediato e aparecem no resumo das 18h numa seção própria. A IA confere país aceito, fuso, nível de inglês e sinais de vaga ruim (estágio não remunerado, anúncio em massa).

## Licença

[MIT](LICENSE). Use, modifique e distribua à vontade, mantendo o aviso de copyright.
