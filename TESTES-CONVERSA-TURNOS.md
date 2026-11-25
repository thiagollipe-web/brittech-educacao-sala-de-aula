# Testes — Conversar por turnos (conversa-turnos.html)

Versão barata da conversa na Sala de Aula Online: o aluno fala (ou
escreve), o professor responde por voz neural brasileira, um de cada vez.
Sem ligação em tempo real, sem custo por minuto.

Data dos testes: 25/11/2026. Nada publicado — tudo local.

## O que foi testado

### 1. Sintaxe — `node --check`
- `conversa-turnos.js`, `proxy/server.js`, `proxy/edge-tts.js`,
  `proxy/edge-drm.js` — todos OK.

### 2. Endpoint `POST /api/tts` (proxy local, porta 8791)
Mesma frase para as 4 vozes ("Oi, pessoal! Hoje vamos falar sobre
misturas homogêneas e heterogêneas."):

| Personagem | Voz | HTTP | Tamanho | Latência | Duração do áudio |
|---|---|---|---|---|---|
| professora | pt-BR-FranciscaNeural | 200 | 33.696 B | 1,14 s | 5,62 s |
| pensador | pt-BR-AntonioNeural | 200 | 40.896 B | 0,96 s | 6,82 s |
| anotador | pt-BR-ThalitaMultilingualNeural | 200 | 32.544 B | 0,98 s | 5,42 s |
| curioso | pt-BR-AntonioNeural +35%/+6st | 200 | 31.104 B | 0,89 s | 5,18 s |

- **Validação do MP3**: `ffprobe` confirma MP3 (24 kHz, mono) e
  `ffmpeg -i arquivo -f null -` decodifica **sem nenhum erro** nas 4
  vozes. (Atenção: só o `ffprobe` não basta — ver o bug abaixo.)
- Latência típica por frase: **0,9–2,2 s**. Picos ocasionais na primeira
  chamada depois de reiniciar o proxy (até ~6–7 s, instabilidade
  transitória da Microsoft, já vista antes).
- Casos de erro (testados antes): texto vazio e personagem inválido
  devolvem 400 com mensagem clara em pt-BR; voz fora da lista fechada
  também é rejeitada.

**Bug encontrado e corrigido durante os testes (25/11):** o `edge-tts.js`
cortava 2 bytes a mais de cada pedaço de áudio (`2 + hl + 2` em vez de
`2 + hl`), decapitando o primeiro quadro MP3 de cada pedaço — o sync
`FF FB` sumia e o arquivo começava com `64 c4`. O `ffprobe` ainda
detectava "mp3" e estimava a duração, mas o `ffmpeg` reclamava
"Header missing" em cada pedaço (o áudio tocava no navegador com
pequenas falhas). Corrigido em `proxy/edge-tts.js` (comentário no código
explica o formato) e validado com decode completo limpo nas 4 vozes.
Lição: validar MP3 sempre com decode completo, nunca só com `ffprobe`.

### 3. Página — teste headless (`/tmp/test-turnos.mjs`, Chromium headless-shell + CDP)
Servidor local na porta 8126 + proxy local na 8791, modo `?demo=1`
(respostas locais, sem Maritaca). **24/24 verificações, 0 erros de JS.**
- Entrada: sem tema mostra erro; botão "Exemplo" preenche
  (Misturas homogêneas e heterogêneas); entrar abre a sala.
- Abertura do professor falada com **voz neural** (`audioNeuralOk`).
- 3 trocas por texto simulado (`window.__conversaTurnos.simularFala`):
  transcrição cresce, lousa ganha ponto, custo mostra `≈ R$ 0,00`.
- **Diretor**: após o 3º turno do professor, o Curioso entra (fala local
  em modo demo, voz neural Antonio +35%/+6st).
- **Fallback** (`?sem-tts=1`): a troca completa com a voz do aparelho,
  badge "voz do aparelho" aparece, a aula não trava.
- Encerrar mostra o resumo (duração, trocas, custo, transcrição, lousa).
- `index.html` tem o link novo (`conversa-turnos.html`) e mantém o da
  versão ao vivo (`conversa.html`).

Detalhe do teste: a página ignora falas enquanto está ocupada falando —
o driver espera `ocupada === false` antes de cada `simularFala`.

### 4. O que NÃO foi testado daqui
- **Microfone e reconhecimento de voz real** (`webkitSpeechRecognition`):
  sem microfone e Chrome headless sem internet. O teste usa
  `simularFala` (injeta o texto como se viesse do reconhecimento).
  **O teste real é no celular do Thiago.**
- **Maritaca de verdade**: o proxy local não tem `MARITACA_API_KEY`
  (sem chave aqui, por segurança). Em modo normal, sem a chave, o
  professor responde com a frase local de exemplo e a transcrição avisa
  "sem conexão com a IA". No Render a chave já existe, então lá funciona.
- **Voz neural no celular**: o áudio neural foi validado no desktop
  (MP3 limpo + `Audio` tocando no headless). No celular, conferir se o
  áudio toca sem travar e se o volume está bom.

## Passo a passo para o Thiago testar no celular

1. Abrir a página (depois de publicar — ainda NÃO publicada):
   `conversa-turnos.html` (link "Conversar por turnos — grátis" na
   página inicial da Sala de Aula Online).
2. Tocar em "Usar exemplo" (Misturas) ou preencher tema + conteúdo,
   tocar em "Entrar na conversa".
3. **Permitir o microfone** quando o navegador pedir.
4. Ouvir a abertura do professor (voz neural Francisca).
5. Tocar em "🎙 Falar", falar uma pergunta ("O que é uma mistura
   homogênea?"), tocar de novo para parar — ou escrever no campo e
   tocar em "Enviar".
6. Ouvir a resposta do professor, ver a legenda e a lousa.
7. Falar mais 2 vezes: na 3ª resposta do professor, um colega entra.
8. Tocar em "Parar" (corta a fala), "🔊 Som ligado" (mudo),
   "⛶ Tela cheia" e "Sair" (mostra o resumo com o custo).
9. Para testar o fallback: desligar os dados/Wi-Fi no meio da conversa
   — a fala passa para a voz do aparelho e aparece o aviso
   "voz do aparelho" (a aula não fica muda).

Modos de teste (parâmetros na URL, sem efeito no uso normal):
- `?demo=1` — respostas locais, sem gastar Maritaca.
- `?sem-tts=1` — força a voz do aparelho (testa o fallback).
- `?proxy=URL` — aponta para outro proxy (ex.: o local).

## Custos

- Reconhecimento de voz (no aparelho): **grátis**.
- Voz neural (Edge TTS, Microsoft): **grátis, sem chave**.
- Maritaca sabia-4-thinking: ~R$ 0,13 por ~2.500 tokens (um plano longo).
  Fórmula na tela: tokens ≈ caracteres ÷ 4; R$ = tokens × 0,13/2500.
- Estimativa por aula de **20 trocas**: ~2.500 tokens ≈ **R$ 0,10–0,15**.
  Uma troca típica (pergunta ~100 caracteres + resposta ~350) custa
  ~R$ 0,006. A versão ao vivo (Gemini Live) custaria ~R$ 0,12 a cada
  10 minutos de ligação — por isso esta versão por turnos é a barata.

## Ressalvas

- A primeira chamada de voz depois de reiniciar o proxy pode demorar
  (~6 s); as seguintes ficam em ~1 s. Se a Microsoft demorar mais de
  30 s numa frase, a página cai para a voz do aparelho sozinha.
- O professor responde no máximo ~350 caracteres por turno (limite no
  prompt) — respostas curtas de propósito, para a voz não ficar longa.
- Sem internet, o reconhecimento de voz do Chrome não funciona (ele usa
  o serviço do Google) — aí é preciso escrever no campo. A voz neural
  também precisa de internet (o proxy fala com a Microsoft).
- O colega só entra a cada 3 turnos do professor e no máximo 1 vez por
  minuto, para não interromper a aula.
- Nenhum segredo em arquivo, commit ou relatório (o proxy local rodou
  sem nenhuma chave de API).
