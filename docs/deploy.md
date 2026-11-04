# Deploy para uso próprio

Este guia põe o Argos num servidor para que as varreduras das 8h e das 18h e o bot do Telegram rodem com o seu computador desligado. O dashboard continua só seu: ele não tem login, então fica numa rede privada (Tailscale), nunca aberto na internet.

```
celular / notebook ──Tailscale──▶ servidor
                                   ├─ api     (dashboard, porta 3333 só no loopback)
                                   ├─ worker  (varreduras + bot do Telegram)
                                   └─ backup  (opcional: Litestream → R2/B2)
                                   data/ = banco, preferências e currículo
```

## 1. Servidor

Qualquer máquina Linux com Docker serve: uma VPS pequena (Hetzner CX22, cerca de €4 por mês; Oracle Cloud Free Tier, grátis) ou um Raspberry Pi 4 em casa. 1 GB de RAM basta.

```sh
# Ubuntu/Debian
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # saia e entre de novo
```

## 2. Tailscale

Instale o [Tailscale](https://tailscale.com/download) no servidor e nos seus aparelhos, com a mesma conta.

```sh
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

O servidor ganha um nome como `argos.tail1234.ts.net`. Ele só é alcançável pelos seus aparelhos.

## 3. Código e dados

```sh
git clone https://github.com/imTklang/argos.git && cd argos
mkdir -p data
```

Do seu computador, copie o que já existe (perfil, vagas, status e preferências):

```sh
# no seu Mac, com o Argos parado
scp data/radar.db data/preferences.json usuario@argos:~/argos/data/
```

No servidor, entregue a pasta ao usuário do container (uid 1000):

```sh
sudo chown -R 1000:1000 data
```

## 4. `.env`

Copie `.env.example` para `.env` e preencha. **Gere chaves novas** para o servidor em vez de reaproveitar as do seu computador:

- `ANTHROPIC_API_KEY`: console.anthropic.com → API Keys (crie uma só para o servidor, com limite de gasto).
- `TELEGRAM_BOT_TOKEN`: no @BotFather, `/revoke` gera um token novo para o mesmo bot.
- `GITHUB_TOKEN`: fine-grained, sem permissões além de leitura pública.
- `ALLOWED_HOSTS`: o nome do servidor no Tailscale, ex. `argos.tail1234.ts.net`.

Só um processo pode usar o token do bot por vez (long polling). Pare o worker do seu computador antes de subir o do servidor.

## 5. Subir

```sh
docker compose up -d --build
docker compose logs -f worker   # "Worker ativo. Varreduras às 8h e às 18h"
```

Para ver no Tailscale com HTTPS:

```sh
sudo tailscale serve --bg 3333
```

Abra `https://argos.tail1234.ts.net` no celular ou no notebook. No iPhone, "Adicionar à Tela de Início" dá um ícone com o logo do Argos.

Uma varredura na hora, sem esperar o horário:

```sh
docker compose exec worker node --import tsx apps/cli/src/index.ts scan
```

A CLI e o worker usam uma trava compartilhada no banco: se um estiver varrendo, o outro espera a próxima vez em vez de pontuar e avisar em dobro.

## 6. Backup (recomendado)

O banco guarda seus status, notas e cartas. O serviço `backup` usa o [Litestream](https://litestream.io) para copiar cada mudança para um bucket compatível com S3:

1. Crie um bucket no Cloudflare R2 (10 GB grátis) ou no Backblaze B2 e uma chave de acesso só para ele.
2. Preencha `LITESTREAM_BUCKET`, `LITESTREAM_ENDPOINT`, `LITESTREAM_ACCESS_KEY_ID` e `LITESTREAM_SECRET_ACCESS_KEY` no `.env`.
3. `docker compose --profile backup up -d`

Para restaurar num servidor novo:

```sh
docker run --rm --env-file .env -v ./data:/data -v ./litestream.yml:/etc/litestream.yml \
  litestream/litestream:0.3.13 restore /data/radar.db
```

## 7. Atualizar

```sh
git pull && docker compose up -d --build
```

As migrações do banco rodam sozinhas ao iniciar. Se uma varredura estiver em andamento, o worker espera ela terminar antes de parar (até 10 minutos).

## Conferir que está tudo bem

- `docker compose ps`: `api` aparece como `healthy`.
- O dashboard mostra a última varredura de cada fonte em "Última varredura".
- Se uma varredura agendada falhar, o bot avisa no Telegram.
- Teste as fontes do servidor uma vez com `scan`: alguns sites bloqueiam IPs de datacenter. Se Gupy, Sólides ou CIEE falharem só no servidor, um Raspberry Pi em casa resolve.

## Sem Docker

Também funciona com Node 22 e pnpm direto no servidor, por exemplo com systemd: `pnpm install && pnpm build:web`, depois dois serviços rodando `pnpm api` e `pnpm worker`. Os caminhos de `data/` e `config/` são resolvidos a partir da raiz do repositório, então o diretório de trabalho do serviço não importa.
