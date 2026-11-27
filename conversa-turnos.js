// Conversar por turnos — Sala de Aula Online (Brittech Educação)
// O aluno fala por voz (ou escreve) e o professor responde por voz, um de
// cada vez — a versão barata da conversa, sem ligação em tempo real.
//
// Arquitetura (sem dependências externas, como o resto do site):
//   aluno fala -> webkitSpeechRecognition (grátis, no aparelho) -> texto
//   texto -> Maritaca sabia-4-thinking (proxy /api/chat, já existe)
//   resposta -> voz neural brasileira (proxy POST /api/tts, Edge TTS grátis)
//   -> toca no navegador; legenda + transcrição + lousa acompanham.
//   Os colegas entram pelo "diretor" (a cada 3 turnos do professor):
//   fala gerada pela Maritaca e falada com a voz neural do personagem.
//   Se o /api/tts falhar, a fala sai com a voz do aparelho
//   (speechSynthesis, pt-BR) e a tela avisa — a aula nunca fica muda.
//
// Vozes neurais (aprovadas pelo Thiago em 25/11): professora Francisca,
// Pensador Antonio, Anotador Thalita; Curioso usa o Antonio mais rápido
// e agudo (+25%, +6st) porque só existem 3 vozes pt-BR no Edge TTS.
// Regra de voz: perguntas mais rápidas, respostas mais calmas; frases
// com pausa de respiração entre elas.
//
// Custo: só a Maritaca cobra — cerca de R$ 0,13 por plano longo
// (~2.500 tokens); uma conversa de 20 trocas fica na casa dos centavos.
// O reconhecimento de voz e a voz neural são grátis.
//
// Modos de teste (parâmetros da URL, sem efeito no uso normal):
//   ?demo=1     -> respostas locais, sem chamar a Maritaca
//   ?sem-tts=1  -> força o fallback (voz do aparelho) para testar
//   ?proxy=URL  -> aponta para outro proxy (ex.: http://127.0.0.1:8791)

'use strict';

var PROXY_URL = 'https://brittech-proxy.duckdns.org';
var EXEMPLO_TEMA = 'Misturas homogêneas e heterogêneas';
var EXEMPLO_TEXTO = 'Uma mistura é a junção de dois ou mais materiais. Quando não conseguimos distinguir os componentes da mistura, como na água com sal dissolvido, a mistura é homogênea. Quando conseguimos ver os componentes separados, como na água com óleo ou na água com areia, a mistura é heterogênea. No dia a dia encontramos misturas em muitos lugares: o suco, o ar que respiramos e a salada são exemplos de misturas. Para classificar uma mistura, observamos se dá para ver os componentes separados ou se eles formam uma coisa só.';
// Maritaca: ~R$ 0,13 por ~2.500 tokens (um plano longo). Estimativa da
// conversa: tokens ≈ caracteres ÷ 4.
var CUSTO_POR_TOKEN_R$ = 0.13 / 2500;

var PERSONAGENS = {
  professor: { nome: 'Professor', cor: '#0284C7', voz: { pitch: 1.0, rate: 0.92 } },
  curioso:   { nome: 'Curioso',   cor: '#ec4899', voz: { pitch: 1.15, rate: 1.0 }, papel: 'pergunta muito, com curiosidade de aluno' },
  anotador:  { nome: 'Anotador',  cor: '#06b6d4', voz: { pitch: 1.05, rate: 0.98 }, papel: 'resume os pontos principais em uma frase' },
  pensador:  { nome: 'Pensador',  cor: '#f59e0b', voz: { pitch: 0.95, rate: 0.92 }, papel: 'reflete e relaciona o tema com o dia a dia' },
  voce:      { nome: 'Você',      cor: '#84CC16' },
};
var ORDEM_COLEGAS = ['curioso', 'anotador', 'pensador'];
var FALAS_COLEGA_LOCAL = {
  curioso: ['Também fiquei com essa dúvida!', 'Professor, pode explicar de novo essa parte?'],
  anotador: ['Já anotei esse ponto na lousa.', 'Boa, esse ponto é importante!'],
  pensador: ['Isso me lembra uma coisa do dia a dia…', 'Nossa, verdade! Nunca tinha pensado nisso.'],
};
var FALAS_PROFESSOR_LOCAL = [
  'Boa pergunta! Vamos por partes: o ponto principal é este — preste atenção na lousa.',
  'Isso mesmo! E repara: quando a gente entende esse ponto, o resto da aula fica mais fácil.',
  'Ótimo! Você está pegando o jeito. Quer que eu dê um exemplo do dia a dia?',
];

