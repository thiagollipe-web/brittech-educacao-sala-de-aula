# Sala de Aula Online — Testes (25/11/2026)

Site estático em `~/workspace/plataforma-professores/sala-de-aula/`:
`index.html`, `style.css`, `sala.js`, `brito-saudacao.svg`. Nada publicado,
nenhum push, nenhuma alteração na Kiwify.

## Como testar localmente

```bash
cd ~/workspace/plataforma-professores/sala-de-aula
python3 -m http.server 8123
# abrir no navegador: http://localhost:8123/index.html
```

Passos manuais:

1. Clicar em **Carregar aula de exemplo** (Misturas homogêneas e
   heterogêneas, Ciências 6º ano — EF06CI01) e depois em **Entrar na aula**.
2. Acompanhar a aula: professor apresenta o slide, Curioso/Anotador/
   Pensador perguntam e reagem, a lousa vai sendo escrita, a legenda mostra
   a fala atual.
3. Quando o professor perguntar a você, a aula pausa: responder por um
   botão de resposta rápida ou pelo campo de texto livre e ver o retorno
   do professor.
4. Levantar a mão no meio da explicação: o professor chama você antes do
   próximo bloco.
5. Fazer o quiz final (3 questões, correção imediata) e ver o resumo com
   a nota.
6. Testar os controles: mudo, câmera simulada, pular fala, tela cheia,
   sair da aula, limpar lousa.

Para forçar o modo demonstração (sem tentar a IA): abrir com
`http://localhost:8123/index.html?demo=1`.

## Testes automatizados (headless, 25/11/2026)

Driver CDP em `/tmp/test-sala.mjs` (Chromium do Playwright, sem
dependências): entra na aula com o exemplo, levanta a mão, responde às
2 perguntas ao aluno (opção certa), responde às 3 questões do quiz,
verifica falantes, fases, lousa, overflow e erros de JS. Tempo acelerado
(`__sala.setFatorTempo(0.05)`).

| Cenário | Resultado |
|---|---|
| 1280 px, sem voz (`forcarSemVoz`) | **PASS** — resumo visível, 2/2 respostas ao aluno, 3/3 quiz, 6 linhas na lousa, 4 falantes, mão levantada atendida, 0 erros de JS, sem overflow |
| 390 px, sem voz | **PASS** — idem, sem overflow na aula nem na entrada |
| 1280 px, com voz (headless, sem vozes pt-BR) | **PASS** — aula completa pelo caminho do timeout de segurança; aviso "Nenhuma voz em português encontrada" exibido; 0 erros de JS |

Verificado nos 3 cenários: professor pergunta ao aluno e a resposta
recebe retorno; colegas interagem (Curioso, Anotador e Pensador falaram);
lousa recebe anotações (pontos-chave do professor em branco + resumos do
Anotador em ciano); sem `speechSynthesis` nada quebra; layout sem
overflow em 390 px e 1280 px; 0 erros de JS.

Correção feita durante os testes: a lousa cortava a última linha quando
acumulava muitas anotações — agora apaga as mais antigas quando o quadro
enche (o resumo final lista todos os pontos-chave).

## Pendente

- **Teste com IA real**: neste ambiente o proxy
  `https://brittech-proxy.onrender.com` não respondeu (curl: conexão
  falhou), então todos os testes acima rodaram em **modo demonstração**.
  Validar no navegador do Thiago, com internet: entrar na aula com o
  exemplo e confirmar o selo "IA real" no topo e que o diálogo/quiz vêm
  da Maritaca (sabia-4-thinking) — e que, com o proxy fora, cai para o
  modo demonstração com o aviso visível.
- **Teste de voz real**: validar no celular/computador do Thiago que as
  vozes pt-BR soam distintas por personagem e que o mudo funciona.
- **Teste de tela cheia**: o botão usa `requestFullscreen` de verdade,
  mas só foi exercitado via código — confirmar o comportamento no
  navegador real (o headless não valida a troca visual de fullscreen).
