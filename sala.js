// Sala de Aula Online — Brittech Educação
// Aula online de verdade, estilo videochamada (inspirada no conceito do
// OpenMAIC, MIT — só o conceito; o código e os textos são nossos): o
// professor apresenta o slide no centro, os colegas Curioso, Anotador e
// Pensador perguntam e reagem, a lousa vai sendo escrita ao vivo e o aluno
// responde quando o professor pergunta — a aula pausa e espera.
// Sem dependências externas. Voz: Web Speech API (grátis, pt-BR).
// IA real: proxy da Brittech (Render), mesmo formato do MVP (app.js):
//   POST {proxy}/api/chat  { provider: 'maritaca',
//     messages: [{role:'system',...},{role:'user',...}],
//     temperature: 0.7, max_tokens: 3000 }  →  { text: '...' }
// Sem IA (proxy fora ou erro), cai para o modelo local de demonstração,
// montado SÓ com o tema e o texto colado — nada é inventado fora deles.

'use strict';

var PROXY_URL = 'https://brittech-proxy.onrender.com';
var PROVEDOR = 'maritaca';
var MODELO = 'sabia-4-thinking';
var TEMPO_MAX_IA_MS = 75000; // Render gratuito pode demorar a "acordar"

var PERSONAGENS = {
  professor: { nome: 'Professor', cor: '#0284C7', voz: { pitch: 1.0, rate: 0.92 } },
  curioso:   { nome: 'Curioso',   cor: '#ec4899', voz: { pitch: 1.15, rate: 1.0 } },
  anotador:  { nome: 'Anotador',  cor: '#06b6d4', voz: { pitch: 1.05, rate: 0.98 } },
  pensador:  { nome: 'Pensador',  cor: '#f59e0b', voz: { pitch: 0.95, rate: 0.92 } },
  voce:      { nome: 'Você',      cor: '#84CC16', voz: { pitch: 1.05, rate: 1.0 } },
};

// Exemplo da biblioteca gratuita: "Misturas homogêneas e heterogêneas no
// dia a dia" (Ciências, 6º ano, EF06CI01 — água e sal, água e óleo, água e
// areia). Texto de estudo baseado no tema dessa aula.
var EXEMPLO_TEMA = 'Misturas homogêneas e heterogêneas';
var EXEMPLO_TEXTO = 'Uma mistura é a junção de dois ou mais materiais. Quando não conseguimos distinguir os componentes da mistura, como na água com sal dissolvido, a mistura é homogênea. Quando conseguimos ver os componentes separados, como na água com óleo ou na água com areia, a mistura é heterogênea. No dia a dia encontramos misturas em muitos lugares: o suco, o ar que respiramos e a salada são exemplos de misturas. Para classificar uma mistura, observamos se dá para ver os componentes separados ou se eles formam uma coisa só.';