function $(id) { return document.getElementById(id); }
function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function mmss(ms) {
  var s = Math.floor(ms / 1000);
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}
function hojeBR() {
  var d = new Date();
  return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
}
function paramsUrl() {
  try { return new URLSearchParams(window.location.search); } catch (e) { return { get: function () { return null; } }; }
}
function dividirEmFrases(texto) {
  var partes = String(texto || '').match(/[^.!?…;]+[.!?…;]+["”)]?\s*|[^.!?…;]+$/g) || [];
  return partes.map(function (p) { return p.trim(); }).filter(function (p) { return p; });
}
function duracaoEstimadaMs(texto) {
  var palavras = String(texto || '').split(/\s+/).filter(function (s) { return s; }).length;
  return Math.max(2500, palavras * 450 + 1200);
}

// ---------------------------------------------------------------- Estado
var sessao = null;

function novaSessao(dados) {
  return {
    tema: dados.tema, conteudo: dados.conteudo, nomeAluno: dados.nomeAluno,
    inicioMs: 0, timerId: null,
    encerrada: false, ocupada: false, ouvindo: false, mudo: false,
    modoDemo: !!dados.modoDemo, semTts: !!dados.semTts,
    historico: [], // mensagens para a Maritaca {role, content}
    transcricao: [], // {quem, texto}
    pontosLousa: [],
    turnosProfessor: 0, trocas: 0, caracteres: 0,
    ultimoColegaMs: 0, indiceColega: 0,
    reconhecimento: null, audioAtual: null, timerFala: null,
    vozAparelhoUsada: false, audioNeuralOk: false,
  };
}

// ---------------------------------------------------------------- Entrada
function mostrarErro(msg) {
  var el = $('entrada-erro');
  el.hidden = false;
  el.textContent = msg;
}
function mostrarStatus(msg) {
  var el = $('entrada-status');
  el.hidden = false;
  el.textContent = msg;
}
function limparMensagensEntrada() {
  $('entrada-erro').hidden = true;
  $('entrada-status').hidden = true;
}

function montarEntrada() {
  var params = paramsUrl();
  if (params.get('proxy')) PROXY_URL = params.get('proxy');
  $('btn-exemplo').addEventListener('click', function () {
    $('aula-tema').value = EXEMPLO_TEMA;
    $('aula-texto').value = EXEMPLO_TEXTO;
    $('entrada-exemplo-info').hidden = false;
    limparMensagensEntrada();
  });
  $('btn-entrar').addEventListener('click', entrarNaConversa);
}

function entrarNaConversa() {
  limparMensagensEntrada();
  var nome = $('aluno-nome').value.trim();
  var tema = $('aula-tema').value.trim();
  var conteudo = $('aula-texto').value.trim();
  if (!tema) { mostrarErro('Informe o tema da aula para conversar com o professor.'); return; }
  var params = paramsUrl();
  sessao = novaSessao({
    tema: tema, conteudo: conteudo, nomeAluno: nome,
    modoDemo: params.get('demo') === '1',
    semTts: params.get('sem-tts') === '1',
  });
  var Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Rec) {
    var aviso = $('falar-aviso');
    aviso.hidden = false;
    aviso.textContent = 'Seu navegador não tem reconhecimento de voz — escreva no campo abaixo (a conversa funciona igual).';
    $('btn-falar').disabled = true;
  }
  $('tela-entrada').hidden = true;
  $('tela-aula').hidden = false;
  $('aula-tema-titulo').textContent = tema;
  $('voce-nome').textContent = nome || 'Você';
  $('voce-inicial').textContent = nome ? nome.slice(0, 2).toUpperCase() : 'Você';
  if (sessao.modoDemo) $('badge-demo').hidden = false;
  sessao.inicioMs = Date.now();
  sessao.timerId = setInterval(atualizarTempoECusto, 1000);
  montarControles();
  desenharLousa();
  setFase('Sua vez — aperte Falar ou escreva');
  setStatusSessao('Sua vez — aperte Falar ou escreva.');
  // Abertura do professor (sem gastar turno do aluno).
  var abertura = 'Oi' + (nome ? ', ' + nome : '') + '! Eu sou o professor. Hoje a gente vai conversar sobre ' + tema + '. O que você já sabe sobre isso? Aperte Falar e me conta — ou escreva aqui embaixo.';
  sessao.transcricao.push({ quem: 'professor', texto: abertura });
  desenharTranscricao();
  sessao.ocupada = true;
  falar('professor', abertura).then(function () {
    sessao.ocupada = false;
    if (!sessao.encerrada) setStatusSessao('Sua vez — aperte Falar ou escreva.');
  });
}

// ---------------------------------------------------------------- Reconhecimento de voz
function iniciarEscuta() {
  if (!sessao || sessao.encerrada || sessao.ouvindo || sessao.ocupada) return;
  var Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Rec) return;
  var rec;
  try {
    rec = new Rec();
  } catch (e) {
    mostrarAvisoFalar('Não consegui ligar o reconhecimento de voz — escreva no campo abaixo.');
    return;
  }
  sessao.reconhecimento = rec;
  rec.lang = 'pt-BR';
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;
  var finalTexto = '';
  rec.onresult = function (ev) {
    var interim = '', final = '';
    for (var i = ev.resultIndex; i < ev.results.length; i++) {
      if (ev.results[i].isFinal) final += ev.results[i][0].transcript;
      else interim += ev.results[i][0].transcript;
    }
    if (interim) mostrarLegenda('voce', interim + '…');
    if (final) finalTexto = final.trim();
  };
  rec.onerror = function (ev) {
    pararEscuta();
    if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
      mostrarAvisoFalar('O microfone não foi permitido — libere o microfone no navegador, ou escreva no campo abaixo.');
    } else if (ev.error === 'no-speech') {
      setStatusSessao('Não ouvi nada — aperte Falar e tente de novo.');
    } else if (ev.error === 'network') {
      mostrarAvisoFalar('Sem internet para o reconhecimento de voz — escreva no campo abaixo.');
    } else {
      setStatusSessao('Não consegui ouvir — tente de novo ou escreva.');
    }
  };
  rec.onend = function () {
    var estavaOuvindo = sessao.ouvindo;
    pararEscuta();
    if (finalTexto) {
      enviarFalaAluno(finalTexto);
    } else if (estavaOuvindo) {
      setStatusSessao('Não ouvi nada — aperte Falar e tente de novo.');
    }
  };
  try {
    rec.start();
  } catch (e) {
    mostrarAvisoFalar('Não consegui ligar o reconhecimento de voz — escreva no campo abaixo.');
    return;
  }
  sessao.ouvindo = true;
  marcarFalando('voce', true);
  var btn = $('btn-falar');
  btn.textContent = '🛑 Parar de ouvir';
  btn.setAttribute('aria-pressed', 'true');
  setFase('Ouvindo… fale agora');
  setStatusSessao('Ouvindo… fale agora. Aperte de novo para parar.');
}

