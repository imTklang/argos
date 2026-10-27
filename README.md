# Radar de Estágio

Assistente pessoal que lê um currículo, varre fontes de vagas de estágio e avisa só das vagas que combinam com o perfil, explicando por quê. A candidatura é sempre manual.

Plano completo e fases em [PLAN.md](PLAN.md).

## Stack

TypeScript (Node 22+) · pnpm workspaces · SQLite + Drizzle · Zod · Vitest · Biome · Anthropic API

## Estrutura

```
apps/
  api/        # servidor Fastify + jobs agendados (Fase 2)
  cli/        # comandos de linha de comando
packages/
  core/       # tipos e schemas Zod
  db/         # schema Drizzle, migrations, cliente SQLite
  sources/    # adapters de fontes de vagas
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
