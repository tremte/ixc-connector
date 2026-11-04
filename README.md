# ixc-connector

Servidor MCP remoto, **somente leitura**, para o IXC Provedor (IXC Soft). Assistentes de cada setor da empresa se conectam por HTTPS, com uma chave própria, e consultam clientes, contratos, logins, ordens de serviço, atendimentos, financeiro e planos. O processo não tem método de criar, alterar ou apagar registro.

O endereço e o token do IXC entram só por variável de ambiente. Com `IXC_MOCK=true` o servidor sobe com dados fictícios, sem rede, para demonstração e teste.

## Ferramentas

As descrições vistas pelo modelo estão em português. Cada chamada devolve um texto curto, com página e total. O tamanho da página é limitado por `IXC_MAX_PAGE_SIZE`.

| Ferramenta | O que consulta | Grupo |
| --- | --- | --- |
| `buscar_clientes` | Nome (razão social; se a página vier vazia, nome fantasia), CPF/CNPJ ou id. Exige filtro. | clientes |
| `obter_cliente` | Detalhe de um cliente, inclusive cidade quando a tabela `cidade` responde. | clientes |
| `listar_contratos` | Contratos por cliente, status (`P A I N D`) ou status da internet (`A D CM CA FA AA`). | contratos |
| `obter_contrato` | Um contrato. | contratos |
| `listar_movimentacao_contratos` | Ativações (`data_ativacao`) ou cancelamentos (`data_cancelamento`) num intervalo de até 366 dias. | contratos |
| `listar_logins` | Logins PPPoE/radius (`radusuarios`) por cliente, contrato ou login. Online = `S`, offline = `N`. Senhas nunca saem. | logins |
| `listar_ordens_servico` | OS (`su_oss_chamado`). Padrão: abertas (status diferente de `F`). Filtro por técnico, assunto, cidade, bairro, região, cliente e data de abertura. | os |
| `obter_ordem_servico` | Uma OS. | os |
| `listar_tickets` | Atendimentos (`su_ticket`). Padrão: abertos (`su_status` diferente de `S` e de `C`). | tickets |
| `obter_ticket` | Um atendimento. | tickets |
| `listar_contas_receber` | Títulos (`fn_areceber`): abertas (`A`), vencidas, recebidas (`R`) ou todas. Exige cliente, contrato ou intervalo de vencimento. | financeiro |
| `resumo_inadimplencia` | Soma de títulos `A` e `P` com vencimento anterior a hoje, no fuso `BUSINESS_TIMEZONE`. Respeita `IXC_SUMMARY_MAX_RECORDS`. | financeiro |
| `listar_planos` | Planos de venda (`vd_contratos`). Padrão: campo `Ativo = S`. | planos |
| `obter_plano` | Um plano. | planos |

### Quem vê o quê

A chave Bearer escolhe o perfil. Ferramenta fora do perfil **não aparece** em `tools/list` e a chamada é recusada.

| Perfil | Grupos |
| --- | --- |
| `infraestrutura` | clientes, contratos, logins, OS, tickets |
| `financeiro` | clientes, contratos, financeiro |
| `vendas` | clientes, contratos, planos |
| `juridico` | clientes, contratos |
| `admin` | todos |

`MASK_PII` vale `true` por padrão. CPF/CNPJ e telefones saem mascarados para todo perfil que não seja `admin`. O admin vê o dado completo. O log de auditoria mascara esses campos para todo mundo e nunca grava token.

Cada chamada grava uma linha JSON em stdout:

```json
{"ts":"...","level":"audit","profile":"financeiro","keyName":"financeiro","tool":"obter_cliente","params":{"id":"10"},"resultCount":1,"durationMs":12,"ok":true}
```

Logs de ciclo de vida vão para stderr. Não misture a chave do setor nem o `IXC_TOKEN` nessas linhas: o código não os inclui.

## Variáveis de ambiente