function $(id) { return document.getElementById(id); }
function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function aleatorio(min, max) { return min + Math.random() * (max - min); }
function escolher(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function hojeBR() {
  var d = new Date();
  return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
}
function semAcento(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// Reações curtas e coloquiais — o professor e os colegas reagem uns aos
// outros, para a aula não soar mecanizada.
var REACAO_PROFESSOR_PERGUNTA = [
  'Boa pergunta!', 'Ótima pergunta!', 'Hmm, deixa eu pensar um pouquinho…',
  'Adorei essa dúvida!', 'Boa, essa é uma dúvida clássica!',
];
var REACAO_PROFESSOR_RESPOSTA_CERTA = [
  'Isso mesmo, muito bem!', 'Exatamente isso!', 'Perfeito, é isso aí!',
  'Boa! Você pegou o ponto principal.',
];
var REACAO_PROFESSOR_RESPOSTA_ERRADA = [
  'Boa tentativa! Vamos pensar juntos…', 'Hmm, quase lá — olha só…',
  'Valeu por tentar! Deixa eu te dar uma dica…',
];
var REACAO_COLEGA_APOIO = [
  { quem: 'anotador', texto: 'Boa, eu também queria saber isso!' },
  { quem: 'pensador', texto: 'Nossa, verdade! Nunca tinha pensado nisso.' },
  { quem: 'curioso', texto: 'Também fiquei com essa dúvida!' },
  { quem: 'anotador', texto: 'Já anotei essa parte aqui.' },
];

// ---------------------------------------------------------------- Voz
var fatorTempoTeste = 1; // gancho de teste: multiplica pausas e durações
var forcarSemVozTeste = false;
var vozesCache = null;

function temSinteseVoz() {
  if (forcarSemVozTeste) return false;
  return typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
}
function listarVozes() {
  if (!temSinteseVoz()) return [];
  try { return window.speechSynthesis.getVoices() || []; } catch (e) { return []; }
}
function vozesPTBR() {
  if (vozesCache && vozesCache.length) return vozesCache;
  var todas = listarVozes();
  var pt = todas.filter(function (v) { return (v.lang || '').toLowerCase().indexOf('pt') === 0; });
  vozesCache = pt.length ? pt : todas;
  return vozesCache;
}
function vozPara(personagem) {
  var lista = vozesPTBR();
  if (!lista.length) return null;
  var ordem = ['professor', 'curioso', 'anotador', 'pensador'];
  var base = ordem.indexOf(personagem);
  if (base < 0) base = 0;
  // Prefere vozes naturais/neural (ex.: "Google português do Brasil",
  // "Microsoft Maria Online (Natural)") — são as que soam menos robóticas.
  // Se não houver, cai para as brasileiras conhecidas.
  var naturais = lista.filter(function (v) { return /natural|neural/i.test(v.name || ''); });
  var conhecidas = lista.filter(function (v) { return /google.*português|maria|luciana|daniel/i.test(v.name || ''); });
  var pool = naturais.length ? naturais : (conhecidas.length ? conhecidas : lista);
  // Distribui vozes diferentes por personagem quando houver mais de uma.
  return pool[base % pool.length];
}
// Divide a fala em frases e fala uma de cada vez, com uma pausa curta
// entre elas — é o que mais aproxima a voz de uma fala natural (uma frase
// longa de uma vez soa mecanizada).
function dividirEmFrases(texto) {
  var partes = String(texto || '').match(/[^.!?…;]+[.!?…;]+["”)]?\s*|[^.!?…;]+$/g) || [];
  return partes.map(function (p) { return p.trim(); }).filter(function (p) { return p; });
}
function falarEmPartes(texto, quem, aoTerminar) {
  var partes = dividirEmFrases(texto);
  if (!partes.length) { aoTerminar(); return; }
  var p = PERSONAGENS[quem] || PERSONAGENS.professor;
  var voz = vozPara(quem);
  var i = 0;
  var falarProxima = function () {
    if (!estado || !estado.rodando) { aoTerminar(); return; }
    if (i >= partes.length) { aoTerminar(); return; }
    var u = new SpeechSynthesisUtterance(partes[i]);
    i++;
    u.lang = 'pt-BR';
    u.pitch = (p.voz && p.voz.pitch) || 1;
    u.rate = (p.voz && p.voz.rate) || 1;
    if (voz) u.voice = voz;
    u.onend = function () {
      // Pausa de respiração entre frases (maior depois de ponto final).
      var pausa = /[.!?…]\s*$/.test(partes[i - 1]) ? 550 : 350;
      estado.timerFala = setTimeout(falarProxima, pausa);
    };
    u.onerror = function () { estado.timerFala = setTimeout(falarProxima, 200); };
    try { window.speechSynthesis.speak(u); }
    catch (e) { estado.timerFala = setTimeout(falarProxima, 200); }
  };
  falarProxima();
}
function duracaoEstimadaMs(texto) {
  var palavras = String(texto || '').split(/\s+/).filter(function (s) { return s; }).length;
  return Math.max(2500, palavras * 450 + 1200);
}
if (typeof window !== 'undefined' && 'speechSynthesis' in window && window.speechSynthesis && window.speechSynthesis.addEventListener) {
  window.speechSynthesis.addEventListener('voiceschanged', function () { vozesCache = null; atualizarAvisoVoz(); });
}

// ---------------------------------------------------------------- Lousa (canvas, quadro de giz)
var lousaLinhas = []; // { texto, cor, escrito }
function quebrarTextoLousa(ctx, texto, larguraMax) {
  var palavras = String(texto).split(/\s+/).filter(function (s) { return s; });
  var linhas = [], atual = '';
  palavras.forEach(function (pal) {
    var teste = atual ? atual + ' ' + pal : pal;
    if (ctx.measureText(teste).width > larguraMax && atual) { linhas.push(atual); atual = pal; }
    else atual = teste;
  });
  if (atual) linhas.push(atual);
  return linhas.length ? linhas : [''];
}
function desenharLousa() {
  var c = $('lousa');
  if (!c) return;
  var ctx = c.getContext('2d');
  ctx.fillStyle = '#14532d';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  for (var y = 44; y < c.height; y += 44) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(c.width, y); ctx.stroke(); }
  ctx.font = '32px "Comic Sans MS", "Segoe Print", cursive';
  ctx.textBaseline = 'top';
  var yy = 20;
  lousaLinhas.forEach(function (linha) {
    ctx.fillStyle = linha.cor;
    var partes = quebrarTextoLousa(ctx, linha.texto.slice(0, linha.escrito), c.width - 40);
    partes.forEach(function (p) {
      if (yy > c.height - 44) return;
      ctx.fillText(p, 20, yy);
      yy += 44;
    });
  });
}
function finalizarEscritaLousa() {
  if (estado && estado.timerEscrita) { clearTimeout(estado.timerEscrita); estado.timerEscrita = null; }
  lousaLinhas.forEach(function (l) { l.escrito = l.texto.length; });
  desenharLousa();
}
function limparLousa() {
  if (estado && estado.timerEscrita) { clearTimeout(estado.timerEscrita); estado.timerEscrita = null; }
  lousaLinhas = [];
  desenharLousa();
}
function escreverNaLousa(texto, cor, duracaoMs) {
  if (!estado) return;
  if (estado.timerEscrita) { clearTimeout(estado.timerEscrita); estado.timerEscrita = null; }
  lousaLinhas.forEach(function (l) { l.escrito = l.texto.length; });
  var linha = { texto: String(texto || ''), cor: cor || '#ffffff', escrito: 0 };
  lousaLinhas.push(linha);
  // Quadro cheio: apaga as anotações mais antigas para a nova caber
  // (como um professor apagando a lousa); o resumo final lista todos os
  // pontos-chave, então nada se perde.
  var c = $('lousa');
  if (c) {
    var ctx = c.getContext('2d');
    ctx.font = '32px "Comic Sans MS", "Segoe Print", cursive';
    var altura = function () {
      var total = 0;
      lousaLinhas.forEach(function (l) { total += quebrarTextoLousa(ctx, l.texto, c.width - 40).length * 44; });
      return total;
    };
    while (lousaLinhas.length > 1 && altura() > c.height - 20) lousaLinhas.shift();
  }
  desenharLousa();
  var total = linha.texto.length;
  if (!total) return;
  var intervalo = Math.max(25, Math.round(((duracaoMs || 3000) * fatorTempoTeste) / total));
  var passo = function () {
    if (!estado || !estado.rodando) { if (estado) estado.timerEscrita = null; return; }
    linha.escrito++;
    desenharLousa();
    if (linha.escrito < total) estado.timerEscrita = setTimeout(passo, intervalo);
    else estado.timerEscrita = null;
  };
  estado.timerEscrita = setTimeout(passo, intervalo);
}

// ---------------------------------------------------------------- Geração da aula (IA ou demonstração)
var PROMPT_SISTEMA_AULA = 'Você é um professor brasileiro que explica para alunos da educação básica, numa aula online ao vivo. Use linguagem simples, direta e coloquial, com exemplos do dia a dia. Responda sempre em português.';
function promptAula(tema, texto) {
  var prompt = 'Monte uma aula online completa sobre o tema abaixo, como uma videochamada com professor e colegas.\n\nTema: ' + tema + '\n';
  if (texto) prompt += 'Conteúdo da aula/apostila do aluno:\n---\n' + texto.slice(0, 6000) + '\n---\n';
  prompt += 'Devolva SOMENTE um objeto JSON válido, sem markdown e sem ```, exatamente com esta estrutura:\n' +
    '{\n' +
    '  "abertura": "fala de abertura do professor, cumprimentando a turma e apresentando o tema em 2 frases curtas",\n' +
    '  "blocos": [{"titulo": "título curto do bloco", "texto": "explicação do professor em 2 a 4 frases curtas", "chave": "ponto-chave em poucas palavras", "resumo": "resumo do bloco em 1 frase", "slide": ["linha 1 do slide", "linha 2", "linha 3"]}],\n' +
    '  "duvidas": [{"quem": "curioso", "pergunta": "pergunta curta do colega", "resposta": "resposta curta do professor"}],\n' +
    '  "perguntasAluno": [{"pergunta": "pergunta ao aluno", "opcoes": ["opção A", "opção B", "opção C"], "certa": 0, "dica": "dica curta com a ideia certa"}],\n' +
    '  "quiz": [{"pergunta": "pergunta", "alternativas": ["A", "B", "C", "D"], "correta": 0, "explicacao": "por que essa é a certa, em uma frase"}],\n' +
    '  "encerramento": "fala final do professor com o resumo da aula em 2 a 3 frases"\n' +
    '}\n\n' +
    'Regras:\n' +
    '- blocos: 3 ou 4, na ordem lógica do tema; "slide" tem 2 a 4 linhas curtas com o conteúdo do bloco.\n' +
    '- duvidas: 2 dúvidas de colegas ("quem" só pode ser curioso, anotador ou pensador), sempre ligadas ao que o professor acabou de explicar.\n' +
    '- perguntasAluno: 2 perguntas ao aluno, com 3 opções cada; "certa" é o índice (0 a 2) da opção certa.\n' +
    '- quiz: exatamente 3 questões de múltipla escolha, 4 alternativas cada, só uma certa; "correta" é o índice (0 a 3). Varie a posição da resposta certa.\n' +
    '- Use SÓ o conteúdo informado (e o tema, se não houver conteúdo). Não invente fatos, nomes, datas ou números que não estejam no conteúdo informado.\n' +
    '- Falas curtas e coloquiais, como numa aula de verdade.';
  return prompt;
}
function extrairJSONAula(texto) {
  var ini = texto.indexOf('{'), fim = texto.lastIndexOf('}');
  if (ini < 0 || fim <= ini) throw new Error('A IA não devolveu um JSON válido.');
  var obj = JSON.parse(texto.slice(ini, fim + 1));
  if (typeof obj.abertura !== 'string' || !obj.abertura.trim()) throw new Error('JSON da IA sem abertura.');
  if (!Array.isArray(obj.blocos) || obj.blocos.length < 2) throw new Error('JSON da IA sem blocos de explicação.');
  obj.blocos.forEach(function (b, i) {
    if (typeof b.titulo !== 'string' || !b.titulo.trim()) throw new Error('Bloco ' + (i + 1) + ' sem título.');
    if (typeof b.texto !== 'string' || !b.texto.trim()) throw new Error('Bloco ' + (i + 1) + ' sem texto.');
    b.titulo = b.titulo.trim().slice(0, 120);
    b.texto = b.texto.trim().slice(0, 600);
    b.chave = typeof b.chave === 'string' ? b.chave.trim().slice(0, 120) : b.titulo;
    b.resumo = typeof b.resumo === 'string' ? b.resumo.trim().slice(0, 200) : b.texto.split(/(?<=[.!?])\s+/)[0];
    if (!Array.isArray(b.slide) || !b.slide.length) b.slide = [b.texto.split(/(?<=[.!?])\s+/)[0]];
    b.slide = b.slide.slice(0, 4).map(function (l) { return String(l).slice(0, 140); });
  });
  if (!Array.isArray(obj.duvidas)) obj.duvidas = [];
  obj.duvidas = obj.duvidas.filter(function (d) {
    return d && ['curioso', 'anotador', 'pensador'].indexOf(d.quem) >= 0 && typeof d.pergunta === 'string' && d.pergunta.trim() && typeof d.resposta === 'string' && d.resposta.trim();
  }).slice(0, 3);
  if (!Array.isArray(obj.perguntasAluno)) obj.perguntasAluno = [];
  obj.perguntasAluno = obj.perguntasAluno.filter(function (p) {
    return p && typeof p.pergunta === 'string' && p.pergunta.trim() && Array.isArray(p.opcoes) && p.opcoes.length >= 2 && typeof p.certa === 'number' && p.certa >= 0 && p.certa < p.opcoes.length;
  }).slice(0, 2);
  if (!Array.isArray(obj.quiz) || obj.quiz.length < 3) throw new Error('JSON da IA sem quiz de 3 questões.');
  obj.quiz = obj.quiz.slice(0, 3);
  obj.quiz.forEach(function (q, i) {
    if (!Array.isArray(q.alternativas) || q.alternativas.length !== 4) throw new Error('Questão ' + (i + 1) + ' do quiz sem 4 alternativas.');
    if (typeof q.correta !== 'number' || q.correta < 0 || q.correta > 3) throw new Error('Questão ' + (i + 1) + ' do quiz sem resposta certa válida.');
  });
  if (typeof obj.encerramento !== 'string' || !obj.encerramento.trim()) throw new Error('JSON da IA sem encerramento.');
  return obj;
}
async function chamarIAProxy(prompt, sistema) {
  var controle = new AbortController();
  var timer = setTimeout(function () { controle.abort(); }, TEMPO_MAX_IA_MS);
  try {
    var resp = await fetch(PROXY_URL + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: PROVEDOR,
        messages: [
          { role: 'system', content: sistema || PROMPT_SISTEMA_AULA },
          { role: 'user', content: prompt },
        ],
        temperature: 0.7,
        max_tokens: 3000,
      }),
      signal: controle.signal,
    });
    var json = null;
    try { json = await resp.json(); } catch (e) { /* resposta sem JSON */ }
    if (!resp.ok) throw new Error('Proxy respondeu HTTP ' + resp.status + (json && json.erro ? ' — ' + json.erro : ''));
    if (!json || !json.text) throw new Error('O proxy devolveu uma resposta vazia.');
    return json.text;
  } finally { clearTimeout(timer); }
}

