# Estudo: vagometro como referência

> Estudo feito em 27/10/2026 sobre o repositório [leo-holanda/vagometro](https://github.com/leo-holanda/vagometro) (GPL-3.0).
> Leitura isolada, por um subagente, de uma cópia temporária fora deste repositório, já apagada.
> Nenhum código do vagometro foi copiado ou adaptado para o Argos. Este documento descreve ideias e fatos sobre APIs externas com palavras próprias.

## Visão geral

O backend do vagometro é pequeno: duas funções Lambda em Python que só coletam dados (repositórios de vagas do GitHub e Gupy) e gravam o JSON bruto num MongoDB.
Toda a classificação (nível, modalidade, contrato, tecnologias, empresa) acontece no frontend Angular, no navegador, sobre esse JSON bruto.
O LinkedIn também é fonte deles, mas por scraping, e ficou fora deste estudo.

## 1. Repositórios de vagas no GitHub

**Repositórios monitorados:** `frontendbr/vagas`, `backend-br/vagas`, `soujava/vagas-java`, `react-brasil/vagas` e `androiddevbr/vagas`.
A função de coleta recebe o repositório como parâmetro, e um agendador externo dispara uma execução por repositório.

**API**
- REST: `GET /repos/{owner}/{repo}/issues`. Não usa GraphQL.
- O token vem de uma variável de ambiente e vai no header `Authorization`.

**Coleta**
- Pede issues abertas **e** fechadas.
- Não filtra por label e não usa `since`.
- Guarda só as issues criadas no dia anterior, comparando com o relógio da Lambda em UTC, e não no horário de Brasília.
- Usa 10 issues por página.

**Problemas observados (que evitamos)**
- A paginação tem um defeito que, na prática, limita a coleta à primeira página.
- Pull requests não são descartados. O endpoint de issues também devolve PRs, e eles entram como vaga.
- Coletar issues fechadas não serve a quem vai se candidatar.
- Os labels são gravados como objetos, mas o frontend os trata como texto, então o casamento por label provavelmente não funciona.

**Extração dos campos**
- **Título:** usado como veio, com o prefixo `[Remoto]`.
- **Empresa:** inferida do título por separadores, em ordem: `@`, `|`, as preposições "na", "no" e "at", e o hífen. As preposições são procuradas sem fronteira de palavra, o que gera falsos positivos.
- **Local:** não é extraído; cidade e estado ficam como "desconhecido".

## 2. Classificação

**Técnica:** dicionários termo → categoria, casados por palavra inteira depois de uma normalização. A normalização remove acentos, troca alguns sinais de pontuação por espaço e passa tudo para minúsculas.

**Nível**
- Categorias: estágio, trainee, júnior, pleno, sênior, especialista e "pede experiência".
- Abreviações reconhecidas: jr, pl, sr e algarismos romanos (II, III).
- Precedência: título, depois labels, depois o corpo da issue.
- Uma categoria separada detecta frases do tipo "experiência comprovada em…" e "sólida vivência com…". A palavra "experiência" sozinha aparece em frases de marketing e não serve como sinal.
- No Gupy, o nível sai do campo estruturado `type` antes de olhar o texto.

**Modalidade e contrato**
- Busca por trechos de texto, sem fronteira de palavra e sem precedência.
- Uma vaga pode sair remota e presencial ao mesmo tempo.
- "pj" e "clt" casam dentro de outras palavras.
- No Gupy, a modalidade vem de `workplaceType`.

**Armadilhas da normalização deles**
- A tokenização só separa por espaço, então quebra de linha e dois-pontos não separam palavras.
- A troca de ponto por espaço quebra ".NET" e "Node.js".
- Termos com acento ou pontuação no dicionário nunca casam depois da normalização.

### O que o filtro duro do Argos não tinha

| Ideia | Situação no Argos |
|---|---|
| Nível vindo de dado estruturado (label no GitHub, `type` no Gupy) antes do texto | **Implementado nesta branch** (campo `level` no `Job`) |
| Labels do GitHub como sinal de nível e modalidade, com o título valendo mais que labels esquecidos do template | **Implementado nesta branch** |
| Abreviações de nível: sr, pl, jr, romanos, "líder", "staff", "principal", "plena" | Pendente: hoje "Dev Backend Sr" passa pelo bloqueio de título |
| Decidir explicitamente sobre trainee e jovem aprendiz | Pendente |
| Penalizar estágio que exige "experiência sólida/comprovada" | Pendente (hoje fica a cargo da IA) |
| Termos de modalidade em inglês (remote, hybrid, on-site, home office) | Parcial: só no adapter do GitHub |
| Detectar repostagem (mesma empresa, título e descrição com ids diferentes) e a mesma vaga em fontes diferentes | Pendente |

**O que o Argos já fazia melhor:** fronteira de palavra em todas as buscas; prazo e idade máxima da vaga; localização com UF → estado; filtro de vaga fora de TI.

## 3. Gupy: diferenças em relação ao nosso adapter

- Eles usam outro endpoint, `employability-portal.gupy.io/api/v1/jobs`, que respondeu 404 quando testamos em 26/10/2026. O nosso `portal.gupy.io/api/job-search/jobs` é o que o portal usa hoje.
- Eles buscam por termos de cargo (`jobName`) em vez de filtrar por `type`, e classificam depois. Nós pedimos `type=vacancy_type_internship`, que é mais preciso para estágio.
- Eles param a paginação pela data de publicação (só o dia anterior). Nós paginamos até uma página incompleta e cortamos por idade no filtro.
- Eles usam espera exponencial com variação aleatória e um teto de cerca de 2 minutos. Nós usamos 3 novas tentativas com 10, 20 e 30 s de espera.
- Campos que eles leem e nós não: `isRemoteWork`, `disabilities`, `careerPageUrl` e `country`.
- Eles não decodificam entidades HTML; nós decodificamos.

## Ideias para o Argos, por prioridade

1. Nível por labels e título no GitHub, e por `type` no Gupy. *Feito nesta branch.*
2. Ampliar o bloqueio de nível com abreviações casadas por palavra inteira (sr, pl, III, lead, staff, plena).
3. Coleta robusta do GitHub: issues abertas, sem PRs, com `since`, 100 por página e token com `Bearer`. *Feito nesta branch.*
4. Sinal de "exige experiência sólida" no corpo da vaga, como penalidade para estágio.
5. Gupy: ler `isRemoteWork` como reforço da modalidade e validar que o `type` retornado é estágio.
6. Deduplicação semântica entre fontes e repostagens: empresa e título normalizados, mais um hash da descrição.
7. Extrair o tipo de contrato (CLT/PJ) por palavra inteira, para sinalizar "estágio" oferecido como PJ.
