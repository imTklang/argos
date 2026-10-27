# Radar de Estágio

Assistente pessoal que lê um currículo, varre fontes de vagas de estágio e avisa só das vagas que combinam com o perfil, explicando por quê. A candidatura é sempre manual.

Plano completo e fases em [PLAN.md](PLAN.md).

## Stack

TypeScript (Node 22+) · pnpm workspaces · SQLite + Drizzle · Zod · Vitest · Biome · Anthropic API

## Estrutura

```
apps/
  api/        # worker: varreduras agendadas e bot do Telegram
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
```

## Telegram

1. Crie um bot no [@BotFather](https://t.me/BotFather) e coloque o token em `TELEGRAM_BOT_TOKEN` no `.env`.
2. Rode `pnpm worker` e mande `/start` para o bot: ele responde com o ID do chat.
3. Coloque o ID em `TELEGRAM_CHAT_ID` e reinicie o worker.

Vagas com nota ≥ `instantAlertScore` (padrão 85) chegam na hora, com botões **Salvar** e **Descartar**. Às 18h chega o resumo das vagas com nota ≥ `minScoreToNotify`.