// ---------------------------------------------------------------- Modelo local (demonstração)
function frasesDe(texto) {
  return String(texto || '').replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/).map(function (s) { return s.trim(); }).filter(function (s) { return s.length > 3; });
}
function primeiraFrase(texto) {
  var f = frasesDe(texto);
  return f.length ? f[0] : texto;
}
function embaralharComIndice(arr) {
  var ordem = arr.map(function (_, i) { return i; });
  for (var i = ordem.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var t = ordem[i]; ordem[i] = ordem[j]; ordem[j] = t;
  }
  return ordem;
}
function montarAulaDemo(tema, texto) {
  var frases = frasesDe(texto);
  var blocos = [];
  if (frases.length) {
    for (var i = 0; i < frases.length && blocos.length < 4; i += 2) {
      var grupo = frases.slice(i, i + 2);
      var palavras = grupo[0].replace(/[.!?]$/, '').split(' ');
      var titulo = palavras.slice(0, 5).join(' ') + (palavras.length > 5 ? '…' : '');
      blocos.push({
        titulo: titulo.charAt(0).toUpperCase() + titulo.slice(1),
        texto: grupo.join(' '),
        chave: titulo.charAt(0).toUpperCase() + titulo.slice(1),
        resumo: primeiraFrase(grupo.join(' ')),
        slide: grupo.map(function (s) { return s.length > 140 ? s.slice(0, 137) + '…' : s; }),
      });
    }
  }
  if (!blocos.length) {
    blocos = [
      { titulo: 'O que é ' + tema, texto: 'Comece pelo básico: o que significa ' + tema + ' e onde esse assunto aparece no seu dia a dia.', chave: 'O que é ' + tema, resumo: 'O básico de ' + tema + ' e onde ele aparece no dia a dia.', slide: ['O que significa ' + tema, 'Onde esse assunto aparece no dia a dia'] },
      { titulo: 'Por que isso importa', texto: 'Entender ' + tema + ' ajuda a resolver as questões da prova e a explicar o assunto com suas próprias palavras.', chave: 'Por que isso importa', resumo: 'Entender ' + tema + ' ajuda na prova e na explicação.', slide: ['Ajuda a resolver as questões da prova', 'Ajuda a explicar com suas próprias palavras'] },
      { titulo: 'Exemplos do dia a dia', texto: 'Procure 3 exemplos de ' + tema + ' na sua casa, na rua ou na escola e anote o que eles têm em comum.', chave: 'Exemplos do dia a dia', resumo: 'Procure 3 exemplos de ' + tema + ' ao seu redor.', slide: ['Exemplos em casa, na rua e na escola', 'O que eles têm em comum?'] },
    ];
  }
  var duvidas = [];
  if (blocos.length > 1) {
    duvidas.push({ quem: 'curioso', pergunta: 'Mas por que isso acontece?', resposta: blocos[1].texto });
  }
  if (blocos.length > 2) {
    duvidas.push({ quem: 'pensador', pergunta: 'E isso aparece no nosso dia a dia? Onde?', resposta: blocos[2].texto });
  }
  var perguntasAluno = [];
  [1, 2].forEach(function (bi) {
    if (bi >= blocos.length) return;
    var b = blocos[bi];
    var certa = primeiraFrase(b.texto);
    var outro = blocos[(bi + 1) % blocos.length];
    var distrator = outro ? primeiraFrase(outro.texto) : 'O material não fala sobre isso.';
    if (distrator === certa) distrator = 'O material não fala sobre isso.';
    var opcoes = [certa, distrator, 'O material não fala sobre isso.'];
    var ordem = embaralharComIndice(opcoes);
    perguntasAluno.push({
      pergunta: 'O que a gente aprendeu sobre "' + b.titulo + '"?',
      opcoes: ordem.map(function (j) { return opcoes[j]; }),
      certa: ordem.indexOf(0),
      dica: certa,
    });
  });
  var quiz = [];
  for (var i = 0; i < blocos.length && quiz.length < 3; i++) {
    var p = blocos[i];
    var certaQ = primeiraFrase(p.texto);
    var outroQ = blocos.length > 1 ? blocos[(i + 1) % blocos.length] : null;
    var distrQ = outroQ ? primeiraFrase(outroQ.texto) : 'Isso é o contrário do que o material diz.';
    if (distrQ === certaQ) distrQ = 'Isso é o contrário do que o material diz.';
    var alts = [certaQ, 'O material não fala sobre isso.', distrQ, 'Nenhuma das alternativas anteriores.'];
    var ordemQ = embaralharComIndice(alts);
    quiz.push({
      pergunta: 'O que o material diz sobre "' + p.titulo + '"?',
      alternativas: ordemQ.map(function (j) { return alts[j]; }),
      correta: ordemQ.indexOf(0),
      explicacao: 'A resposta certa é a frase do próprio material sobre esse ponto.',
    });
  }
  var titulos = blocos.map(function (b) { return b.titulo; }).join('; ');
  return {
    abertura: 'Oi, pessoal! Tudo bem com vocês? Hoje a gente vai falar sobre ' + tema + '. Peguem o caderno, que a aula já vai começar!',
    blocos: blocos,
    duvidas: duvidas,
    perguntasAluno: perguntasAluno,
    quiz: quiz,
    encerramento: 'Então, resumindo o que a gente viu hoje: ' + titulos + '. Se ficou alguma dúvida, pode levantar a mão na próxima aula. Bom estudo, pessoal!',
  };
}