function pararEscuta() {
  if (!sessao) return;
  sessao.ouvindo = false;
  marcarFalando('voce', false);
  var btn = $('btn-falar');
  if (btn) {
    btn.textContent = '🎙 Falar';
    btn.setAttribute('aria-pressed', 'false');
  }
  if (sessao.reconhecimento) {
    try { sessao.reconhecimento.stop(); } catch (e) {}
    sessao.reconhecimento = null;
  }
}

function mostrarAvisoFalar(msg) {
  var el = $('falar-aviso');
  el.hidden = false;
  el.textContent = msg;
}

// ---------------------------------------------------------------- Maritaca
function sistemaProfessor() {
  var base = sessao.conteudo
    ? ' Use SÓ este conteúdo como base da aula: ' + sessao.conteudo
    : ' Use só o tema como base; não invente dados, datas ou exemplos fora dele.';
  return 'Você é o Professor da Brittech Educação, professor de Tecnologia e ' +
    'Língua Portuguesa para alunos do ensino fundamental e médio. Fale sempre ' +
    'em português brasileiro, com frases curtas e linguagem simples. Tema da aula: ' +
    sessao.tema + '.' + base + ' Responda em no máximo 350 caracteres. Nunca ' +
    'invente dados, datas ou exemplos; se não souber algo, diga que não sabe e ' +
    'sugira onde procurar. Termine quase sempre com uma pergunta curta ao aluno. ' +
    'Corrija com gentileza, elogiando o acerto antes de corrigir o erro.';
}

