# Radar de Estágio — Plano do projeto

> Documento de contexto para o Claude Code. Coloque na raiz do repositório (pode virar `CLAUDE.md` depois).
> Autor: Enzo (imTklang) — estudante de CC na UNIESP, João Pessoa/PB, procurando o primeiro estágio em backend (Node.js/TypeScript).

---

## 1. Objetivo

Um assistente pessoal que:

1. **Lê o meu currículo (PDF)** e extrai um perfil estruturado: skills, nível, formação, idiomas, projetos.
2. **Gera preferências de busca** a partir desse perfil (eu reviso e ajusto).
3. **Varre várias fontes de vagas** em horários definidos.
4. **Filtra e pontua** cada vaga pela aderência ao meu perfil, explicando o porquê.
5. **Me avisa** só das vagas que valem a pena (digest diário + alerta para match muito alto).
6. **Guarda histórico**: vagas vistas, descartadas, salvas e candidatadas, sem repetir.

Não é objetivo: candidatar-se automaticamente. A candidatura é sempre manual.

---

## 2. Stack (decidida)

| Camada | Escolha | Motivo |
|---|---|---|
| Linguagem | **TypeScript (Node 22+)** | É a stack das vagas que estou buscando; o projeto vira portfólio direto. |
| API | **Fastify** (ou Hono) | Leve, tipado, rápido de subir. |
| Banco | **SQLite + Drizzle ORM** no MVP → Postgres depois | Zero infra no início; Drizzle facilita a migração. |
| Validação | **Zod** | Valida dados das fontes e o JSON que vem da IA. |
| Coleta | `fetch` para APIs/JSON; **Playwright** só onde não houver alternativa | Scraping de HTML é frágil; preferir endpoints estruturados. |
| Agendamento | **node-cron** no MVP → BullMQ + Redis se precisar de fila | Simples primeiro. |
| IA | **Anthropic SDK (`@anthropic-ai/sdk`)** — `claude-haiku-5-5` para pontuar vagas, `claude-sonnet-5-5` para ler o currículo | Haiku é barato para volume; Sonnet para a extração que roda poucas vezes. |
| PDF | `pdf-parse` (ou `unpdf`) | Extrair texto do currículo. |
| Notificação | **Bot do Telegram** (e/ou e-mail via Resend) | Chega no celular, fácil de implementar. |
| Frontend | **React + Vite + TanStack Query** (fase 3) | Dashboard para revisar vagas. Não é necessário no MVP. |
| Testes | **Vitest** | |
| Lint/format | **Biome** | |

Estrutura sugerida (monorepo simples com pnpm workspaces):

```
radar-estagio/
  apps/
    api/        # Fastify + jobs agendados
    web/        # React (fase 3)
  packages/
    core/       # tipos, schemas Zod, lógica de matching
    sources/    # um adapter por fonte de vagas
  data/         # sqlite + currículo (gitignored)
  PLAN.md
```

---

## 3. Fontes de vagas

Cada fonte é um **adapter** com a mesma interface:

```ts
interface JobSource {
  id: string;                         // "gupy", "github-backend-br", ...
  fetchJobs(query: SearchQuery): Promise<RawJob[]>;
  normalize(raw: RawJob): Job;        // converte para o formato único
}
```

Ordem de implementação (da mais estável para a mais frágil):