// ---------------------------------------------------------------- Montagem do roteiro
// O roteiro é uma lista de passos com ritmo variado: abertura → blocos de
// slide com dúvidas dos colegas entre eles → perguntas ao aluno (a aula
// pausa e espera) → quiz → encerramento. Reações curtas entre as falas
// deixam a conversa natural, sem tempo fixo entre uma fala e outra.
function montarRoteiro(aula) {
  var passos = [];
  passos.push({ tipo: 'slide', fase: 'Abertura', titulo: aula.tema, linhas: ['Uma aula da Brittech Educação', 'Professor, Curioso, Anotador e Pensador'] });
  passos.push({ tipo: 'fala', fase: 'Abertura', quem: 'professor', texto: aula.abertura });
  aula.blocos.forEach(function (b, i) {
    passos.push({ tipo: 'slide', fase: 'Explicação — bloco ' + (i + 1) + ' de ' + aula.blocos.length, titulo: b.titulo, linhas: b.slide });
    passos.push({ tipo: 'fala', fase: 'Explicação — bloco ' + (i + 1) + ' de ' + aula.blocos.length, quem: 'professor', texto: b.texto, chave: b.chave });
    // O Anotador resume o bloco na lousa, em ciano.
    passos.push({ tipo: 'fala', fase: 'Explicação — bloco ' + (i + 1) + ' de ' + aula.blocos.length, quem: 'anotador', texto: 'Resumindo: ' + b.resumo, lousa: b.resumo, corLousa: '#67e8f9' });
    // Dúvidas dos colegas, intercaladas com a explicação.
    var duvida = aula.duvidas[i] || aula.duvidas[aula.duvidas.length - 1];
    if (duvida && i < aula.duvidas.length) {
      passos.push({ tipo: 'fala', fase: 'Dúvidas dos colegas', quem: duvida.quem, texto: duvida.pergunta });
      passos.push({ tipo: 'fala', fase: 'Dúvidas dos colegas', quem: 'professor', texto: escolher(REACAO_PROFESSOR_PERGUNTA) });
      passos.push({ tipo: 'fala', fase: 'Dúvidas dos colegas', quem: 'professor', texto: duvida.resposta });
      var apoio = escolher(REACAO_COLEGA_APOIO);
      if (apoio.quem !== duvida.quem) passos.push({ tipo: 'fala', fase: 'Dúvidas dos colegas', quem: apoio.quem, texto: apoio.texto });
    }
    // Perguntas ao aluno, depois dos blocos 2 e 3 (índices 1 e 2).
    if (i === 1 && aula.perguntasAluno[0]) passos.push({ tipo: 'pergunta-aluno', fase: 'Sua vez de responder', pergunta: aula.perguntasAluno[0] });
    if (i === 2 && aula.perguntasAluno[1]) passos.push({ tipo: 'pergunta-aluno', fase: 'Sua vez de responder', pergunta: aula.perguntasAluno[1] });
  });
  // Se a aula tiver só 1 pergunta ao aluno e nenhum bloco 2/3, pergunta no fim da explicação.
  if (!passos.some(function (p) { return p.tipo === 'pergunta-aluno'; }) && aula.perguntasAluno[0]) {
    passos.push({ tipo: 'pergunta-aluno', fase: 'Sua vez de responder', pergunta: aula.perguntasAluno[0] });
  }
  passos.push({ tipo: 'quiz', fase: 'Quiz final' });
  var chaves = aula.blocos.map(function (b) { return b.chave; });
  passos.push({ tipo: 'slide', fase: 'Encerramento', titulo: 'Resumo da aula', linhas: chaves.slice(0, 4) });
  passos.push({ tipo: 'fala', fase: 'Encerramento', quem: 'professor', texto: aula.encerramento });
  passos.push({ tipo: 'resumo', fase: 'Aula concluída' });
  return passos;
}

