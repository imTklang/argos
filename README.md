# Radar de Estágio

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

## Rodando

```sh
pnpm install
cp .env.example .env   # preencha as chaves
pnpm test
pnpm lint
pnpm typecheck
pnpm cli
```

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

## Dashboard

Visual no estilo Apple (macOS no computador, iOS 27 no celular): listas inteligentes como caixas do Mail (Para você, Novas, Salvas, Candidaturas, Descartadas), detalhe da vaga ao lado da lista em telas largas ou em painel nas menores, quadro por status com arrastar e soltar (também pelo teclado) e Ajustes no estilo do app Ajustes do iPhone. O detalhe traz a análise da IA, nota pessoal e rascunho de mensagem de apresentação gerado sob demanda pelo Claude Sonnet 5.5. A API escuta só em `127.0.0.1`: não há login, então o dashboard não deve ser exposto na rede. Guia completo em [docs/dashboard.md](docs/dashboard.md).

## Telegram

1. Crie um bot no [@BotFather](https://t.me/BotFather) e coloque o token em `TELEGRAM_BOT_TOKEN` no `.env`.
2. Rode `pnpm worker` e mande `/start` para o bot: ele responde com o ID do chat.
3. Coloque o ID em `TELEGRAM_CHAT_ID` e reinicie o worker.

Vagas com nota ≥ `instantAlertScore` (padrão 85) chegam na hora, com botões **Salvar** e **Descartar**. Às 18h chega o resumo das vagas com nota ≥ `minScoreToNotify`.

## Vagas remotas no exterior

Com `"abroad": "remote"` em `data/preferences.json`, o Radar também traz estágios remotos de empresas de fora que aceitam candidatos no Brasil (fonte [Himalayas](https://himalayas.app) e as vagas remotas no exterior das empresas de Greenhouse/Lever/Ashby). Elas ficam em segundo plano: são pontuadas depois das vagas do Brasil, nunca disparam alerta imediato e aparecem no resumo das 18h numa seção própria. A IA confere país aceito, fuso, nível de inglês e sinais de vaga ruim (estágio não remunerado, anúncio em massa).