function responderDemoProfessor(textoAluno) {
  // Modo demonstração (?demo=1): sem chamar a Maritaca. Gira entre as
  // frases do conteúdo colado e as falas locais.
  var frases = dividirEmFrases(sessao.conteudo || '');
  var n = sessao.turnosProfessor;
  if (n === 0 && frases.length) return frases[0] + ' Quer que eu explique com um exemplo do dia a dia?';
  if (frases.length > 1) return frases[n % frases.length] + ' O que você achou disso?';
  return FALAS_PROFESSOR_LOCAL[n % FALAS_PROFESSOR_LOCAL.length];
}

async function perguntarProfessor(textoAluno) {
  if (sessao.modoDemo) return responderDemoProfessor(textoAluno);
  sessao.historico.push({ role: 'user', content: textoAluno });
  var mensagens = [{ role: 'system', content: sistemaProfessor() }]
    .concat(sessao.historico.slice(-12));
  var ctrl = new AbortController();
  var timer = setTimeout(function () { ctrl.abort(); }, 45000);
  try {
    var r = await fetch(PROXY_URL + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({ provider: 'maritaca', messages: mensagens, temperature: 0.7, max_tokens: 300 }),
    });
    var j = await r.json();
    var texto = (j && j.text ? String(j.text).trim() : '');
    if (!r.ok || !texto) throw new Error((j && j.erro) || ('HTTP ' + r.status));
    sessao.caracteres += textoAluno.length + texto.length;
    sessao.historico.push({ role: 'assistant', content: texto });
    return texto;
  } catch (e) {
    // Sem IA: resposta local de exemplo (a aula continua).
    var local = FALAS_PROFESSOR_LOCAL[sessao.turnosProfessor % FALAS_PROFESSOR_LOCAL.length];
    sessao.transcricao.push({ quem: 'sistema', texto: '— sem conexão com a IA; resposta de exemplo —' });
    desenharTranscricao();
    return local;
  } finally {
    clearTimeout(timer);
  }
}