// ---------------------------------------------------------------- Estado e motor da aula
var aulaAtual = null; // { tema, texto, nome, fonte, dados, roteiro }
var estado = null;    // { rodando, indice, total, mudo, cameraLigada, maoLevantada, timerFala, timerEscrita, esperaResolver, falaAtual, quizIndice, acertos, ultimoBloco }
var gerandoAula = false;

function mostrarTela(idMostrar, idEsconder) {
  $(idMostrar).hidden = false;
  $(idEsconder).hidden = true;
}
function setFase(fase, indice, total) {
  $('aula-fase').textContent = fase;
  $('aula-progresso').textContent = (typeof indice === 'number' && total)
    ? 'Passo ' + (indice + 1) + ' de ' + total : '';
}
function mostrarSlide(titulo, linhas) {
  $('slide-titulo').textContent = titulo;
  $('slide-linhas').innerHTML = (linhas || []).map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('');
}
function destacarQuemFala(quem) {
  document.querySelectorAll('.participante').forEach(function (tile) {
    var q = tile.getAttribute('data-quem');
    var falando = q === quem;
    tile.classList.toggle('falando', falando);
    tile.classList.toggle('em-espera', !falando);
    var selo = tile.querySelector('.selo-falando');
    if (selo) selo.hidden = !falando;
    var st = tile.querySelector('[data-status]');
    if (st) st.textContent = falando ? 'falando…' : 'ouvindo';
  });
}
function mostrarLegenda(quem, texto) {
  var p = PERSONAGENS[quem] || PERSONAGENS.professor;
  $('legenda').innerHTML = '<span class="quem">' + esc(p.nome) + ':</span> ' + esc(texto);
}
function atualizarAvisoVoz() {
  var aviso = $('aviso-voz');
  if (!aviso) return;
  if (!temSinteseVoz()) {
    aviso.hidden = false;
    aviso.textContent = 'Seu navegador não tem voz — a aula segue só com texto, legenda e lousa.';
    return;
  }
  var pt = listarVozes().filter(function (v) { return (v.lang || '').toLowerCase().indexOf('pt') === 0; });
  if (!pt.length) {
    aviso.hidden = false;
    aviso.textContent = 'Nenhuma voz em português encontrada neste navegador — usando a voz padrão.';
  } else aviso.hidden = true;
}
function cancelarFalaAtual() {
  if (temSinteseVoz()) { try { window.speechSynthesis.cancel(); } catch (e) {} }
  if (estado) {
    if (estado.timerFala) { clearTimeout(estado.timerFala); estado.timerFala = null; }
    if (estado.timerEscrita) { clearTimeout(estado.timerEscrita); estado.timerEscrita = null; }
  }
}
// Uma fala: destaca quem fala, mostra a legenda, escreve na lousa (se for
// ponto-chave) e fala com a voz do personagem. A fala só é considerada
// "dita" quando o áudio termina (onend) ou após o tempo estimado, se o
// áudio falhar — com segurança de timeout, a aula nunca trava.
function falar(quem, texto, opts) {
  opts = opts || {};
  return new Promise(function (resolver) {
    if (!estado || !estado.rodando) { resolver(); return; }
    destacarQuemFala(quem);
    mostrarLegenda(quem, texto);
    var duracao = duracaoEstimadaMs(texto);
    if (opts.chave) escreverNaLousa(opts.chave, '#ffffff', duracao);
    else if (opts.lousa) escreverNaLousa(opts.lousa, opts.corLousa || '#67e8f9', duracao);
    var resolvido = false;
    var avancar = function () {
      if (resolvido) return;
      resolvido = true;
      if (estado && estado.timerFala) { clearTimeout(estado.timerFala); estado.timerFala = null; }
      finalizarEscritaLousa();
      resolver();
    };
    estado.falaAtual = { avancar: avancar };
    if (estado.mudo || !temSinteseVoz()) {
      estado.timerFala = setTimeout(avancar, duracao * fatorTempoTeste);
      return;
    }
    try {
      falarEmPartes(texto, quem, avancar);
      estado.timerFala = setTimeout(avancar, (duracao + 12000) * fatorTempoTeste);
    } catch (e) {
      estado.timerFala = setTimeout(avancar, duracao * fatorTempoTeste);
    }
  });
}
function pularFala() {
  if (estado && estado.falaAtual && estado.falaAtual.avancar) {
    cancelarFalaAtual();
    estado.falaAtual.avancar();
  }
}