1. **Gupy** — maior plataforma de vagas no Brasil, muitas vagas de estágio. Verificar se o portal público expõe endpoint JSON de busca antes de partir para scraping.
2. **Repositórios de vagas no GitHub** (ex.: `backend-br/vagas`, `frontendbr/vagas`) — as vagas são issues; usar a API REST do GitHub com `GITHUB_TOKEN`. Descartado e **reativado em 27/10/2026**: o volume de estágio é baixo, mas a fonte é estável e cobre vagas júnior/remotas de tecnologia que as plataformas de RH não têm. Lista de repositórios em config; referência de estudo em `docs/research/vagometro.md`.
3. **Greenhouse / Lever / Ashby** — empresas de tech usam essas plataformas e elas têm APIs públicas de job board por empresa. Manter uma lista de empresas-alvo em config.
4. **Outras BR** (avaliadas em 27/10/2026):
   - **Sólides** — implementada. API do próprio portal; busca a união de "área tecnologia", "remoto" e as UFs das preferências (~20 requisições, `take` máximo 20).
   - **CIEE** — implementada. API pública `api.ciee.org.br`; todos os estágios de nível superior (3 requisições). Traz bolsa e horário, mas não título nem modalidade, e quase não tem vagas de TI fora do Sudeste.
   - **Nube** — adiada. API sem login, mas a listagem não tem descrição (exige uma requisição por vaga) e havia só ~30 vagas de TI, 1 remota.
   - **Programathor** — descartada. Só HTML, rate limit agressivo (429 na 2ª requisição) e só 1 estágio aberto.
   - Vagas.com — não avaliada.
5. **LinkedIn — sem scraping logado.** Scraping do LinkedIn viola os termos de uso e pode resultar em banimento da conta, que é a conta que eu uso para me candidatar. Alternativa segura: criar **alertas de vaga no LinkedIn** e o sistema **ler os e-mails de alerta** (Gmail API / IMAP) para extrair as vagas. Implementar só na fase 2.

Regras para todos os adapters:
- Respeitar rate limit, com intervalo entre requisições e User-Agent identificável.
- Falha de uma fonte não derruba a varredura (log + segue).
- Cada adapter tem teste com fixture (resposta salva em JSON/HTML), sem depender da rede.

---

## 4. Pipeline

```
Currículo PDF ──► extração de texto ──► IA (Sonnet) ──► Perfil (JSON) ──► eu reviso ──► Preferências
                                                                                             │
cron ──► adapters ──► normalizar ──► deduplicar ──► filtro duro ──► IA (Haiku) score ──► salvar ──► notificar
```

### 4.1 Perfil (saída da leitura do currículo)

```ts
type Profile = {
  name: string;
  course: string;            // "Ciência da Computação"
  institution: string;
  currentPeriod: number;
  expectedGraduation: string;
  skills: { name: string; level: "básico" | "intermediário" | "avançado"; evidence?: string }[];
  languages: { name: string; level: string }[];
  projects: { name: string; stack: string[]; summary: string }[];
  experience: { title: string; org: string; summary: string }[];
};
```

### 4.2 Preferências (geradas do perfil, editáveis)

```ts
type Preferences = {
  roles: string[];             // ["estágio backend", "estágio desenvolvimento", "estágio full stack"]
  keywordsMust: string[];      // pelo menos uma precisa aparecer
  keywordsBonus: string[];     // ["node", "typescript", "elixir", "postgres"]
  keywordsBlock: string[];     // ["sênior", "pleno", "vendas", "suporte n1"]
  modality: ("remoto" | "híbrido" | "presencial")[];
  locations: string[];         // ["João Pessoa", "PB", "Brasil (remoto)"]
  minStipend?: number;
  maxHoursPerWeek?: number;    // estágio normalmente 20h–30h
  minScoreToNotify: number;    // ex.: 70
};
```

### 4.3 Filtro duro (sem IA, barato)

Descarta antes de gastar token: senioridade incompatível, palavras bloqueadas, localidade/modalidade fora, vaga expirada, vaga já vista (hash de empresa + título + URL).

### 4.4 Pontuação com IA (Haiku)

Para cada vaga que passou no filtro, enviar perfil + preferências + vaga e exigir **JSON validado por Zod**:

```ts
type JobScore = {
  score: number;               // 0–100
  matchedSkills: string[];
  missingSkills: string[];
  dealBreakers: string[];      // ex.: "exige formação até 2026"
  summary: string;             // 1–2 frases: por que vale ou não
};
```