async function gerarFalaColega(quem) {
  var p = PERSONAGENS[quem];
  if (sessao.modoDemo) return FALAS_COLEGA_LOCAL[quem][sessao.indiceColega % FALAS_COLEGA_LOCAL[quem].length];
  var ultimos = sessao.transcricao.filter(function (t) { return t.quem === 'professor'; }).slice(-2)
    .map(function (t) { return t.texto; }).join(' ');
  var ctrl = new AbortController();
  var timer = setTimeout(function () { ctrl.abort(); }, 45000);
  try {
    var r = await fetch(PROXY_URL + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        provider: 'maritaca',
        messages: [
          { role: 'system', content: 'Você escreve UMA fala curta de um colega de sala de aula. Escreva só a fala, sem aspas e sem explicar. Máximo 140 caracteres, português brasileiro, linguagem de aluno.' },
          { role: 'user', content: 'Tema da aula: ' + sessao.tema + '. O professor acabou de dizer: "' + ultimos.slice(-400) + '". Escreva uma fala do ' + p.nome + ', que ' + p.papel + '.' },
        ],
        temperature: 0.8, max_tokens: 200,
      }),
    });
    var j = await r.json();
    var texto = (j && j.text ? String(j.text).trim() : '').replace(/^["“]|["”]$/g, '');
    if (!texto || texto.length > 200) throw new Error('resposta inválida');
    sessao.caracteres += texto.length;
    return texto;
  } catch (e) {
    return FALAS_COLEGA_LOCAL[quem][0];
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------- Fluxo por turnos
async function enviarFalaAluno(texto) {
  if (!sessao || sessao.encerrada || sessao.ocupada) return;
  texto = String(texto || '').trim();
  if (!texto) return;
  sessao.ocupada = true;
  pararEscuta();
  var campo = $('aluno-texto');
  if (campo) campo.value = '';
  sessao.transcricao.push({ quem: 'voce', texto: texto });
  sessao.trocas++;
  desenharTranscricao();
  mostrarLegenda('voce', texto);
  setFase('Pensando…');
  setStatusSessao('Pensando…');
  var resposta = await perguntarProfessor(texto);
  if (sessao.encerrada) return;
  sessao.transcricao.push({ quem: 'professor', texto: resposta });
  desenharTranscricao();
  escreverPontoNaLousa(resposta, '#ffffff');
  await falar('professor', resposta);
  if (sessao.encerrada) return;
  sessao.turnosProfessor++;
  sessao.ocupada = false;
  await diretorAposProfessor();
  if (!sessao.encerrada) {
    setFase('Sua vez — aperte Falar ou escreva');
    setStatusSessao('Sua vez — aperte Falar ou escreva.');
  }
}

// A cada 3 turnos do professor, um colega entra (mesmo diretor da versão
// ao vivo, adaptado: a fala é falada com a voz neural do personagem).
var diretorOcupado = false;
async function diretorAposProfessor() {
  if (sessao.encerrada || diretorOcupado) return;
  if (sessao.turnosProfessor % 3 !== 0) return;
  if (Date.now() - sessao.ultimoColegaMs < 60000) return;
  var quem = ORDEM_COLEGAS[sessao.indiceColega % ORDEM_COLEGAS.length];
  sessao.indiceColega++;
  sessao.ultimoColegaMs = Date.now();
  diretorOcupado = true;
  try {
    var texto = await gerarFalaColega(quem);
    if (sessao.encerrada) return;
    sessao.transcricao.push({ quem: quem, texto: texto });
    if (quem === 'anotador') escreverNaLousa(texto, '#67e8f9');
    desenharTranscricao();
    sessao.ocupada = true;
    await falar(quem, texto);
    sessao.ocupada = false;
  } finally {
    diretorOcupado = false;
  }
}

// ---------------------------------------------------------------- Falar (voz neural ou do aparelho)
function tomDaFrase(frase, ehUltima) {
  if (/[?¿]\s*$/.test(frase)) return 'pergunta';
  if (ehUltima) return 'resposta';
  return 'normal';
}

async function falar(quem, texto) {
  if (sessao.encerrada) return;
  var p = PERSONAGENS[quem];
  var frases = dividirEmFrases(texto);
  if (!frases.length) frases = [texto];
  marcarFalando(quem, true);
  setStatusParticipante(quem, 'falando');
  setFase(p.nome + ' falando…');
  setStatusSessao(p.nome + ' falando…');
  for (var i = 0; i < frases.length; i++) {
    if (sessao.encerrada) break;
    mostrarLegenda(quem, frases[i]);
    var tom = tomDaFrase(frases[i], i === frases.length - 1);
    await falarFrase(quem, frases[i], tom);
    // Pausa de respiração entre as frases.
    if (i < frases.length - 1 && !sessao.encerrada) await sleep(500);
  }
  marcarFalando(quem, false);
  setStatusParticipante(quem, 'ouvindo');
}

// Uma frase: tenta a voz neural; se falhar, usa a voz do aparelho.
async function falarFrase(quem, frase, tom) {
  if (sessao.encerrada || sessao.mudo) {
    if (!sessao.mudo) await sleep(Math.min(duracaoEstimadaMs(frase), 6000));
    return;
  }
  if (!sessao.semTts) {
    try {
      var ok = await falarNeural(quem, frase, tom);
      if (ok) return;
    } catch (e) { /* cai para a voz do aparelho */ }
  }
  await falarAparelho(quem, frase);
}

async function falarNeural(quem, frase, tom) {
  var ctrl = new AbortController();
  var timer = setTimeout(function () { ctrl.abort(); }, 30000);
  try {
    var r = await fetch(PROXY_URL + '/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      // O mapa do proxy chama o personagem de "professora"; na página o
      // personagem é "professor" — manda o nome do mapa.
      body: JSON.stringify({ texto: frase, personagem: quem === 'professor' ? 'professora' : quem, tom: tom }),
    });
    if (!r.ok) return false;
    var blob = await r.blob();
    if (!blob || blob.size < 100) return false;
    var url = URL.createObjectURL(blob);
    try {
      await tocarAudio(url);
    } finally {
      try { URL.revokeObjectURL(url); } catch (e) {}
    }
    sessao.audioNeuralOk = true;
    return true;
  } catch (e) {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function tocarAudio(url) {
  return new Promise(function (resolver) {
    var audio = new Audio(url);
    sessao.audioAtual = audio;
    var pronto = false;
    var concluir = function () {
      if (pronto) return;
      pronto = true;
      if (sessao.audioAtual === audio) sessao.audioAtual = null;
      resolver();
    };
    audio.onended = concluir;
    audio.onerror = concluir;
    // Segurança: se o navegador não tocar (ex.: sem gesto do usuário),
    // não trava a aula — avança pela duração estimada.
    setTimeout(concluir, 15000);
    var p = audio.play();
    if (p && p.catch) p.catch(function () { concluir(); });
  });
}

// Voz do aparelho (Web Speech API), mesmo padrão da sala com roteiro.
// Com temporizador de segurança: se a voz não existir ou não terminar,
// a aula avança pela duração estimada e nunca trava.
function falarAparelho(quem, frase) {
  return new Promise(function (resolver) {
    if (sessao.encerrada) { resolver(); return; }
    if (sessao.mudo) { resolver(); return; }
    sessao.vozAparelhoUsada = true;
    $('badge-aparelho').hidden = false;
    var p = PERSONAGENS[quem];
    var limite = setTimeout(resolver, duracaoEstimadaMs(frase) + 5000);
    var concluir = function () { clearTimeout(limite); resolver(); };
    if (!('speechSynthesis' in window)) { concluir(); return; }
    try {
      var u = new SpeechSynthesisUtterance(frase);
      u.lang = 'pt-BR';
      u.pitch = (p.voz && p.voz.pitch) || 1;
      u.rate = (p.voz && p.voz.rate) || 1;
      var voz = vozParaAparelho(quem);
      if (voz) u.voice = voz;
      u.onend = concluir;
      u.onerror = concluir;
      window.speechSynthesis.speak(u);
    } catch (e) {
      concluir();
    }
  });
}

var vozesCache = null;
function vozesPTBR() {
  if (vozesCache && vozesCache.length) return vozesCache;
  var todas = [];
  try { todas = window.speechSynthesis.getVoices() || []; } catch (e) {}
  var pt = todas.filter(function (v) { return (v.lang || '').toLowerCase().indexOf('pt') === 0; });
  vozesCache = pt.length ? pt : todas;
  return vozesCache;
}
function vozParaAparelho(personagem) {
  var lista = vozesPTBR();
  if (!lista.length) return null;
  var base = ORDEM_COLEGAS.indexOf(personagem);
  if (base < 0) base = 0;
  var naturais = lista.filter(function (v) { return /natural|neural/i.test(v.name || ''); });
  var conhecidas = lista.filter(function (v) { return /google.*português|maria|luciana|daniel/i.test(v.name || ''); });
  var pool = naturais.length ? naturais : (conhecidas.length ? conhecidas : lista);
  return pool[base % pool.length];
}

function pararFalaAtual() {
  if (sessao.audioAtual) {
    try { sessao.audioAtual.pause(); } catch (e) {}
    sessao.audioAtual = null;
  }
  try { if ('speechSynthesis' in window) window.speechSynthesis.cancel(); } catch (e) {}
  if (sessao.timerFala) { clearTimeout(sessao.timerFala); sessao.timerFala = null; }
}

// ---------------------------------------------------------------- Transcrição e legenda
function desenharTranscricao() {
  var el = $('transcricao');
  if (!el) return;
  var html = '';
  sessao.transcricao.forEach(function (t) {
    var classe = t.quem === 'professor' ? 'professor' : (t.quem === 'voce' ? 'voce' : (t.quem === 'sistema' ? 'sistema' : 'colega'));
    var nome = t.quem === 'professor' ? 'Professor' : (t.quem === 'voce' ? (sessao.nomeAluno || 'Você') : (t.quem === 'sistema' ? '' : PERSONAGENS[t.quem].nome));
    html += '<p class="turno ' + classe + '">' + (nome ? '<span class="quem">' + esc(nome) + ':</span> ' : '') + esc(t.texto) + '</p>';
  });
  el.innerHTML = html;
  el.scrollTop = el.scrollHeight;
}

function mostrarLegenda(quem, texto) {
  var nome = quem === 'professor' ? 'Professor' : (quem === 'voce' ? (sessao.nomeAluno || 'Você') : PERSONAGENS[quem].nome);
  $('legenda').innerHTML = '<span class="quem">' + esc(nome) + ':</span> ' + esc(texto);
}

// ---------------------------------------------------------------- Lousa
// Mesmo desenho da sala com roteiro e da conversa ao vivo: quadro verde,
// letra grande (32px).
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
function escreverNaLousa(texto, cor) {
  var linha = { texto: String(texto || ''), cor: cor || '#ffffff', escrito: 0 };
  lousaLinhas.push(linha);
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
  linha.escrito = linha.texto.length;
  desenharLousa();
}
function limparLousa() { lousaLinhas = []; desenharLousa(); }

// Primeira frase de 25–100 caracteres de cada turno do professor.
function escreverPontoNaLousa(texto, cor) {
  var frases = dividirEmFrases(texto);
  var ponto = null;
  for (var i = 0; i < frases.length; i++) {
    var f = frases[i].trim();
    if (f.length >= 25 && f.length <= 100) { ponto = f; break; }
  }
  if (!ponto) return;
  if (sessao.pontosLousa.indexOf(ponto) !== -1) return;
  sessao.pontosLousa.push(ponto);
  escreverNaLousa(ponto, cor);
}

// ---------------------------------------------------------------- Interface
function setFase(texto) { $('aula-fase').textContent = texto; }
function setStatusSessao(texto) { $('sessao-status').textContent = texto; }
function setStatusParticipante(quem, texto) {
  var tile = document.querySelector('.participante[data-quem="' + quem + '"]');
  if (tile) { var el = tile.querySelector('[data-status]'); if (el) el.textContent = texto; }
}
function marcarFalando(quem, falando) {
  document.querySelectorAll('.participante').forEach(function (tile) {
    var selo = tile.querySelector('.selo-falando');
    if (tile.dataset.quem === quem) {
      tile.classList.toggle('falando', !!falando);
      if (selo) selo.hidden = !falando;
    }
  });
}
function destacarQuemFala(quem) {
  document.querySelectorAll('.participante').forEach(function (tile) {
    var ativo = quem && tile.dataset.quem === quem;
    tile.classList.toggle('falando', !!ativo);
    var selo = tile.querySelector('.selo-falando');
    if (selo) selo.hidden = !ativo;
  });
}

function atualizarTempoECusto() {
  if (!sessao || sessao.encerrada || sessao.inicioMs === 0) return;
  $('sessao-tempo').textContent = mmss(Date.now() - sessao.inicioMs);
  $('sessao-trocas').textContent = sessao.trocas + (sessao.trocas === 1 ? ' troca' : ' trocas');
  var tokens = Math.round(sessao.caracteres / 4);
  var custo = tokens * CUSTO_POR_TOKEN_R$;
  $('sessao-custo').textContent = '≈ R$ ' + custo.toFixed(2).replace('.', ',') + ' (' + tokens + ' tokens Maritaca)';
}

function montarControles() {
  desenharLousa();
  $('btn-limpar-lousa').addEventListener('click', limparLousa);
  $('btn-falar').addEventListener('click', function () {
    if (!sessao || sessao.encerrada) return;
    if (sessao.ouvindo) { pararEscuta(); setStatusSessao('Sua vez — aperte Falar ou escreva.'); return; }
    iniciarEscuta();
  });
  $('btn-enviar-texto').addEventListener('click', function () {
    var campo = $('aluno-texto');
    enviarFalaAluno(campo.value);
  });
  $('aluno-texto').addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter') enviarFalaAluno(ev.target.value);
  });
  $('btn-parar').addEventListener('click', function () {
    pararEscuta();
    pararFalaAtual();
    if (sessao && !sessao.encerrada) {
      sessao.ocupada = false;
      setStatusSessao('Sua vez — aperte Falar ou escreva.');
    }
  });
  $('btn-mudo').addEventListener('click', function () {
    if (!sessao) return;
    sessao.mudo = !sessao.mudo;
    var btn = $('btn-mudo');
    btn.setAttribute('aria-pressed', String(sessao.mudo));
    btn.textContent = sessao.mudo ? '🔇 Som desligado' : '🔊 Som ligado';
    if (sessao.mudo) pararFalaAtual();
  });
  $('btn-tela-cheia').addEventListener('click', function () {
    var el = document.getElementById('tela-aula');
    if (document.fullscreenElement) { document.exitFullscreen(); return; }
    if (el.requestFullscreen) el.requestFullscreen();
  });
  $('btn-sair').addEventListener('click', function () { encerrar('usuario'); });
  $('btn-copiar-resumo').addEventListener('click', function () {
    var texto = $('resumo-texto').textContent;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(texto);
      $('btn-copiar-resumo').textContent = 'Copiado!';
      setTimeout(function () { $('btn-copiar-resumo').textContent = 'Copiar resumo'; }, 2000);
    }
  });
  $('btn-nova-conversa').addEventListener('click', function () { window.location.reload(); });
}