// ---------------------------------------------------------------- Interação com o aluno
function palavrasChave(texto) {
  var stop = ['para', 'como', 'quando', 'onde', 'isso', 'essa', 'esse', 'esta', 'este', 'sobre', 'entre', 'muito', 'pouco', 'cada', 'qual', 'quais', 'entao', 'tambem', 'porque', 'pois', 'mas', 'com', 'sem', 'uma', 'uns', 'umas', 'dos', 'das', 'nos', 'nas', 'pelo', 'pela', 'pelos', 'pelas', 'sao', 'ser', 'ter', 'vai', 'vem', 'nao', 'sim', 'mais', 'menos', 'muita', 'muito'];
  return semAcento(texto).replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(function (w) { return w.length >= 4 && stop.indexOf(w) < 0; });
}
function retornoPorPalavrasChave(resposta, certaTexto, dica) {
  var resp = semAcento(resposta || '');
  var chaves = palavrasChave(certaTexto || dica || '');
  var acertos = chaves.filter(function (c) { return resp.indexOf(c) >= 0; });
  if (acertos.length > 0) return { ok: true, texto: escolher(REACAO_PROFESSOR_RESPOSTA_CERTA) + ' ' + (dica || certaTexto || '') };
  return { ok: false, texto: escolher(REACAO_PROFESSOR_RESPOSTA_ERRADA) + ' ' + (dica || 'Pensa no que a gente acabou de ver no slide.') };
}
async function retornoDaIA(pergunta, resposta, contexto) {
  try {
    var texto = await chamarIAProxy(
      'Você é um professor brasileiro numa aula online ao vivo. O aluno respondeu a uma pergunta da aula.\n\nPergunta: ' + pergunta + '\nResposta do aluno: ' + resposta + '\nConteúdo da aula: ' + (contexto || '') + '\n\nResponda em 1 ou 2 frases curtas, em português, com tom de professor: se a resposta estiver certa ou no caminho certo, elogie e confirme a ideia; se estiver errada ou incompleta, dê uma dica gentil com a ideia certa, sem inventar nada fora do conteúdo da aula. Não dê nota.',
      'Você é um professor brasileiro que responde a alunos da educação básica. Responda sempre em português, em 1 ou 2 frases curtas.'
    );
    var limpo = String(texto || '').trim().replace(/^["“]|["”]$/g, '').slice(0, 400);
    if (!limpo) throw new Error('Resposta vazia.');
    return { ok: true, texto: limpo };
  } catch (e) {
    return null; // quem chama cai para o retorno por palavras-chave
  }
}
function mostrarPainelAluno(pergunta) {
  var painel = $('painel-aluno');
  $('aluno-pergunta').textContent = 'O professor perguntou: ' + pergunta.pergunta;
  $('aluno-opcoes').innerHTML = '';
  (pergunta.opcoes || []).forEach(function (op, i) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn-opcao';
    b.textContent = op;
    b.addEventListener('click', function () { responderAlunoOpcao(i); });
    $('aluno-opcoes').appendChild(b);
  });
  $('aluno-resposta-livre').value = '';
  $('aluno-resposta-livre').disabled = false;
  $('btn-responder-livre').disabled = false;
  $('aluno-retorno').hidden = true;
  $('aluno-retorno').textContent = '';
  painel.hidden = false;
  painel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function esconderPainelAluno() { $('painel-aluno').hidden = true; }
function resolverEspera(valor) {
  if (estado && estado.esperaResolver) {
    var r = estado.esperaResolver;
    estado.esperaResolver = null;
    r(valor);
  }
}
function responderAlunoOpcao(i) {
  if (!estado || !estado.esperaResolver || !estado.perguntaAtual) return;
  var p = estado.perguntaAtual;
  var certa = typeof p.certa === 'number' ? p.certa : null;
  var respostaTexto = (p.opcoes || [])[i] || '';
  document.querySelectorAll('#aluno-opcoes .btn-opcao').forEach(function (b, j) {
    b.disabled = true;
    if (certa !== null && j === certa) b.classList.add('certa');
    if (j === i && certa !== null && j !== certa) b.classList.add('errada');
  });
  $('aluno-resposta-livre').disabled = true;
  $('btn-responder-livre').disabled = true;
  resolverEspera({ texto: respostaTexto, certa: certa === null ? null : (i === certa), opcao: i });
}
function responderAlunoLivre() {
  if (!estado || !estado.esperaResolver || !estado.perguntaAtual) return;
  var texto = $('aluno-resposta-livre').value.trim();
  if (!texto) { $('aluno-resposta-livre').focus(); return; }
  document.querySelectorAll('#aluno-opcoes .btn-opcao').forEach(function (b) { b.disabled = true; });
  $('aluno-resposta-livre').disabled = true;
  $('btn-responder-livre').disabled = true;
  resolverEspera({ texto: texto, certa: null, livre: true });
}
async function executarPerguntaAluno(pergunta) {
  estado.perguntaAtual = pergunta;
  mostrarPainelAluno(pergunta);
  var resp = await new Promise(function (r) { estado.esperaResolver = r; });
  estado.perguntaAtual = null;
  // Retorno do professor: IA real quando disponível; senão, palavras-chave.
  var retorno;
  var certaTexto = (typeof pergunta.certa === 'number' && pergunta.opcoes) ? pergunta.opcoes[pergunta.certa] : (pergunta.dica || '');
  if (resp.certa === true) {
    retorno = { ok: true, texto: escolher(REACAO_PROFESSOR_RESPOSTA_CERTA) + ' ' + (pergunta.dica || certaTexto) };
  } else if (resp.certa === false) {
    retorno = { ok: false, texto: escolher(REACAO_PROFESSOR_RESPOSTA_ERRADA) + ' ' + (pergunta.dica || certaTexto) };
  } else {
    if (aulaAtual && aulaAtual.fonte === 'ia') retorno = await retornoDaIA(pergunta.pergunta, resp.texto, certaTexto);
    if (!retorno) retorno = retornoPorPalavrasChave(resp.texto, certaTexto, pergunta.dica);
  }
  var el = $('aluno-retorno');
  el.hidden = false;
  el.textContent = 'Professor: ' + retorno.texto;
  await falar('professor', retorno.texto);
  await sleep(aleatorio(800, 1600) * fatorTempoTeste);
  esconderPainelAluno();
}

// ---------------------------------------------------------------- Quiz final
function executarQuiz() {
  return new Promise(function (resolverQuiz) {
    var quiz = aulaAtual.dados.quiz;
    var indice = 0, acertos = 0;
    estado.quizIndice = 0;
    estado.acertos = 0;
    $('painel-quiz').hidden = false;
    $('painel-quiz').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    $('quiz-titulo').textContent = 'Quiz rápido — 3 questões';
    function mostrarQuestao() {
      var q = quiz[indice];
      estado.quizIndice = indice;
      $('quiz-pergunta').textContent = (indice + 1) + '. ' + q.pergunta;
      $('quiz-opcoes').innerHTML = '';
      $('quiz-feedback').hidden = true;
      $('quiz-feedback').textContent = '';
      $('btn-proxima-questao').hidden = true;
      $('btn-ver-resumo').hidden = true;
      q.alternativas.forEach(function (alt, j) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn-opcao';
        b.textContent = alt;
        b.addEventListener('click', function () {
          var certa = j === q.correta;
          if (certa) acertos++;
          document.querySelectorAll('#quiz-opcoes .btn-opcao').forEach(function (x, k) {
            x.disabled = true;
            if (k === q.correta) x.classList.add('certa');
            if (k === j && !certa) x.classList.add('errada');
          });
          var fb = $('quiz-feedback');
          fb.hidden = false;
          fb.textContent = (certa ? '✔ Certa! ' : '✖ Errada. ') + 'Resposta certa: ' + q.alternativas[q.correta].replace(/[.?!]+$/, '') + '. ' + (q.explicacao || '');
          if (indice < quiz.length - 1) $('btn-proxima-questao').hidden = false;
          else $('btn-ver-resumo').hidden = false;
        });
        $('quiz-opcoes').appendChild(b);
      });
    }
    $('btn-proxima-questao').onclick = function () { indice++; mostrarQuestao(); };
    $('btn-ver-resumo').onclick = function () {
      estado.acertos = acertos;
      $('painel-quiz').hidden = true;
      resolverQuiz(acertos);
    };
    mostrarQuestao();
  });
}