- Usar prompt caching no perfil/preferências (são iguais em todas as chamadas).
- Limite de custo: contador de tokens por varredura e teto diário configurável.
- Se o JSON vier inválido: 1 retry, depois marca como "não pontuada".

---

## 5. Modelo de dados (SQLite / Drizzle)

- `profiles` — perfil extraído (JSON) + versão do currículo
- `preferences` — preferências atuais
- `jobs` — vaga normalizada (fonte, id externo, título, empresa, local, modalidade, descrição, URL, publicada_em, hash)
- `job_scores` — score + JSON da análise + modelo usado
- `job_status` — `nova | vista | salva | candidatei | descartada` + data + nota
- `runs` — log de cada varredura (início, fim, fonte, qtd encontrada, erros, tokens gastos)

---

## 6. Fases

### Fase 0 — Setup
- Monorepo pnpm, TypeScript strict, Biome, Vitest, Drizzle + SQLite, `.env.example`.
- **Checkpoint:** `pnpm test` e `pnpm lint` passando.

### Fase 1 — MVP pela linha de comando
1. `cli profile import ./data/curriculo.pdf` → gera e salva o perfil; imprime para eu revisar.
2. `cli prefs init` → gera preferências a partir do perfil; salva em JSON editável.
3. Adapter **Gupy** (busca todos os estágios, ~2.550 vagas em ~45 s) e adapter **GitHub** (issues dos repositórios de vagas, ver seção 3).
4. `cli scan` → roda o pipeline completo e imprime uma tabela ordenada por score.
5. Deduplicação e histórico funcionando.
- **Checkpoint:** rodar `cli scan` e trazer vagas reais e relevantes.

### Fase 2 — Automação e notificações
- node-cron (ex.: 8h e 18h, horário de Fortaleza/UTC-3). **Feito:** `pnpm worker`, iniciado manualmente (sem launchd, por decisão de 27/10/2026).
- Bot do Telegram: digest diário + alerta imediato para score ≥ 85; botões "salvar / descartar". **Feito.**
- Adapters Greenhouse/Lever com lista de empresas-alvo. **Feito**, mais Ashby (Nubank); empresas em `config/sources.json`.
- Leitura dos e-mails de alerta do LinkedIn. **Adiada** por decisão de 27/10/2026.

### Fase 3 — Dashboard
- API REST no Fastify (listar vagas, filtrar, mudar status, editar preferências).
- React: lista de vagas com score e justificativa, filtros, kanban por status.
- Gerar rascunho de mensagem/carta de apresentação para uma vaga específica (sob demanda).

### Fase 4 — Deploy (opcional)
- Postgres, Docker, deploy em Fly.io / Railway / VPS.

---

## 7. Regras de trabalho para o Claude Code

- Trabalhar **uma fase por vez**; ao fim de cada fase, parar e resumir o que foi feito, o que ficou de fora e qual é o próximo passo.
- **Antes de criar um adapter**, investigar a fonte (formato da resposta, paginação, limites) e me mostrar o que encontrou.
- Nunca fazer scraping autenticado do LinkedIn nem de nenhum site com o meu login.
- Segredos só em `.env` (nunca commitados): `ANTHROPIC_API_KEY`, `TELEGRAM_BOT_TOKEN`, `GITHUB_TOKEN`.
- `data/` e o currículo ficam no `.gitignore`.
- Todo adapter e toda função de matching com teste usando fixture.
- Commits pequenos, mensagens em inglês no padrão Conventional Commits.
- Código e nomes em inglês; textos para o usuário (CLI, Telegram) em português.
- Na dúvida entre duas abordagens, perguntar em vez de escolher sozinho.

---

## 8. Primeira tarefa

Comece pela **Fase 0** e pelo item 1 da **Fase 1** (importar o currículo e gerar o perfil). Antes de escrever código, me mostre a estrutura de pastas e as dependências que vai instalar.