| Variável | Obrigatória | Padrão | Função |
| --- | --- | --- | --- |
| `IXC_MOCK` | não | `false` | `true` não chama o IXC e usa a base fictícia. |
| `IXC_BASE_URL` | fora do mock | — | URL do IXC. `/webservice/v1` no final é aceito e removido. |
| `IXC_TOKEN` | fora do mock | — | `id_do_usuario:token`, sem espaços. |
| `IXC_INSECURE_TLS` | não | `false` | Aceita certificado autoassinado só nas chamadas ao IXC. |
| `IXC_BODY_FORMAT` | não | `json` | `json` ou `form`. Veja a seção da API. |
| `IXC_TIMEOUT_MS` | não | `15000` | Tempo limite de cada chamada. |
| `IXC_MAX_RETRIES` | não | `2` | Repetições extras em HTTP 5xx, 429, timeout e falha de rede. 4xx não repete. |
| `IXC_RETRY_BASE_MS` | não | `200` | Espera inicial; dobra a cada tentativa. |
| `IXC_MAX_PAGE_SIZE` | não | `50` | Teto de `rp` enviado ao IXC. |
| `IXC_DEFAULT_PAGE_SIZE` | não | `20` | Página quando o modelo não informa `limite`. |
| `IXC_SUMMARY_MAX_RECORDS` | não | `500` | Teto da soma de inadimplência. |
| `IXC_MIN_INTERVAL_MS` | não | `50` | Intervalo mínimo entre chamadas ao IXC. |
| `IXC_MAX_CONCURRENCY` | não | `4` | Chamadas simultâneas ao IXC. |
| `MASK_PII` | não | `true` | Máscara de CPF/CNPJ e telefone fora do admin. |
| `BUSINESS_TIMEZONE` | não | `America/Sao_Paulo` | “Hoje” da inadimplência. |
| `HOST` / `PORT` | não | `0.0.0.0` / `3000` | Escuta HTTP. |
| `TRUST_PROXY` | não | `false` | `true` atrás do Traefik, para o limite por IP usar `X-Forwarded-For`. |
| `RATE_LIMIT_PER_MINUTE` | não | `60` | Requisições MCP por chave. |
| `IP_RATE_LIMIT_PER_MINUTE` | não | `600` | Requisições MCP por IP. `/health` não entra na conta. |
| `MCP_KEYS` | uma das duas | — | JSON com as chaves dos setores. |
| `MCP_KEYS_FILE` | uma das duas | — | Caminho de um JSON. Se definida, tem prioridade sobre `MCP_KEYS`. |

Formato das chaves (lista ou `{"keys":[...]}`):

```json
[
  {"name":"infra","profile":"infraestrutura","key":"cole-aqui-uma-chave-longa"},
  {"name":"financeiro","profile":"financeiro","key":"outra-chave-diferente"},
  {"name":"vendas","profile":"vendas","key":"outra-chave-vendas"},
  {"name":"juridico","profile":"juridico","key":"outra-chave-juridico"},
  {"name":"admin","profile":"admin","key":"outra-chave-admin"}
]
```

`name` identifica a chave no log. `profile` é um dos cinco nomes acima. `key` tem no mínimo 16 caracteres, sem espaço. Gere com `openssl rand -hex 24`. Há um modelo em `config/profiles.example.json`.

Sem `MCP_KEYS` e sem arquivo, o processo só sobe se `IXC_MOCK=true`. Nesse caso ele ativa chaves de demonstração e avisa no stderr. Não publique esse modo.

| Perfil | Chave de demonstração |
| --- | --- |
| infraestrutura | `demo-infra-chave-somente-mock` |
| financeiro | `demo-financeiro-chave-somente-mock` |
| vendas | `demo-vendas-chave-somente-mock` |
| juridico | `demo-juridico-chave-somente-mock` |
| admin | `demo-admin-chave-somente-mock` |

## Usuário somente leitura no IXC

O conector recusa escrita no código. A permissão no IXC precisa repetir isso: se o token puder inserir, outro sistema com o mesmo token ainda pode. Use um usuário só da integração.