// ---------------------------------------------------------------- Resumo final
function montarResumoAula() {
  var a = aulaAtual;
  var linhas = [
    'Resumo da aula — Brittech Educação',
    'Tema: ' + a.tema,
    a.nome ? 'Aluno(a): ' + a.nome : null,
    'Data: ' + hojeBR(),
    'Aula: ' + (a.fonte === 'ia' ? 'montada pela IA real (Maritaca ' + MODELO + ')' : 'modo demonstração (sem IA real — conteúdo de exemplo)'),
    estado.acertos === null ? 'Quiz: ainda não feito.' : 'Quiz: ' + estado.acertos + ' de ' + a.dados.quiz.length + ' acertos.',
    'Pontos-chave da lousa:',
  ].filter(function (x) { return x !== null; });
  a.dados.blocos.forEach(function (b) { linhas.push('• ' + b.chave); });
  return linhas.join('\n');
}
function mostrarResumo() {
  $('resumo-nota').textContent = estado.acertos === null
    ? 'Você concluiu a aula!'
    : 'Você acertou ' + estado.acertos + ' de ' + aulaAtual.dados.quiz.length + ' no quiz.' +
      (estado.acertos >= 2 ? ' Muito bem!' : ' Revise os pontos-chave da lousa e tente de novo quando quiser.');
  $('resumo-texto').textContent = montarResumoAula();
  $('painel-resumo').hidden = false;
  $('painel-resumo').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------------------------------------------------------------- Motor principal
async function executarRoteiro() {
  var roteiro = aulaAtual.roteiro;
  estado.total = roteiro.length;
  for (var i = 0; i < roteiro.length; i++) {
    if (!estado || !estado.rodando) return;
    estado.indice = i;
    var passo = roteiro[i];
    setFase(passo.fase, i, roteiro.length);
    // Mão levantada: o professor chama o aluno antes do próximo bloco.
    if (passo.tipo === 'slide' && estado.maoLevantada && i > 0) {
      estado.maoLevantada = false;
      atualizarBotaoMao();
      await falar('professor', 'Vi que você levantou a mão — pode falar!');
      await executarPerguntaAluno({
        pergunta: 'Pode falar! O que você quer saber?',
        opcoes: ['Entendi tudo, pode continuar', 'Pode repetir o último ponto?'],
        certa: null,
        dica: estado.ultimoBloco ? estado.ultimoBloco.resumo : '',
      });
    }
    if (passo.tipo === 'slide') {
      mostrarSlide(passo.titulo, passo.linhas);
    } else if (passo.tipo === 'fala') {
      if (passo.quem === 'professor' && passo.chave) estado.ultimoBloco = { resumo: passo.chave };
      await falar(passo.quem, passo.texto, { chave: passo.chave, lousa: passo.lousa, corLousa: passo.corLousa });
    } else if (passo.tipo === 'pergunta-aluno') {
      await executarPerguntaAluno(passo.pergunta);
    } else if (passo.tipo === 'quiz') {
      await executarQuiz();
    } else if (passo.tipo === 'resumo') {
      mostrarResumo();
    }
    if (!estado || !estado.rodando) return;
    // Pausa variada entre os momentos da aula — nunca um tempo fixo.
    if (i < roteiro.length - 1) await sleep(aleatorio(600, 2000) * fatorTempoTeste);
  }
  estado.rodando = false;
  destacarQuemFala(null);
  setFase('Aula concluída', roteiro.length - 1, roteiro.length);
}

async function iniciarAula() {
  limparLousa();
  esconderPainelAluno();
  $('painel-quiz').hidden = true;
  $('painel-resumo').hidden = true;
  estado = {
    rodando: true, indice: 0, total: aulaAtual.roteiro.length,
    mudo: false, cameraLigada: true, maoLevantada: false,
    timerFala: null, timerEscrita: null, esperaResolver: null,
    falaAtual: null, perguntaAtual: null, quizIndice: 0, acertos: null, ultimoBloco: null,
  };
  $('aula-tema-titulo').textContent = aulaAtual.tema;
  $('badge-modo').hidden = aulaAtual.fonte !== 'demo';
  $('badge-ia').hidden = aulaAtual.fonte !== 'ia';
  $('btn-mudo').textContent = '🔊 Som ligado';
  $('btn-mudo').setAttribute('aria-pressed', 'false');
  $('btn-camera').textContent = '📷 Câmera ligada';
  $('btn-camera').setAttribute('aria-pressed', 'true');
  atualizarBotaoMao();
  atualizarAvisoVoz();
  mostrarSlide('Bem-vindo(a) à aula!', ['A aula já vai começar…']);
  await executarRoteiro();
}

function pararAula() {
  if (estado) {
    estado.rodando = false;
    estado.esperaResolver = null;
    estado.perguntaAtual = null;
  }
  cancelarFalaAtual();
  finalizarEscritaLousa();
  if (temSinteseVoz()) { try { window.speechSynthesis.cancel(); } catch (e) {} }
}

// ---------------------------------------------------------------- Geração + entrada
function mostrarErroEntrada(msg) {
  var el = $('entrada-erro');
  el.hidden = false;
  el.textContent = msg;
}
function mostrarStatusEntrada(msg) {
  var el = $('entrada-status');
  el.hidden = false;
  el.textContent = msg;
}
function forcarDemoNaUrl() {
  try { return new URLSearchParams(window.location.search).get('demo') === '1'; } catch (e) { return false; }
}
async function gerarAula(tema, texto) {
  if (forcarDemoNaUrl()) return { fonte: 'demo', dados: montarAulaDemo(tema, texto), erroIA: null };
  try {
    var resp = await chamarIAProxy(promptAula(tema, texto), PROMPT_SISTEMA_AULA);
    var dados = extrairJSONAula(resp);
    return { fonte: 'ia', dados: dados, erroIA: null };
  } catch (err) {
    return { fonte: 'demo', dados: montarAulaDemo(tema, texto), erroIA: err };
  }
}
async function entrarNaAula(tema, texto, nome) {
  if (gerandoAula) return;
  tema = (tema || '').trim();
  if (!tema) { mostrarErroEntrada('Escreva o tema da aula antes de entrar.'); $('aula-tema').focus(); return; }
  gerandoAula = true;
  $('entrada-erro').hidden = true;
  var btn = $('btn-entrar');
  btn.disabled = true;
  btn.textContent = 'Montando sua aula…';
  mostrarStatusEntrada('Montando sua aula com a IA real… (se a IA não responder, entra o modo demonstração)');
  var resultado = await gerarAula(tema, texto || '');
  aulaAtual = {
    tema: tema, texto: texto || '', nome: (nome || '').trim(),
    fonte: resultado.fonte, dados: resultado.dados,
    roteiro: null,
  };
  aulaAtual.roteiro = montarRoteiro(aulaAtual.dados);
  btn.disabled = false;
  btn.textContent = 'Entrar na aula';
  $('entrada-status').hidden = true;
  gerandoAula = false;
  mostrarTela('tela-aula', 'tela-entrada');
  window.scrollTo(0, 0);
  await iniciarAula();
}

// ---------------------------------------------------------------- Controles
function atualizarBotaoMao() {
  var b = $('btn-mao');
  var levantada = !!(estado && estado.maoLevantada);
  b.textContent = levantada ? '✋ Mão levantada' : '✋ Levantar a mão';
  b.setAttribute('aria-pressed', levantada ? 'true' : 'false');
  $('selo-mao').hidden = !levantada;
}
function alternarMudo() {
  if (!estado) return;
  estado.mudo = !estado.mudo;
  var b = $('btn-mudo');
  b.textContent = estado.mudo ? '🔇 Mudo' : '🔊 Som ligado';
  b.setAttribute('aria-pressed', estado.mudo ? 'true' : 'false');
  if (estado.mudo) cancelarFalaAtual();
  else if (estado.rodando && estado.falaAtual) {
    // Retoma a fala atual com voz (reinicia o passo corrente de forma simples).
    pularFala();
  }
}
function alternarCamera() {
  if (!estado) return;
  estado.cameraLigada = !estado.cameraLigada;
  var b = $('btn-camera');
  b.textContent = estado.cameraLigada ? '📷 Câmera ligada' : '📷 Câmera desligada';
  b.setAttribute('aria-pressed', estado.cameraLigada ? 'true' : 'false');
  var tile = $('tile-voce').querySelector('.video-sim');
  tile.classList.toggle('camera-off', !estado.cameraLigada);
  if (!tile.querySelector('.camera-off-msg')) {
    var msg = document.createElement('span');
    msg.className = 'camera-off-msg';
    msg.textContent = 'Câmera desligada';
    tile.appendChild(msg);
  }
}
function alternarMao() {
  if (!estado) return;
  estado.maoLevantada = !estado.maoLevantada;
  atualizarBotaoMao();
}
async function alternarTelaCheia() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch (e) { /* navegador sem suporte — ignora */ }
}
function sairDaAula() {
  pararAula();
  mostrarTela('tela-entrada', 'tela-aula');
  window.scrollTo(0, 0);
}
function copiarResumo() {
  var texto = montarResumoAula();
  var done = function () { $('btn-copiar-resumo').textContent = 'Resumo copiado!'; setTimeout(function () { $('btn-copiar-resumo').textContent = 'Copiar resumo'; }, 2500); };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(texto).then(done, done);
  else {
    var ta = document.createElement('textarea');
    ta.value = texto; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta); done();
  }
}