// ---------------------------------------------------------------- Encerrar
function encerrar(motivo) {
  if (!sessao || sessao.encerrada) return;
  sessao.encerrada = true;
  if (sessao.timerId) clearInterval(sessao.timerId);
  pararEscuta();
  pararFalaAtual();
  try { if ('speechSynthesis' in window) window.speechSynthesis.cancel(); } catch (e) {}
  var decorrido = sessao.inicioMs ? Date.now() - sessao.inicioMs : 0;
  var tokens = Math.round(sessao.caracteres / 4);
  var custo = tokens * CUSTO_POR_TOKEN_R$;
  $('resumo-nota').textContent = 'Você encerrou a conversa. Duração: ' + mmss(decorrido) + ' · ' +
    sessao.trocas + (sessao.trocas === 1 ? ' troca' : ' trocas') + ' com o professor.';
  $('resumo-custo').textContent = 'Custo estimado: ≈ R$ ' + custo.toFixed(2).replace('.', ',') +
    ' (Maritaca, ' + tokens + ' tokens; reconhecimento de voz e voz neural são grátis).' +
    (sessao.vozAparelhoUsada ? ' Em algum momento a voz neural falhou e a fala saiu com a voz do aparelho.' : '');
  var linhas = [
    'Resumo da conversa — Brittech Educação',
    'Tema: ' + sessao.tema,
    sessao.nomeAluno ? 'Aluno(a): ' + sessao.nomeAluno : null,
    'Data: ' + hojeBR(),
    'Duração: ' + mmss(decorrido),
    'Trocas: ' + sessao.trocas,
    'Pontos da lousa:',
  ].filter(function (x) { return x !== null; });
  sessao.pontosLousa.forEach(function (p) { linhas.push('• ' + p); });
  linhas.push('', 'Transcrição:');
  sessao.transcricao.forEach(function (t) {
    var nome = t.quem === 'professor' ? 'Professor' : (t.quem === 'voce' ? (sessao.nomeAluno || 'Você') : (t.quem === 'sistema' ? '' : PERSONAGENS[t.quem].nome));
    linhas.push((nome ? nome + ': ' : '') + t.texto);
  });
  $('resumo-texto').textContent = linhas.join('\n');
  $('painel-resumo').hidden = false;
  $('painel-resumo').scrollIntoView({ behavior: 'smooth', block: 'start' });
  setFase('Conversa encerrada');
  setStatusSessao('Conversa encerrada.');
  destacarQuemFala(null);
}

// ---------------------------------------------------------------- Início
if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', montarEntrada);
  } else {
    montarEntrada();
  }
  if ('speechSynthesis' in window && window.speechSynthesis) {
    window.speechSynthesis.addEventListener('voiceschanged', function () { vozesCache = null; });
  }
}

// Hooks de teste (o driver headless usa estes; sem efeito no uso normal).
window.__conversaTurnos = {
  simularFala: function (texto) { return enviarFalaAluno(texto); },
  estado: function () {
    if (!sessao) return { naSala: false };
    return {
      naSala: true,
      encerrada: sessao.encerrada,
      ocupada: sessao.ocupada,
      trocas: sessao.trocas,
      turnosProfessor: sessao.turnosProfessor,
      transcricao: sessao.transcricao.length,
      pontosLousa: sessao.pontosLousa.slice(),
      vozAparelhoUsada: sessao.vozAparelhoUsada,
      audioNeuralOk: sessao.audioNeuralOk,
      modoDemo: sessao.modoDemo,
    };
  },
};