O passo a passo abaixo é o da wiki oficial ([como gerar um token](https://wiki.ixcsoft.com.br/pt-br/API/como_gerar_um_token_para_integra%C3%A7%C3%B5es_API) e [documentação da API](https://wiki.ixcsoft.com.br/pt-br/API/Documenta%C3%A7%C3%A3o_API)). A página do token respondeu HTTP 500 na verificação desta versão; o texto indexado da própria wiki e os exemplos de `wikiapiprovedor.ixcsoft.com.br` confirmam o fluxo.

1. **Configurações → Usuários → Grupo de Usuários → Novo.** Nome sugerido: `API leitura MCP`.
2. Libere só a consulta dos formulários usados aqui: `cliente`, `cliente_contrato`, `radusuarios`, `su_oss_chamado`, `su_ticket`, `fn_areceber`, `vd_contratos`. Para filtro por nome, também `cidade`, `su_oss_assunto` e `funcionarios`. Não marque inserir, editar ou excluir.
3. Em **Redes permitidas**, inclua o IP de saída do servidor onde o Dokploy roda. Sem isso o IXC responde que o IP não está liberado.
4. **Configurações → Usuários → Usuários → Novo.** Usuário exclusivo, sem uso humano.
5. Marque **Permite acesso ao webservice**, vincule o grupo e salve. O token nasce no formato `id:hash`.
6. Se o e-mail ou a senha desse usuário mudar, o token muda junto.

Erros comuns estão em [Erros comuns na API](https://wiki.ixcsoft.com.br/pt-br/API/erros_comuns_API): permissão ausente, recurso indisponível e IP bloqueado.

## Subir localmente

Requer Node.js 22.

```bash
npm ci
npm test
cp .env.example .env
# para um demo sem IXC, deixe IXC_MOCK=true e não defina MCP_KEYS
npm run dev
```

`GET /health` responde `{"status":"ok","mode":"mock"}`. `POST /mcp` é o endpoint MCP.

Produção local, depois do build:

```bash
npm run build
npm start
```

## Docker

A imagem final usa o usuário `node`, não root, e só as dependências de produção.

```bash
cp .env.example .env
docker compose up --build
```

O healthcheck consulta `GET /health` na porta do container.

## Dokploy (Dockerfile, Traefik, HTTPS)

1. No GitHub, o repositório precisa aceitar a chave de deploy. No Dokploy, crie a aplicação a partir do GitHub; o painel mostra a chave pública SSH. Cadastre essa chave no repositório em **Settings → Deploy keys**, só leitura.
2. Crie um **Project** e uma **Application**. Fonte: GitHub, branch `main`.
3. Tipo de build: **Dockerfile**. Caminho: `Dockerfile`. Porta do container: **3000**.
4. Em **Environment**, cole as variáveis. Produção: `IXC_MOCK=false`, `IXC_BASE_URL`, `IXC_TOKEN`, `MCP_KEYS` (ou monte `MCP_KEYS_FILE`), `TRUST_PROXY=true`, `MASK_PII=true`.
5. Em **Domains**, informe o domínio (por exemplo `mcp.seudominio.com.br`), aponte o DNS para o servidor e ative HTTPS. O Dokploy termina o TLS no Traefik e encaminha para a porta 3000. Não é preciso publicar outro proxy.
6. Faça o deploy e confira `https://mcp.seudominio.com.br/health`.
7. Libere o IP de saída desse servidor no grupo do usuário IXC.

O conector é sem sessão: mais de uma réplica funciona, mas o limite de taxa é por processo.

## Conectar o assistente

Cada setor usa a própria chave. No cliente MCP (Cursor, Claude ou outro conector remoto), o transporte é **Streamable HTTP**:

- URL: `https://mcp.seudominio.com.br/mcp`
- Cabeçalho: `Authorization: Bearer <chave daquele perfil>`

O cliente MCP envia `Accept: application/json, text/event-stream` e `Content-Type: application/json`. Sem a chave, a resposta é HTTP 401. Excesso de chamadas devolve HTTP 429 com `Retry-After`.

Exemplo mínimo, só para ver a lista de ferramentas do financeiro:

```bash
curl -sS https://mcp.seudominio.com.br/mcp \
  -H 'Authorization: Bearer <chave-do-financeiro>' \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"curl","version":"1.0.0"}}}'
```

## O que a API do IXC faz, e o que não deu para confirmar

Fontes usadas: formulários em [wikiapiprovedor.ixcsoft.com.br](https://wikiapiprovedor.ixcsoft.com.br/) (`cliente`, `cliente_contrato`, `radusuarios`, `su_oss_chamado`, `su_ticket`, `fn_areceber`, `vd_contratos`, `cidade`, `su_oss_assunto`, `funcionarios`), o guia [API IXC Franquias](https://api-franquias.ixcsoft.com.br/) (atualizado em 02/01/2026, baseado na API do Provedor) e as wikis de token, documentação e erros.

Confirmado nas páginas oficiais:

- Base `https://<host>/webservice/v1/<tabela>`.
- Autenticação Basic do token inteiro `id:hash` (o mesmo que usuário = parte antes dos dois-pontos e senha = parte depois).
- Listagem com header `ixcsoft: listar` e corpo `qtype`, `query`, `oper`, `page`, `rp`, `sortname`, `sortorder`. Filtros extras em `grid_param`, que é um JSON em texto: `[{"TB":"tabela.campo","OP":"=","P":"valor"}]`.
- Operadores publicados: `= != > < >= <= L NL`, e também `IN NI BE NBE`. Este conector só usa os oito primeiros. A documentação de Franquias diz que **não há `OR`**.
- O curl, o Postman e o Python da ficha `cidade` listam com **POST**. O exemplo Node da mesma ficha e o guia de Franquias usam **GET com corpo**. O padrão daqui é POST + JSON, como o curl. `IXC_BODY_FORMAT=form` existe porque o Postman de listagem manda os campos como formulário.
- Status conferidos nas fichas: contrato `P/A/I/N/D`; internet `A/D/CM/CA/FA/AA`; OS `A/AN/EN/AS/AG/DS/EX/F/RAG`; atendimento `su_status` `N/P/EP/S/C`; título `A/R/P/C`.
- Campos usados nas consultas (`cnpj_cpf`, `razao`, `data_ativacao`, `data_cancelamento`, `id_tecnico`, `id_assunto`, `id_cidade`, `data_abertura`, `data_vencimento`, `valor_aberto`, `Ativo` em `vd_contratos`, `funcionario`, `assunto`, `nome` da cidade) aparecem nos exemplos oficiais de inclusão.

Não verificado, porque não havia um IXC real neste repositório:

- O campo `radusuarios.online` **não tem lista de valores** na ficha. O exemplo de inclusão traz o literal `SS`. Integrações públicas tratam `S` como online e `N` como offline. Qualquer outro código volta como “não mapeado”, sem chute.
- O guia de Franquias filtra data em `grid_param` como `DD/MM/AAAA`. Os campos no banco são datas. Este conector envia `AAAA-MM-DD`. Se o seu IXC comparar a data como texto brasileiro, o filtro de período pode voltar vazio e o formato precisa ser ajustado.
- O envelope de sucesso `{page, total, registros}` e o de erro `{type:"error", message}` são os descritos por quem integra e pelos textos de erro da wiki. Não houve uma resposta ao vivo para cravar variações de versão.
- Os nomes dos checkboxes de permissão dentro do grupo de usuários mudam com a versão. O que a API devolve, quando falta permissão, é `Você não tem permissão para acessar o recurso <formulario>`.
- `regiao_manutencao` é filtrado como texto (`L`). A ficha não documenta se o valor é id ou nome.
- Busca de cliente por nome não faz `OR`. Primeiro consulta `razao`; se aquela página vier vazia, consulta `fantasia`.

## Desenvolvimento

```bash
npm test
npm run typecheck
```

Os testes usam Vitest e respostas simuladas. Cobrem perfil e autenticação, a barreira de somente leitura, a máscara, a paginação e o tratamento de erro (4xx sem retry, 5xx com retry, remoção de senha e de link de pagamento).

## Licença de uso

Código deste repositório para o provedor operar os próprios assistentes. O IXC Provedor é produto da IXC Soft; este projeto não é oficial deles.