// ---------------------------------------------------------------- Ligações
$('btn-exemplo').addEventListener('click', function () {
  $('aula-tema').value = EXEMPLO_TEMA;
  $('aula-texto').value = EXEMPLO_TEXTO;
  $('entrada-exemplo-info').hidden = false;
  $('entrada-erro').hidden = true;
});
$('btn-entrar').addEventListener('click', function () {
  entrarNaAula($('aula-tema').value, $('aula-texto').value, $('aluno-nome').value);
});
$('btn-mudo').addEventListener('click', alternarMudo);
$('btn-camera').addEventListener('click', alternarCamera);
$('btn-mao').addEventListener('click', alternarMao);
$('btn-pular').addEventListener('click', pularFala);
$('btn-tela-cheia').addEventListener('click', alternarTelaCheia);
$('btn-sair').addEventListener('click', sairDaAula);
$('btn-limpar-lousa').addEventListener('click', limparLousa);
$('btn-responder-livre').addEventListener('click', responderAlunoLivre);
$('aluno-resposta-livre').addEventListener('keydown', function (ev) {
  if (ev.key === 'Enter') responderAlunoLivre();
});
$('btn-copiar-resumo').addEventListener('click', copiarResumo);
$('btn-rever-aula').addEventListener('click', async function () {
  $('painel-resumo').hidden = true;
  await iniciarAula();
});
$('btn-sair-resumo').addEventListener('click', sairDaAula);
window.addEventListener('resize', desenharLousa);
desenharLousa();

// ---------------------------------------------------------------- Ganchos p/ testes automatizados (não afetam o uso normal)
window.__sala = {
  estado: function () {
    return {
      rodando: !!(estado && estado.rodando),
      indice: estado ? estado.indice : -1,
      total: estado ? estado.total : 0,
      fase: $('aula-fase').textContent,
      mudo: !!(estado && estado.mudo),
      maoLevantada: !!(estado && estado.maoLevantada),
      aguardandoAluno: !!$('painel-aluno') && !$('painel-aluno').hidden,
      quizVisivel: !!$('painel-quiz') && !$('painel-quiz').hidden,
      resumoVisivel: !!$('painel-resumo') && !$('painel-resumo').hidden,
      quizIndice: estado ? estado.quizIndice : -1,
      acertos: estado ? estado.acertos : null,
      linhasLousa: lousaLinhas.length,
      temVoz: temSinteseVoz(),
      legenda: $('legenda').textContent,
      tema: aulaAtual ? aulaAtual.tema : null,
      fonte: aulaAtual ? aulaAtual.fonte : null,
      passos: aulaAtual && aulaAtual.roteiro ? aulaAtual.roteiro.length : 0,
    };
  },
  getAula: function () { return aulaAtual ? aulaAtual.dados : null; },
  getLousa: function () { return lousaLinhas.map(function (l) { return { texto: l.texto, cor: l.cor, escrito: l.escrito }; }); },
  entrar: entrarNaAula,
  preencherExemplo: function () { $('btn-exemplo').click(); },
  responderAluno: responderAlunoOpcao,
  responderAlunoLivre: function (texto) { $('aluno-resposta-livre').value = texto || ''; responderAlunoLivre(); },
  responderQuiz: function (i) {
    var b = document.querySelectorAll('#quiz-opcoes .btn-opcao')[i];
    if (b) b.click();
  },
  proximaQuestao: function () { $('btn-proxima-questao').click(); },
  verResumo: function () { $('btn-ver-resumo').click(); },
  pular: pularFala,
  sair: sairDaAula,
  levantarMao: alternarMao,
  setFatorTempo: function (f) { fatorTempoTeste = f; },
  forcarSemVoz: function (v) { forcarSemVozTeste = !!v; atualizarAvisoVoz(); },
  resumo: function () { return aulaAtual ? montarResumoAula() : ''; },
};
