/** @jsxRuntime classic */
// (força o modo clássico do JSX: evita a tela branca do runtime automático do Babel)
const { useState, useEffect, useMemo, useRef, useCallback, createContext, useContext } = React;

const VERSAO = '2.0';

/* =============================================================================
   Formatação e datas (sempre no fuso do aparelho — nada de UTC)
   ============================================================================= */
const DIAS_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

function isoLocal(d = new Date()) {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
}
function dataDeISO(iso) { const [a, m, d] = String(iso).split('-').map(Number); return new Date(a, m - 1, d); }
function diasAtras(iso) {
  const hoje = dataDeISO(isoLocal());
  return Math.round((hoje - dataDeISO(iso)) / 86400000);
}
function somarDias(iso, n) { const d = dataDeISO(iso); d.setDate(d.getDate() + n); return isoLocal(d); }
function fmtDataCurta(iso) { const d = dataDeISO(iso); return `${d.getDate()} ${MESES[d.getMonth()]}`; }
function fmtDataMedia(iso) { const d = dataDeISO(iso); return `${DIAS_SEMANA[d.getDay()]}, ${d.getDate()} ${MESES[d.getMonth()]}`; }
function fmtDataLonga(iso) { const d = dataDeISO(iso); return `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`; }
function rotuloDia(iso) {
  const n = diasAtras(iso);
  if (n === 0) return 'Hoje';
  if (n === 1) return 'Ontem';
  return fmtDataMedia(iso);
}

// Safra Centro-Sul: abril de um ano até março do ano seguinte
function safraDe(iso = isoLocal()) {
  const d = dataDeISO(iso);
  const ano = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return { inicio: `${ano}-04-01`, fim: `${ano + 1}-03-31`, rotulo: `Safra ${ano}/${String(ano + 1).slice(2)}`, ano };
}

const _brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
// mantém o espaço inquebrável entre "R$" e o número (o R$ nunca fica sozinho no fim da linha)
function fmtBRL(n) { return _brl.format(Number(n) || 0).replace(/\s/g, '\u00a0'); }
function fmtNum(n, min = 1, max = 2) { return (Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: min, maximumFractionDigits: max }); }
function fmtTon(n) { return `${fmtNum(n)} t`; }
function plural(n, um, varios) { return `${n.toLocaleString('pt-BR')} ${n === 1 ? um : varios}`; }

// Aceita "79,37", "79.37" e "1.234,5"
function parseNum(s) {
  if (typeof s === 'number') return s;
  let t = String(s || '').trim().replace(/\s/g, '');
  if (!t) return NaN;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  return parseFloat(t);
}
function normalizar(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim(); }

function linkWhatsApp(telefone, texto) {
  let dig = String(telefone || '').replace(/\D/g, '');
  if (dig && dig.length <= 11) dig = '55' + dig;
  return `https://wa.me/${dig}?text=${encodeURIComponent(texto)}`;
}
function vibrar(ms = 12) { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} }

/* =============================================================================
   Supabase
   ============================================================================= */
const CHAVE_TEMA = 'canalog:tema';
const CHAVE_LETRA = 'canalog:letra';
const CFG = window.CANALOG_CONFIG || {};
const CONFIGURADO = Boolean(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY && !/COLE_AQUI/.test(CFG.SUPABASE_URL + CFG.SUPABASE_ANON_KEY));
const sb = CONFIGURADO && window.supabase ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY) : null;
const BUCKET = 'canalog';
const VALIDADE_URL = 60 * 60 * 24; // links das fotos valem 24h (são regerados a cada carregamento)

function uuid() { return (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16); })); }

// Reduz a foto (pra subir mais rápido e economizar espaço; também acelera o OCR)
function comprimirImagem(arquivo, maxDim = 1600, qualidade = 0.75) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(arquivo);
    img.onload = () => {
      const escala = Math.min(1, maxDim / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * escala);
      canvas.height = Math.round(img.height * escala);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => { URL.revokeObjectURL(url); resolve(blob || arquivo); }, 'image/jpeg', qualidade);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(arquivo); };
    img.src = url;
  });
}

async function subirImagem(caminho, arquivo) {
  const blob = await comprimirImagem(arquivo);
  const { error } = await sb.storage.from(BUCKET).upload(caminho, blob, { contentType: 'image/jpeg', upsert: true });
  if (error) throw error;
  return caminho;
}

async function linksAssinados(caminhos) {
  const validos = caminhos.filter(Boolean);
  if (validos.length === 0) return {};
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(validos, VALIDADE_URL);
  if (error) { console.error(error); return {}; }
  const mapa = {};
  for (const item of data || []) if (item.signedUrl) mapa[item.path] = item.signedUrl;
  return mapa;
}

function falhou(error) { if (error) { console.error(error); throw error; } }

const daMotorista = (r, links) => ({
  id: r.id, nome: r.nome, telefone: r.telefone || '', placa: r.placa || '',
  numero: r.numero || '', numeroVeiculo: r.numero_veiculo || '', ativo: r.ativo,
  fotoPath: r.foto_path || null, fotoUrl: r.foto_path ? (links[r.foto_path] || null) : null,
});
const daViagem = (r) => ({
  id: r.id, produtor: r.produtor, motoristaId: r.motorista_id, motoristaNome: r.motorista_nome || 'Sem motorista',
  placa: r.placa || '', destino: r.destino || '', toneladas: Number(r.toneladas),
  valorBruto: Number(r.valor_bruto), valor: Number(r.valor), status: r.status, data: r.data, criadoEm: r.created_at || '',
});
const daFoto = (r, links) => ({
  id: r.id, viagemId: r.viagem_id, path: r.path, url: links[r.path] || null,
  observacao: r.observacao || '', criadoEm: r.created_at,
});

/* =============================================================================
   Dados (contexto)
   ============================================================================= */
const AppCtx = createContext(null);
function useApp() { return useContext(AppCtx); }

function AppProvider({ usuario, children }) {
  const [motoristas, setMotoristas] = useState([]);
  const [viagens, setViagens] = useState([]);
  const [fotos, setFotos] = useState([]);
  const [valorPorTonelada, setValorPorTonelada] = useState(10);
  const [carregando, setCarregando] = useState(true);
  const [erroCarga, setErroCarga] = useState(null);
  const [tempoReal, setTempoReal] = useState(false);
  const recarregarRef = useRef(null);

  async function recarregar() {
    try {
      const [m, v, f, c] = await Promise.all([
        sb.from('motoristas').select('*').order('nome'),
        sb.from('viagens').select('*').order('data', { ascending: false }).order('created_at', { ascending: false }),
        sb.from('fotos').select('*').order('created_at', { ascending: false }),
        sb.from('config').select('*'),
      ]);
      for (const r of [m, v, f, c]) falhou(r.error);
      const links = await linksAssinados([...m.data.map((x) => x.foto_path), ...f.data.map((x) => x.path)]);
      setMotoristas(m.data.map((r) => daMotorista(r, links)));
      setViagens(v.data.map(daViagem));
      setFotos(f.data.map((r) => daFoto(r, links)));
      const vpt = c.data.find((x) => x.chave === 'valor_por_tonelada');
      if (vpt) setValorPorTonelada(Number(vpt.valor));
      setErroCarga(null);
    } catch (e) {
      setErroCarga(e?.message || 'Erro ao carregar os dados');
    } finally {
      setCarregando(false);
    }
  }
  recarregarRef.current = recarregar;

  useEffect(() => {
    recarregar();
    // Tempo real: o que um registrar aparece no aparelho do outro
    let timer = null;
    const agendar = () => { clearTimeout(timer); timer = setTimeout(() => recarregarRef.current(), 400); };
    const canal = sb.channel('canalog-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'viagens' }, agendar)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'motoristas' }, agendar)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fotos' }, agendar)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'config' }, agendar)
      .subscribe((status) => setTempoReal(status === 'SUBSCRIBED'));
    // Quando o celular "acorda" ou a internet volta, busca tudo de novo
    const aoVoltar = () => { if (document.visibilityState === 'visible') agendar(); };
    document.addEventListener('visibilitychange', aoVoltar);
    window.addEventListener('online', agendar);
    return () => {
      clearTimeout(timer); sb.removeChannel(canal);
      document.removeEventListener('visibilitychange', aoVoltar);
      window.removeEventListener('online', agendar);
    };
  }, []);

  const calcular = (toneladas) => Number((toneladas * valorPorTonelada).toFixed(2));

  async function registrarViagem({ produtor, motoristaId, toneladas, destino, data, status }) {
    const m = motoristas.find((x) => x.id === motoristaId);
    const valor = calcular(toneladas);
    const linha = {
      id: uuid(), produtor, motorista_id: m?.id ?? null, motorista_nome: m?.nome ?? 'Sem motorista',
      placa: m?.placa ?? '', destino: destino || '', toneladas, valor_bruto: valor, valor, status: status || 'em_rota', data,
    };
    const { error } = await sb.from('viagens').insert(linha);
    falhou(error);
    const nova = daViagem({ ...linha, created_at: new Date().toISOString() });
    setViagens((atual) => [nova, ...atual]);
    return nova;
  }
  async function editarViagem(id, patch) {
    const linha = {};
    if ('produtor' in patch) linha.produtor = patch.produtor;
    if ('destino' in patch) linha.destino = patch.destino;
    if ('data' in patch) linha.data = patch.data;
    if ('status' in patch) linha.status = patch.status;
    if ('motoristaId' in patch) {
      const m = motoristas.find((x) => x.id === patch.motoristaId);
      linha.motorista_id = m?.id ?? null; linha.motorista_nome = m?.nome ?? 'Sem motorista'; linha.placa = m?.placa ?? '';
    }
    if ('toneladas' in patch) { linha.toneladas = patch.toneladas; linha.valor_bruto = linha.valor = calcular(patch.toneladas); }
    const { error } = await sb.from('viagens').update(linha).eq('id', id);
    falhou(error);
    setViagens((atual) => atual.map((v) => (v.id === id ? daViagem({
      id: v.id, produtor: v.produtor, motorista_id: v.motoristaId, motorista_nome: v.motoristaNome, placa: v.placa,
      destino: v.destino, toneladas: v.toneladas, valor_bruto: v.valorBruto, valor: v.valor, status: v.status, data: v.data, created_at: v.criadoEm, ...linha,
    }) : v)));
  }
  async function marcarStatus(ids, status) {
    if (!ids.length) return;
    const { error } = await sb.from('viagens').update({ status }).in('id', ids);
    falhou(error);
    const set = new Set(ids);
    setViagens((atual) => atual.map((v) => (set.has(v.id) ? { ...v, status } : v)));
  }
  async function removerViagem(id) {
    const caminhos = fotos.filter((f) => f.viagemId === id).map((f) => f.path);
    const { error } = await sb.from('viagens').delete().eq('id', id); // fotos (linhas) saem junto por cascade
    falhou(error);
    if (caminhos.length) await sb.storage.from(BUCKET).remove(caminhos);
    setViagens((atual) => atual.filter((v) => v.id !== id));
    setFotos((atual) => atual.filter((f) => f.viagemId !== id));
  }

  async function salvarFotoMotorista(id, fotoArquivo) {
    if (!fotoArquivo) return null;
    return subirImagem(`motoristas/${id}-${Date.now()}.jpg`, fotoArquivo);
  }
  async function cadastrarMotorista({ nome, telefone, placa, numero, numeroVeiculo, fotoArquivo }) {
    const id = uuid();
    const foto_path = await salvarFotoMotorista(id, fotoArquivo);
    const { error } = await sb.from('motoristas').insert({ id, nome, telefone, placa, numero, numero_veiculo: numeroVeiculo, ativo: true, foto_path });
    falhou(error);
    await recarregar();
    return id;
  }
  async function editarMotorista(id, { nome, telefone, placa, numero, numeroVeiculo, ativo, fotoArquivo }) {
    const linha = { nome, telefone, placa, numero, numero_veiculo: numeroVeiculo, ativo };
    const antigo = motoristas.find((m) => m.id === id);
    if (fotoArquivo) linha.foto_path = await salvarFotoMotorista(id, fotoArquivo);
    const { error } = await sb.from('motoristas').update(linha).eq('id', id);
    falhou(error);
    if (fotoArquivo && antigo?.fotoPath) await sb.storage.from(BUCKET).remove([antigo.fotoPath]);
    await recarregar();
  }
  async function removerMotorista(id) {
    const antigo = motoristas.find((m) => m.id === id);
    const { error } = await sb.from('motoristas').delete().eq('id', id); // viagens antigas ficam, com o nome guardado
    falhou(error);
    if (antigo?.fotoPath) await sb.storage.from(BUCKET).remove([antigo.fotoPath]);
    setMotoristas((atual) => atual.filter((m) => m.id !== id));
  }

  async function enviarFoto({ viagemId, arquivo, observacao }) {
    const id = uuid();
    const path = await subirImagem(`viagens/${viagemId}/${id}.jpg`, arquivo);
    const { error } = await sb.from('fotos').insert({ id, viagem_id: viagemId, path, observacao: observacao || '' });
    falhou(error);
    await recarregar();
  }
  async function removerFoto(foto) {
    const { error } = await sb.from('fotos').delete().eq('id', foto.id);
    falhou(error);
    if (foto.path) await sb.storage.from(BUCKET).remove([foto.path]);
    setFotos((atual) => atual.filter((f) => f.id !== foto.id));
  }

  async function alterarValorPorTonelada(v) {
    const { error } = await sb.from('config').upsert({ chave: 'valor_por_tonelada', valor: v });
    falhou(error);
    setValorPorTonelada(v);
  }

  async function gerarBackup() {
    const [m, v, f, c] = await Promise.all(['motoristas', 'viagens', 'fotos', 'config'].map((t) => sb.from(t).select('*')));
    for (const r of [m, v, f, c]) falhou(r.error);
    return { app: 'canalog', versao: 2, geradoEm: new Date().toISOString(), motoristas: m.data, viagens: v.data, fotos: f.data, config: c.data };
  }
  async function restaurarBackup(json) {
    const b = JSON.parse(json);
    if (b.app !== 'canalog' || b.versao !== 2) throw new Error('backup inválido');
    for (const [tabela, linhas] of [['config', b.config], ['motoristas', b.motoristas], ['viagens', b.viagens], ['fotos', b.fotos]]) {
      if (linhas?.length) { const { error } = await sb.from(tabela).upsert(linhas); falhou(error); }
    }
    await recarregar();
  }

  const produtoresConhecidos = useMemo(() => [...new Set(viagens.map((v) => v.produtor).filter(Boolean))], [viagens]);
  const destinosConhecidos = useMemo(() => [...new Set(viagens.map((v) => v.destino).filter(Boolean))], [viagens]);

  const value = {
    usuario, carregando, erroCarga, recarregar, tempoReal,
    motoristas, viagens, fotos, valorPorTonelada, produtoresConhecidos, destinosConhecidos,
    registrarViagem, editarViagem, marcarStatus, removerViagem,
    cadastrarMotorista, editarMotorista, removerMotorista,
    enviarFoto, removerFoto, alterarValorPorTonelada, gerarBackup, restaurarBackup,
  };
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

// Se o OCR leu algo que começa com um nome já usado ("Usina Santa Rita E Arte"), usa o nome conhecido.
function encaixarNoConhecido(lido, conhecidos) {
  if (!lido) return lido;
  const norm = (s) => normalizar(s).replace(/\s+/g, ' ');
  const l = norm(lido);
  const candidatos = conhecidos.filter((c) => { const n = norm(c); return n.length >= 4 && (l === n || l.startsWith(n + ' ') || n.startsWith(l + ' ')); });
  if (candidatos.length === 0) return lido;
  return candidatos.sort((a, b) => b.length - a.length)[0];
}

/* =============================================================================
   Preferências do aparelho: tema e tamanho da letra
   ============================================================================= */
function lerPref(chave, padrao) { try { return localStorage.getItem(chave) || padrao; } catch (e) { return padrao; } }
function gravarPref(chave, valor) { try { localStorage.setItem(chave, valor); } catch (e) {} }

const PrefCtx = createContext(null);
function usePref() { return useContext(PrefCtx); }
function PrefProvider({ children }) {
  // versões antigas guardavam 'claro'/'escuro'
  const [tema, setTema] = useState(() => lerPref(CHAVE_TEMA, 'auto'));
  const [letra, setLetra] = useState(() => lerPref(CHAVE_LETRA, 'normal'));
  const [sistemaEscuro, setSistemaEscuro] = useState(() => window.matchMedia?.('(prefers-color-scheme: dark)').matches || false);

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return;
    const f = (e) => setSistemaEscuro(e.matches);
    mq.addEventListener ? mq.addEventListener('change', f) : mq.addListener(f);
    return () => (mq.removeEventListener ? mq.removeEventListener('change', f) : mq.removeListener(f));
  }, []);

  const escuro = tema === 'escuro' || (tema === 'auto' && sistemaEscuro);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', escuro);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', escuro ? '#0E1410' : '#F2F4EF');
    gravarPref(CHAVE_TEMA, tema);
  }, [escuro, tema]);
  useEffect(() => {
    document.documentElement.classList.toggle('letra-grande', letra === 'grande');
    gravarPref(CHAVE_LETRA, letra);
  }, [letra]);

  return <PrefCtx.Provider value={{ tema, setTema, letra, setLetra, escuro }}>{children}</PrefCtx.Provider>;
}

function useOnline() {
  const [online, setOnline] = useState(navigator.onLine !== false);
  useEffect(() => {
    const on = () => setOnline(true); const off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  return online;
}

/* =============================================================================
   Ícones (traço 2px, 24×24)
   ============================================================================= */
function Svg({ children, size = 22, className = '', strokeWidth = 2 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">{children}</svg>;
}
const I = {
  inicio: (p) => <Svg {...p}><path d="M4 10.5 12 4l8 6.5" /><path d="M6 9.5V19a1 1 0 0 0 1 1h3.5v-5h3v5H17a1 1 0 0 0 1-1V9.5" /></Svg>,
  relatorios: (p) => <Svg {...p}><path d="M5 20V12" /><path d="M12 20V5" /><path d="M19 20v-6" /></Svg>,
  fotos: (p) => <Svg {...p}><rect x="3.5" y="5" width="17" height="14" rx="2.5" /><circle cx="9" cy="10" r="1.6" /><path d="m20.5 16-4.5-4.5L7 19" /></Svg>,
  motoristas: (p) => <Svg {...p}><circle cx="9" cy="8.5" r="3.2" /><path d="M3.5 19c.8-3.4 3-5.2 5.5-5.2s4.7 1.8 5.5 5.2" /><path d="M16 5.6a3 3 0 0 1 0 5.8" /><path d="M17.5 13.9c1.6.6 2.6 2.2 3 5.1" /></Svg>,
  ajustes: (p) => <Svg {...p}><path d="M4 7h10" /><path d="M18 7h2" /><circle cx="16" cy="7" r="2" /><path d="M4 17h2" /><path d="M10 17h10" /><circle cx="8" cy="17" r="2" /></Svg>,
  mais: (p) => <Svg {...p}><path d="M12 5v14" /><path d="M5 12h14" /></Svg>,
  busca: (p) => <Svg {...p}><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></Svg>,
  fechar: (p) => <Svg {...p}><path d="M6 6l12 12" /><path d="M18 6 6 18" /></Svg>,
  check: (p) => <Svg {...p}><path d="m5 12.5 4.5 4.5L19 7.5" /></Svg>,
  camera: (p) => <Svg {...p}><path d="M4.5 8h2.8l1.6-2.2h6.2L16.7 8h2.8A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5v-8A1.5 1.5 0 0 1 4.5 8z" /><circle cx="12" cy="13.2" r="3.4" /></Svg>,
  galeria: (p) => <Svg {...p}><rect x="3.5" y="4.5" width="17" height="15" rx="2.5" /><circle cx="9" cy="9.5" r="1.6" /><path d="m20.5 15-4-4L8 19.5" /></Svg>,
  whats: (p) => <Svg {...p}><path d="M20 11.6a8 8 0 0 1-11.8 7L4 20l1.4-4.1A8 8 0 1 1 20 11.6z" /><path d="M9.2 8.8c.2 1.9 2.3 4.4 4.6 5.1l1.2-1.3 1.9 1" /></Svg>,
  telefone: (p) => <Svg {...p}><path d="M6.6 3.8 9 3.5l1.6 4-2 1.3a10.5 10.5 0 0 0 6.6 6.6l1.3-2 4 1.6-.3 2.4a2 2 0 0 1-2 1.6A15.3 15.3 0 0 1 5 5.8a2 2 0 0 1 1.6-2z" /></Svg>,
  lixo: (p) => <Svg {...p}><path d="M4.5 7h15" /><path d="M9.5 7V5h5v2" /><path d="M6.5 7l1 12.5h9l1-12.5" /></Svg>,
  lapis: (p) => <Svg {...p}><path d="M15.5 5.5l3 3L9 18l-4 1 1-4z" /><path d="m13.5 7.5 3 3" /></Svg>,
  seta: (p) => <Svg {...p}><path d="m9 6 6 6-6 6" /></Svg>,
  voltar: (p) => <Svg {...p}><path d="m15 6-6 6 6 6" /></Svg>,
  compartilhar: (p) => <Svg {...p}><path d="M12 4v11" /><path d="m7.5 8.5 4.5-4.5 4.5 4.5" /><path d="M5 13v5.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V13" /></Svg>,
  baixar: (p) => <Svg {...p}><path d="M12 4v11" /><path d="m7.5 10.5 4.5 4.5 4.5-4.5" /><path d="M5 19.5h14" /></Svg>,
  caminhao: (p) => <Svg {...p}><path d="M3 6.5h10.5v9.5H3z" /><path d="M13.5 9.5h4l3 3.5v3h-7" /><circle cx="7" cy="17.5" r="1.8" /><circle cx="17" cy="17.5" r="1.8" /></Svg>,
  semNet: (p) => <Svg {...p}><path d="M4 4l16 16" /><path d="M8.5 13.5a5 5 0 0 1 3.5-1.4" /><path d="M5 10.2a10 10 0 0 1 4-2.1" /><path d="M14 8.3a10 10 0 0 1 5 2" /><circle cx="12" cy="18" r="1" /></Svg>,
  sair: (p) => <Svg {...p}><path d="M14 5h4.5A1.5 1.5 0 0 1 20 6.5v11a1.5 1.5 0 0 1-1.5 1.5H14" /><path d="M10 16.5 5.5 12 10 7.5" /><path d="M5.5 12h10" /></Svg>,
  nota: (p) => <Svg {...p}><path d="M6 3.5h12v17l-2-1.3-2 1.3-2-1.3-2 1.3-2-1.3-2 1.3z" /><path d="M9 8h6" /><path d="M9 11.5h6" /><path d="M9 15h3.5" /></Svg>,
  ampliar: (p) => <Svg {...p}><path d="M14 4h6v6" /><path d="M20 4l-7 7" /><path d="M10 20H4v-6" /><path d="M4 20l7-7" /></Svg>,
  pessoa: (p) => <Svg {...p} strokeWidth={1.8}><circle cx="12" cy="8.5" r="3.8" /><path d="M4.5 20c1.1-4.2 4.2-6.5 7.5-6.5s6.4 2.3 7.5 6.5" /></Svg>,
};

/* =============================================================================
   Peças de interface
   ============================================================================= */
const FOCO = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';
const TOQUE = 'transition-transform duration-150 motion-safe:active:scale-[0.97]';
const INPUT = `w-full h-12 rounded-xl bg-surface border border-line px-3.5 text-base text-ink placeholder:text-muted/70 outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 transition-shadow`;

function Botao({ variante = 'primario', tamanho = 'g', icone, children, className = '', ...resto }) {
  const base = `inline-flex items-center justify-center gap-2 font-semibold rounded-xl select-none disabled:opacity-50 disabled:pointer-events-none ${TOQUE} ${FOCO}`;
  const tam = tamanho === 'g' ? 'h-12 px-5 text-base' : 'h-10 px-3.5 text-sm';
  const cor = {
    primario: 'bg-brand text-onbrand shadow-sm',
    secundario: 'bg-surface2 text-ink',
    contorno: 'border border-line bg-surface text-ink',
    perigo: 'bg-danger/10 text-danger',
    ouro: 'bg-gold text-ongold shadow-sm',
  }[variante];
  return <button className={`${base} ${tam} ${cor} ${className}`} {...resto}>{icone}{children}</button>;
}

function Campo({ rotulo, dica, children, extra }) {
  return (
    <label className="flex flex-col gap-1.5 min-w-0">
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-ink">{rotulo}</span>
        {extra}
      </span>
      {children}
      {dica && <span className="text-xs text-muted leading-snug">{dica}</span>}
    </label>
  );
}

function Segmentado({ opcoes, valor, onChange, tamanho = 'g' }) {
  return (
    <div className="flex p-1 rounded-xl bg-surface2 gap-1" role="radiogroup">
      {opcoes.map(([v, l]) => (
        <button key={v} type="button" role="radio" aria-checked={valor === v} onClick={() => { vibrar(8); onChange(v); }}
          className={`flex-1 rounded-lg font-semibold transition-colors ${tamanho === 'g' ? 'h-10 text-sm' : 'h-8 text-[0.8125rem]'} ${FOCO} ${valor === v ? 'bg-surface text-ink shadow-sm' : 'text-muted'}`}>
          {l}
        </button>
      ))}
    </div>
  );
}

const STATUS = {
  em_rota: { rotulo: 'Em rota', classe: 'bg-rota-bg text-rota-fg', ponto: 'bg-rota-fg' },
  pendente: { rotulo: 'A pagar', classe: 'bg-pagar-bg text-pagar-fg', ponto: 'bg-pagar-fg' },
  pago: { rotulo: 'Pago', classe: 'bg-pago-bg text-pago-fg', ponto: 'bg-pago-fg' },
};
const ORDEM_STATUS = [['em_rota', 'Em rota'], ['pendente', 'A pagar'], ['pago', 'Pago']];

function Selo({ status, pequeno }) {
  const s = STATUS[status] ?? STATUS.em_rota;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full font-semibold whitespace-nowrap ${pequeno ? 'text-xs px-2 py-0.5' : 'text-[0.8125rem] px-2.5 py-1'} ${s.classe}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.ponto}`} />{s.rotulo}
    </span>
  );
}

function Avatar({ url, nome, size = 44 }) {
  const s = { width: size, height: size };
  if (url) return <img src={url} alt="" style={s} className="rounded-full object-cover shrink-0 bg-surface2" />;
  const ini = String(nome || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
  return (
    <div style={{ ...s, fontSize: size * 0.36 }} className="rounded-full bg-surface2 text-muted flex items-center justify-center shrink-0 font-display font-bold">
      {ini || <I.pessoa size={Math.round(size * 0.55)} />}
    </div>
  );
}

function Vazio({ icone, titulo, texto, acao }) {
  return (
    <div className="flex flex-col items-center text-center px-6 py-14 gap-3">
      <div className="w-14 h-14 rounded-2xl bg-surface2 text-muted flex items-center justify-center">{icone}</div>
      <div className="font-display text-lg font-bold text-ink">{titulo}</div>
      {texto && <p className="text-sm text-muted max-w-xs leading-relaxed">{texto}</p>}
      {acao && <div className="mt-2">{acao}</div>}
    </div>
  );
}

function Secao({ titulo, direita, children, className = '' }) {
  return (
    <section className={className}>
      {(titulo || direita) && (
        <div className="flex items-baseline justify-between gap-3 mb-2.5 px-1">
          <h2 className="font-display text-lg font-bold text-ink">{titulo}</h2>
          {direita && <div className="text-sm text-muted">{direita}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

function Grupo({ children, className = '' }) {
  return <div className={`rounded-2xl bg-surface border border-line overflow-hidden divide-y divide-line ${className}`}>{children}</div>;
}

/* =============================================================================
   Botão "voltar" do celular fecha a janela aberta (em vez de sair do app)
   ============================================================================= */
const pilhaVoltar = [];
let ignorarPop = 0;
window.addEventListener('popstate', () => {
  if (ignorarPop > 0) { ignorarPop--; return; }
  const item = pilhaVoltar.pop();
  if (item) { item.viaVoltar = true; item.fechar(); }
});
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && pilhaVoltar.length) history.back(); });

function useVoltarFecha(fechar) {
  const ref = useRef(fechar); ref.current = fechar;
  useEffect(() => {
    const item = { fechar: () => ref.current(), viaVoltar: false };
    pilhaVoltar.push(item);
    try { history.pushState({ canalog: pilhaVoltar.length }, ''); } catch (e) {}
    return () => {
      const i = pilhaVoltar.indexOf(item);
      if (i !== -1) pilhaVoltar.splice(i, 1);
      if (!item.viaVoltar) { ignorarPop++; history.back(); }
    };
  }, []);
}

/* =============================================================================
   Folha (janela que sobe de baixo no celular; diálogo no computador)
   ============================================================================= */
function Folha({ titulo, onClose, children, rodape, tela = false }) {
  const [visivel, setVisivel] = useState(false);
  const [arrasto, setArrasto] = useState(0);
  const fechandoRef = useRef(false);
  const onCloseRef = useRef(onClose); onCloseRef.current = onClose;
  const inicioY = useRef(null);

  useEffect(() => { const r = requestAnimationFrame(() => setVisivel(true)); return () => cancelAnimationFrame(r); }, []);
  const fechar = useCallback(() => {
    if (fechandoRef.current) return;
    fechandoRef.current = true;
    setVisivel(false);
    setTimeout(() => onCloseRef.current(), 220);
  }, []);
  useVoltarFecha(fechar);

  const tocar = {
    onTouchStart: (e) => { inicioY.current = e.touches[0].clientY; },
    onTouchMove: (e) => { if (inicioY.current == null) return; setArrasto(Math.max(0, e.touches[0].clientY - inicioY.current)); },
    onTouchEnd: () => { if (arrasto > 110) fechar(); else setArrasto(0); inicioY.current = null; },
  };

  const transform = visivel ? `translateY(${arrasto}px)` : 'translateY(100%)';
  return (
    <div className="fixed inset-0 z-40 flex items-end md:items-center justify-center md:p-6">
      <div onClick={fechar} className={`absolute inset-0 bg-black/50 transition-opacity duration-200 ${visivel ? 'opacity-100' : 'opacity-0'}`} />
      <div role="dialog" aria-modal="true" aria-label={titulo}
        className={`relative w-full md:max-w-lg bg-bg md:bg-surface flex flex-col shadow-2xl ${tela ? 'h-[96%] md:h-[88%]' : 'max-h-[94%] md:max-h-[88%]'} rounded-t-[1.75rem] md:rounded-[1.75rem] ${inicioY.current == null ? 'transition-transform duration-200 ease-out' : ''}`}
        style={{ transform }}>
        <div {...tocar} className="shrink-0 touch-none">
          <div className="mx-auto mt-2.5 h-1.5 w-10 rounded-full bg-line md:hidden" />
          <div className="flex items-center gap-3 pl-5 pr-2.5 pt-2 pb-2 md:pt-4">
            <h2 className="flex-1 font-display text-xl font-bold text-ink truncate">{titulo}</h2>
            <button type="button" onClick={fechar} aria-label="Fechar" className={`w-11 h-11 rounded-full flex items-center justify-center text-muted bg-surface2 ${FOCO}`}><I.fechar size={20} /></button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain px-5 pb-5" style={rodape ? undefined : { paddingBottom: 'calc(env(safe-area-inset-bottom) + 1.25rem)' }}>
          {children}
        </div>
        {rodape && (
          <div className="shrink-0 border-t border-line bg-bg md:bg-surface px-5 pt-3 md:rounded-b-[1.75rem]" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 0.75rem)' }}>
            {rodape}
          </div>
        )}
      </div>
    </div>
  );
}

/* =============================================================================
   Avisos rápidos e confirmação
   ============================================================================= */
const ToastCtx = createContext(null);
function useToast() { return useContext(ToastCtx); }
function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const notificar = useCallback((msg, tipo = 'sucesso') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, msg, tipo }]);
    if (tipo === 'erro') vibrar([20, 60, 20]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tipo === 'erro' ? 5200 : 3200);
  }, []);
  return (
    <ToastCtx.Provider value={{ notificar }}>
      {children}
      <div className="fixed inset-x-0 z-[60] flex flex-col gap-2 items-center px-4 pointer-events-none" style={{ top: 'calc(env(safe-area-inset-top) + 0.75rem)' }} aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} role="status" className={`pointer-events-auto flex items-start gap-2.5 text-sm font-semibold pl-3.5 pr-4 py-3 rounded-2xl shadow-lg max-w-md w-full animate-entrar ${t.tipo === 'erro' ? 'bg-danger text-white' : 'bg-ink text-bg'}`}>
            <span className="mt-0.5 shrink-0">{t.tipo === 'erro' ? <I.fechar size={18} /> : <I.check size={18} />}</span>
            <span className="leading-snug">{t.msg}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

const ConfirmarCtx = createContext(null);
function useConfirmar() { return useContext(ConfirmarCtx); }
function ConfirmarProvider({ children }) {
  const [pedido, setPedido] = useState(null);
  const confirmar = useCallback((opts) => new Promise((resolve) => setPedido({ ...opts, resolve })), []);
  function responder(sim) { const p = pedido; setPedido(null); p?.resolve(sim); }
  return (
    <ConfirmarCtx.Provider value={confirmar}>
      {children}
      {pedido && (
        <Folha titulo={pedido.titulo} onClose={() => responder(false)}
          rodape={
            <div className="flex gap-2.5">
              <Botao variante="secundario" className="flex-1 !px-3" onClick={() => responder(false)}>{pedido.cancelar || 'Cancelar'}</Botao>
              <Botao variante={pedido.perigo ? 'perigo' : 'primario'} className={`flex-[1.6] !px-3 whitespace-nowrap ${pedido.perigo ? '!bg-danger !text-white' : ''}`} onClick={() => responder(true)}>{pedido.confirmar || 'Confirmar'}</Botao>
            </div>
          }>
          <p className="text-base text-muted leading-relaxed">{pedido.texto}</p>
        </Folha>
      )}
    </ConfirmarCtx.Provider>
  );
}

/* =============================================================================
   Camadas abertas por cima das telas (detalhes, formulários, fotos)
   ============================================================================= */
const UICtx = createContext(null);
function useUI() { return useContext(UICtx); }
function UIProvider({ children }) {
  const [camadas, setCamadas] = useState([]);
  const abrir = useCallback((tipo, props = {}) => setCamadas((c) => [...c, { id: Math.random().toString(36).slice(2), tipo, props }]), []);
  const fechar = useCallback((id) => setCamadas((c) => c.filter((x) => x.id !== id)), []);
  const api = useMemo(() => ({
    novaViagem: () => abrir('viagemForm'),
    editarViagem: (id) => abrir('viagemForm', { id }),
    verViagem: (id) => abrir('viagemDetalhe', { id }),
    novoMotorista: () => abrir('motoristaForm'),
    editarMotorista: (id) => abrir('motoristaForm', { id }),
    verMotorista: (id) => abrir('motoristaDetalhe', { id }),
    verFoto: (id) => abrir('foto', { id }),
  }), [abrir]);
  const MAPA = { viagemForm: FormViagem, viagemDetalhe: DetalheViagem, motoristaForm: FormMotorista, motoristaDetalhe: DetalheMotorista, foto: VisorFoto };
  return (
    <UICtx.Provider value={api}>
      {children}
      {camadas.map((c) => { const C = MAPA[c.tipo]; return <C key={c.id} {...c.props} onClose={() => fechar(c.id)} />; })}
    </UICtx.Provider>
  );
}

/* =============================================================================
   Linha de viagem (usada nas listas)
   ============================================================================= */
function LinhaViagem({ v, mostrarData }) {
  const ui = useUI();
  return (
    <button onClick={() => ui.verViagem(v.id)} className={`w-full text-left flex items-center gap-3 px-4 py-3.5 bg-surface active:bg-surface2 transition-colors ${FOCO}`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-semibold text-ink truncate">{v.produtor}</span>
        </div>
        <div className="text-sm text-muted truncate mt-0.5">
          {mostrarData ? `${fmtDataCurta(v.data)} · ` : ''}{v.motoristaNome}{v.destino ? ` → ${v.destino}` : ''}
        </div>
      </div>
      <div className="flex flex-col items-end gap-1 shrink-0">
        <span className="font-bold text-ink tabular-nums">{fmtTon(v.toneladas)}</span>
        <Selo status={v.status} pequeno />
      </div>
    </button>
  );
}

/* =============================================================================
   Tela: Início
   ============================================================================= */
function Painel() {
  const { viagens } = useApp();
  const safra = safraDe();
  const hoje = isoLocal();
  const r = useMemo(() => {
    const daSafra = viagens.filter((v) => v.data >= safra.inicio && v.data <= safra.fim);
    const soma = (lista, campo) => lista.reduce((s, v) => s + (v[campo] || 0), 0);
    const porStatus = (st) => daSafra.filter((v) => v.status === st);
    const deHoje = viagens.filter((v) => v.data === hoje);
    return {
      qtd: daSafra.length, ton: soma(daSafra, 'toneladas'),
      aPagar: soma(porStatus('pendente'), 'valor'), pago: soma(porStatus('pago'), 'valor'), emRota: soma(porStatus('em_rota'), 'valor'),
      qtdAPagar: porStatus('pendente').length,
      hojeQtd: deHoje.length, hojeTon: soma(deHoje, 'toneladas'), hojeValor: soma(deHoje, 'valor'),
    };
  }, [viagens, safra.inicio, hoje]);
  const total = r.aPagar + r.pago + r.emRota;
  const partes = [
    { chave: 'pago', rotulo: 'Pago', valor: r.pago, cor: 'bg-white/90' },
    { chave: 'pendente', rotulo: 'A pagar', valor: r.aPagar, cor: 'bg-gold' },
    { chave: 'em_rota', rotulo: 'Em rota', valor: r.emRota, cor: 'bg-white/30' },
  ];

  return (
    <section className="rounded-[1.75rem] bg-hero text-white p-5 pb-4 relative overflow-hidden">
      <svg className="absolute -right-6 -top-4 text-white/[0.06] pointer-events-none" width="190" height="190" viewBox="0 0 100 100" aria-hidden="true">
        <path d="M30 100 C34 66 40 34 52 0" stroke="currentColor" strokeWidth="5" fill="none" /><path d="M50 100 C52 70 58 40 74 6" stroke="currentColor" strokeWidth="5" fill="none" />
        <path d="M70 100 C70 76 76 52 92 22" stroke="currentColor" strokeWidth="5" fill="none" />
      </svg>
      <div className="flex items-center justify-between text-sm text-white/75 relative">
        <span className="font-semibold">{safra.rotulo}</span>
        <span>{plural(r.qtd, 'viagem', 'viagens')}</span>
      </div>
      <div className="mt-3 relative">
        <span className="font-display font-bold leading-none tracking-tight tabular-nums" style={{ fontSize: '3rem' }}>{fmtNum(r.ton)}</span>
        <span className="font-display text-xl font-semibold text-white/70 ml-1.5">t</span>
      </div>
      <div className="text-sm text-white/75 mt-1 relative">transportadas · {fmtBRL(total)} em fretes</div>

      <div className="mt-5 flex h-2.5 rounded-full overflow-hidden gap-[2px] bg-white/10 relative" role="img" aria-label={`Pago ${fmtBRL(r.pago)}, a pagar ${fmtBRL(r.aPagar)}, em rota ${fmtBRL(r.emRota)}`}>
        {total > 0 && partes.filter((p) => p.valor > 0).map((p) => <div key={p.chave} className={p.cor} style={{ width: `${(p.valor / total) * 100}%` }} />)}
      </div>
      <div className="mt-3 flex flex-col gap-1.5 relative">
        {partes.map((p) => (
          <div key={p.chave} className="flex items-center gap-2 text-sm">
            <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${p.cor}`} />
            <span className="text-white/75">{p.rotulo}</span>
            <span className="flex-1 border-b border-dotted border-white/20 -translate-y-1" />
            <span className="font-semibold tabular-nums whitespace-nowrap">{fmtBRL(p.valor)}</span>
          </div>
        ))}
      </div>

      <div className="mt-4 pt-3.5 border-t border-white/15 flex items-center justify-between gap-3 text-sm relative">
        <span className="text-white/75">Hoje</span>
        <span className="font-semibold tabular-nums">
          {r.hojeQtd === 0 ? 'nenhuma viagem ainda' : `${plural(r.hojeQtd, 'viagem', 'viagens')} · ${fmtTon(r.hojeTon)} · ${fmtBRL(r.hojeValor)}`}
        </span>
      </div>
    </section>
  );
}

function TelaInicio() {
  const { viagens, motoristas } = useApp();
  const ui = useUI();
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState('todas');
  const [limite, setLimite] = useState(60);

  const contagem = useMemo(() => {
    const c = { todas: viagens.length, em_rota: 0, pendente: 0, pago: 0 };
    for (const v of viagens) c[v.status] = (c[v.status] || 0) + 1;
    return c;
  }, [viagens]);

  const filtradas = useMemo(() => {
    const q = normalizar(busca);
    return viagens.filter((v) => (filtro === 'todas' || v.status === filtro) &&
      (!q || normalizar(`${v.produtor} ${v.motoristaNome} ${v.destino} ${v.placa}`).includes(q)));
  }, [viagens, busca, filtro]);

  const grupos = useMemo(() => {
    const mapa = new Map();
    for (const v of filtradas.slice(0, limite)) {
      if (!mapa.has(v.data)) mapa.set(v.data, []);
      mapa.get(v.data).push(v);
    }
    return [...mapa.entries()];
  }, [filtradas, limite]);

  const chips = [['todas', 'Todas'], ['em_rota', 'Em rota'], ['pendente', 'A pagar'], ['pago', 'Pago']];

  return (
    <div className="flex flex-col gap-6">
      <Painel />

      {motoristas.length === 0 && (
        <button onClick={ui.novoMotorista} className={`flex items-center gap-3 text-left rounded-2xl border border-dashed border-brandink/40 bg-brand/5 px-4 py-3.5 ${TOQUE} ${FOCO}`}>
          <span className="w-10 h-10 rounded-full bg-brand text-onbrand flex items-center justify-center shrink-0"><I.motoristas size={20} /></span>
          <span className="flex-1"><span className="block font-semibold text-ink">Comece cadastrando os motoristas</span><span className="block text-sm text-muted">Com o nº deles, o app reconhece quem fez a viagem pela nota.</span></span>
          <I.seta className="text-muted" />
        </button>
      )}

      <Secao titulo="Viagens" direita={filtradas.length !== viagens.length ? `${filtradas.length} de ${viagens.length}` : plural(viagens.length, 'viagem', 'viagens')}>
        <div className="sticky top-0 z-10 -mx-4 px-4 pt-1 pb-3 bg-bg/95 backdrop-blur-sm flex flex-col gap-2.5">
          <div className="relative">
            <I.busca size={19} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
            <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar viagens"
              className={`${INPUT} pl-10 pr-10`} enterKeyHint="search" />
            {busca && <button onClick={() => setBusca('')} aria-label="Limpar busca" className="absolute right-1.5 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full flex items-center justify-center text-muted"><I.fechar size={17} /></button>}
          </div>
          <div className="flex gap-1.5 overflow-x-auto -mx-4 px-4 pb-0.5 [scrollbar-width:none]">
            {chips.map(([k, l]) => (
              <button key={k} onClick={() => { setFiltro(k); vibrar(8); }} aria-pressed={filtro === k}
                className={`h-9 px-3 rounded-full text-sm font-semibold whitespace-nowrap border transition-colors ${FOCO} ${filtro === k ? 'bg-ink text-bg border-ink' : 'bg-surface text-ink border-line'}`}>
                {l}<span className={`ml-1 tabular-nums ${filtro === k ? 'text-bg/70' : 'text-muted'}`}>{contagem[k] || 0}</span>
              </button>
            ))}
          </div>
        </div>

        {viagens.length === 0 ? (
          <Vazio icone={<I.caminhao size={28} />} titulo="Nenhuma viagem ainda" texto="Registre a primeira tirando uma foto da nota de pesagem — o app preenche o resto."
            acao={<Botao variante="ouro" icone={<I.mais size={20} />} onClick={ui.novaViagem}>Registrar viagem</Botao>} />
        ) : filtradas.length === 0 ? (
          <Vazio icone={<I.busca size={26} />} titulo="Nada encontrado" texto="Tente outra palavra ou mude o filtro." acao={<Botao variante="secundario" tamanho="p" onClick={() => { setBusca(''); setFiltro('todas'); }}>Limpar filtros</Botao>} />
        ) : (
          <div className="flex flex-col gap-5">
            {grupos.map(([data, itens]) => {
              const ton = itens.reduce((s, v) => s + v.toneladas, 0);
              return (
                <div key={data}>
                  <div className="flex items-baseline justify-between px-1 mb-2">
                    <span className="text-sm font-bold text-ink">{rotuloDia(data)}</span>
                    <span className="text-sm text-muted tabular-nums">{plural(itens.length, 'viagem', 'viagens')} · {fmtTon(ton)}</span>
                  </div>
                  <Grupo>{itens.map((v) => <LinhaViagem key={v.id} v={v} />)}</Grupo>
                </div>
              );
            })}
            {filtradas.length > limite && <Botao variante="secundario" onClick={() => setLimite((l) => l + 60)}>Mostrar mais viagens</Botao>}
          </div>
        )}
      </Secao>
    </div>
  );
}

/* =============================================================================
   Formulário: nova viagem / editar viagem (com leitura da nota)
   ============================================================================= */
function SeletorMotorista({ valor, onChange }) {
  const { motoristas } = useApp();
  const ui = useUI();
  const ativos = motoristas.filter((m) => m.ativo || m.id === valor);
  if (ativos.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-line p-4 text-sm text-muted flex items-center justify-between gap-3">
        <span>Nenhum motorista cadastrado.</span>
        <Botao type="button" variante="secundario" tamanho="p" onClick={ui.novoMotorista}>Cadastrar</Botao>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-2">
      {ativos.map((m) => {
        const sel = valor === m.id;
        return (
          <button key={m.id} type="button" onClick={() => { onChange(m.id); vibrar(8); }} aria-pressed={sel}
            className={`flex items-center gap-2.5 p-2.5 rounded-xl border text-left transition-colors ${FOCO} ${sel ? 'border-brand bg-brand/10 ring-1 ring-brand' : 'border-line bg-surface'}`}>
            <Avatar url={m.fotoUrl} nome={m.nome} size={36} />
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-ink truncate">{m.nome.split(' ')[0]}{m.nome.split(' ')[1] ? ` ${m.nome.split(' ')[1][0]}.` : ''}</span>
              <span className="block text-xs text-muted truncate">{m.placa || (m.numero ? `nº ${m.numero}` : 'sem placa')}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function BlocoNota({ preview, lendo, progresso, onArquivo }) {
  const cameraRef = useRef(null);
  const galeriaRef = useRef(null);
  const escolher = (e) => { const a = e.target.files?.[0]; e.target.value = ''; if (a) onArquivo(a); };
  return (
    <div className="rounded-2xl bg-surface border border-line p-3.5">
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" onChange={escolher} className="hidden" />
      <input ref={galeriaRef} type="file" accept="image/*" onChange={escolher} className="hidden" />
      {preview ? (
        <div className="flex items-center gap-3">
          <img src={preview} alt="Nota anexada" className="w-16 h-16 rounded-xl object-cover bg-surface2 shrink-0" />
          <div className="flex-1 min-w-0">
            {lendo ? (
              <>
                <div className="text-sm font-semibold text-ink">{progresso?.texto || 'Lendo a nota…'}</div>
                <div className="mt-2 h-1.5 rounded-full bg-surface2 overflow-hidden"><div className="h-full bg-brand transition-all duration-300" style={{ width: `${Math.max(6, progresso?.pct || 0)}%` }} /></div>
              </>
            ) : (
              <>
                <div className="text-sm font-semibold text-ink">Nota anexada</div>
                <div className="text-xs text-muted mt-0.5">Confira os campos abaixo antes de salvar.</div>
              </>
            )}
          </div>
          {!lendo && <Botao type="button" variante="secundario" tamanho="p" onClick={() => cameraRef.current?.click()}>Trocar</Botao>}
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          <div className="flex items-start gap-3 px-0.5">
            <span className="w-10 h-10 rounded-xl bg-gold/20 text-ink flex items-center justify-center shrink-0"><I.nota size={21} /></span>
            <div>
              <div className="font-semibold text-ink">Foto da nota de pesagem</div>
              <div className="text-sm text-muted leading-snug">O app lê a nota e preenche fazenda, usina, peso, data e motorista.</div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Botao type="button" variante="ouro" icone={<I.camera size={20} />} onClick={() => cameraRef.current?.click()}>Tirar foto</Botao>
            <Botao type="button" variante="secundario" icone={<I.galeria size={20} />} onClick={() => galeriaRef.current?.click()}>Galeria</Botao>
          </div>
        </div>
      )}
    </div>
  );
}

const TEXTO_PROGRESSO = {
  'loading tesseract core': 'Preparando o leitor…',
  'initializing tesseract': 'Preparando o leitor…',
  'loading language traineddata': 'Carregando o português…',
  'initializing api': 'Quase lá…',
  'recognizing text': 'Lendo a nota…',
};

function FormViagem({ id, onClose }) {
  const app = useApp();
  const { motoristas, viagens, valorPorTonelada, produtoresConhecidos, destinosConhecidos } = app;
  const { notificar } = useToast();
  const confirmar = useConfirmar();
  const existente = id ? viagens.find((v) => v.id === id) : null;
  const editando = Boolean(existente);
  const ativos = motoristas.filter((m) => m.ativo);

  const [produtor, setProdutor] = useState(existente?.produtor ?? '');
  const [motoristaId, setMotoristaId] = useState(existente?.motoristaId ?? (ativos.length === 1 ? ativos[0].id : ''));
  const [destino, setDestino] = useState(existente?.destino ?? '');
  const [toneladas, setToneladas] = useState(existente ? fmtNum(existente.toneladas, 0, 2) : '');
  const [data, setData] = useState(existente?.data ?? isoLocal());
  const [status, setStatus] = useState(existente?.status ?? 'pendente');
  const [salvando, setSalvando] = useState(false);
  const [nota, setNota] = useState(null);
  const [preview, setPreview] = useState(null);
  const [lendo, setLendo] = useState(false);
  const [progresso, setProgresso] = useState(null);
  const [lidos, setLidos] = useState({});
  const fecharRef = useRef(null);

  const t = parseNum(toneladas);
  const tValida = Number.isFinite(t) && t > 0;
  const valor = tValida ? t * valorPorTonelada : 0;

  async function lerNota(arquivo) {
    setNota(arquivo);
    setPreview(URL.createObjectURL(arquivo));
    setLendo(true);
    setProgresso({ texto: 'Preparando o leitor…', pct: 4 });
    window.__ocrOnProgress = (m) => {
      if (!m?.status) return;
      const base = { 'loading tesseract core': 5, 'initializing tesseract': 15, 'loading language traineddata': 20, 'initializing api': 35, 'recognizing text': 40 }[m.status] ?? 10;
      const pct = m.status === 'recognizing text' ? 40 + (m.progress || 0) * 60 : base + (m.progress || 0) * 10;
      setProgresso({ texto: TEXTO_PROGRESSO[m.status] || 'Lendo a nota…', pct });
    };
    try {
      const reduzida = await comprimirImagem(arquivo, 2400, 0.92);
      const comLimite = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout_ocr')), ms))]);
      const texto = await comLimite(reconhecerTextoDaImagem(reduzida), 60000);
      const lido = extrairDadosDaNota(texto);
      const marcados = {};
      if (lido.produtor) { setProdutor(encaixarNoConhecido(lido.produtor, produtoresConhecidos)); marcados.produtor = true; }
      if (lido.destino) { setDestino(encaixarNoConhecido(lido.destino, destinosConhecidos)); marcados.destino = true; }
      if (lido.toneladas != null) { setToneladas(fmtNum(lido.toneladas, 0, 2)); marcados.toneladas = true; }
      if (lido.data) { setData(lido.data); marcados.data = true; }
      let aviso = '';
      if (lido.numeroMotorista || lido.numeroVeiculo) {
        const achado = motoristas.find((m) => mesmoNumero(m.numero, lido.numeroMotorista)) || motoristas.find((m) => mesmoNumero(m.numeroVeiculo, lido.numeroVeiculo));
        if (achado) { setMotoristaId(achado.id); marcados.motorista = true; }
        else aviso = `Motorista nº ${lido.numeroMotorista ?? '?'} não está cadastrado — escolha abaixo.`;
      }
      setLidos(marcados);
      if (Object.keys(marcados).length) { vibrar(15); notificar(aviso || 'Nota lida. Confira os campos antes de salvar.', aviso ? 'erro' : 'sucesso'); }
      else notificar('Não consegui ler os dados dessa foto. Tente uma foto mais reta e com luz, ou preencha à mão.', 'erro');
    } catch (err) {
      console.error(err);
      if (err?.message === 'timeout_ocr') window.__ocrWorkerPromise = null;
      notificar(err?.message === 'timeout_ocr' ? 'A leitura demorou demais. Preencha à mão — a foto continua anexada.' : 'Não consegui ler a nota. Preencha à mão — a foto continua anexada.', 'erro');
    } finally {
      window.__ocrOnProgress = null;
      setLendo(false);
    }
  }

  async function salvar(e) {
    e?.preventDefault();
    if (!produtor.trim()) { notificar('Preencha a fazenda / produtor.', 'erro'); return; }
    if (!tValida) { notificar('Preencha as toneladas (ex: 79,37).', 'erro'); return; }
    if (!editando && ativos.length > 0 && !motoristaId) { notificar('Escolha o motorista.', 'erro'); return; }
    if (t > 120 && !(await confirmar({ titulo: 'Peso alto', texto: `${fmtTon(t)} numa viagem só? Confira se não faltou a vírgula.`, confirmar: 'Está certo' }))) return;
    if (!editando) {
      const dup = viagens.find((v) => v.data === data && v.motoristaId === (motoristaId || null) && Math.abs(v.toneladas - t) < 0.005);
      if (dup && !(await confirmar({ titulo: 'Parece repetida', texto: `Já existe uma viagem de ${dup.motoristaNome} em ${fmtDataCurta(data)} com ${fmtTon(t)}. Registrar outra igual mesmo assim?`, confirmar: 'Registrar mesmo assim' }))) return;
    }
    setSalvando(true);
    try {
      const dados = { produtor: produtor.trim(), destino: destino.trim(), toneladas: t, data, status };
      if (editando) {
        await app.editarViagem(existente.id, { ...dados, motoristaId: motoristaId || null });
        notificar('Viagem atualizada.');
      } else {
        const nova = await app.registrarViagem({ ...dados, motoristaId: motoristaId || null });
        if (nota) {
          try { await app.enviarFoto({ viagemId: nova.id, arquivo: nota, observacao: 'Nota de pesagem' }); }
          catch (err) { console.error(err); notificar('Viagem salva, mas a foto não subiu. Abra a viagem e adicione de novo.', 'erro'); fecharRef.current?.(); return; }
        }
        vibrar(20);
        notificar('Viagem registrada.');
      }
      fecharRef.current?.();
    } catch (err) {
      console.error(err);
      notificar('Não consegui salvar. Confira a internet e tente de novo.', 'erro');
    } finally {
      setSalvando(false);
    }
  }

  const marca = (k) => (lidos[k] ? <span className="text-xs font-semibold text-brandink inline-flex items-center gap-1"><I.check size={14} />lido da nota</span> : null);

  return (
    <FolhaComFechar onClose={onClose} fecharRef={fecharRef} titulo={editando ? 'Editar viagem' : 'Nova viagem'} tela
      rodape={
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-xs text-muted truncate">{tValida ? `${fmtTon(t)} × ${fmtBRL(valorPorTonelada)}` : 'Valor da viagem'}</div>
            <div className="font-display text-xl font-bold text-ink tabular-nums">{fmtBRL(valor)}</div>
          </div>
          <Botao onClick={salvar} disabled={salvando || lendo} className="min-w-[9.5rem]">{salvando ? 'Salvando…' : editando ? 'Salvar' : 'Registrar'}</Botao>
        </div>
      }>
      <form onSubmit={salvar} className="flex flex-col gap-5 pt-1">
        {!editando && <BlocoNota preview={preview} lendo={lendo} progresso={progresso} onArquivo={lerNota} />}

        <Campo rotulo="Motorista" extra={marca('motorista')}>
          <SeletorMotorista valor={motoristaId} onChange={setMotoristaId} />
        </Campo>

        <Campo rotulo="Fazenda / produtor" extra={marca('produtor')}>
          <input className={INPUT} list="lista-produtores" value={produtor} onChange={(e) => setProdutor(e.target.value)} placeholder="Ex: Faz Americana" autoComplete="off" />
          <datalist id="lista-produtores">{produtoresConhecidos.map((p) => <option key={p} value={p} />)}</datalist>
        </Campo>

        <Campo rotulo="Usina (destino)" extra={marca('destino')}>
          <input className={INPUT} list="lista-destinos" value={destino} onChange={(e) => setDestino(e.target.value)} placeholder="Ex: Usina Santa Rita" autoComplete="off" />
          <datalist id="lista-destinos">{destinosConhecidos.map((d) => <option key={d} value={d} />)}</datalist>
        </Campo>

        <div className="grid grid-cols-2 gap-3">
          <Campo rotulo="Toneladas" extra={marca('toneladas')}>
            <input className={`${INPUT} tabular-nums`} inputMode="decimal" value={toneladas} onChange={(e) => setToneladas(e.target.value.replace(/[^\d.,]/g, ''))} placeholder="79,37" />
          </Campo>
          <Campo rotulo="Data" extra={marca('data')}>
            <input className={INPUT} type="date" value={data} max={somarDias(isoLocal(), 1)} onChange={(e) => setData(e.target.value)} />
          </Campo>
        </div>

        <Campo rotulo="Situação do pagamento">
          <Segmentado opcoes={ORDEM_STATUS} valor={status} onChange={setStatus} />
        </Campo>
        <button type="submit" className="hidden" />
      </form>
    </FolhaComFechar>
  );
}

// Folha que expõe a função de fechar animada pra quem está dentro dela
function FolhaComFechar({ fecharRef, onClose, ...props }) {
  return <Folha {...props} onClose={onClose}><FecharExpor fecharRef={fecharRef} />{props.children}</Folha>;
}
function FecharExpor({ fecharRef }) {
  // a Folha fecha pelo botão "voltar"; history.back() dispara a animação certinho
  fecharRef.current = () => history.back();
  return null;
}

/* =============================================================================
   Detalhe da viagem
   ============================================================================= */
function LinhaNota({ rotulo, valor, forte }) {
  return (
    <div className="flex items-baseline gap-2 py-2">
      <span className="text-sm text-muted shrink-0">{rotulo}</span>
      <span className="flex-1 border-b-2 border-dotted border-line/80 -translate-y-1" />
      <span className={`text-right tabular-nums min-w-0 truncate ${forte ? 'font-display text-lg font-bold text-ink' : 'text-sm font-semibold text-ink'}`}>{valor}</span>
    </div>
  );
}

function DetalheViagem({ id, onClose }) {
  const app = useApp();
  const ui = useUI();
  const { notificar } = useToast();
  const confirmar = useConfirmar();
  const v = app.viagens.find((x) => x.id === id);
  const fotosDaViagem = app.fotos.filter((f) => f.viagemId === id);
  const motorista = v ? app.motoristas.find((m) => m.id === v.motoristaId) : null;
  const inputRef = useRef(null);
  const fecharRef = useRef(null);
  const [enviando, setEnviando] = useState(false);
  const [mudando, setMudando] = useState(false);

  useEffect(() => { if (!v) onClose(); }, [v]);
  if (!v) return null;

  async function mudarStatus(st) {
    if (st === v.status || mudando) return;
    setMudando(true);
    try { await app.marcarStatus([v.id], st); vibrar(12); notificar(st === 'pago' ? 'Marcada como paga.' : `Situação: ${STATUS[st].rotulo}.`); }
    catch (e) { notificar('Não consegui mudar. Confira a internet.', 'erro'); }
    finally { setMudando(false); }
  }
  async function addFoto(e) {
    const a = e.target.files?.[0]; e.target.value = '';
    if (!a) return;
    setEnviando(true);
    try { await app.enviarFoto({ viagemId: v.id, arquivo: a, observacao: 'Comprovante' }); notificar('Foto adicionada.'); }
    catch (err) { notificar('A foto não subiu. Confira a internet.', 'erro'); }
    finally { setEnviando(false); }
  }
  async function excluir() {
    const ok = await confirmar({ titulo: 'Excluir viagem?', texto: `A viagem de ${v.motoristaNome} em ${fmtDataCurta(v.data)} (${fmtTon(v.toneladas)}) e as fotos dela serão apagadas. Não dá pra desfazer.`, confirmar: 'Excluir', perigo: true });
    if (!ok) return;
    try { await app.removerViagem(v.id); notificar('Viagem excluída.'); }
    catch (e) { notificar('Não consegui excluir. Confira a internet.', 'erro'); }
  }

  return (
    <FolhaComFechar onClose={onClose} fecharRef={fecharRef} titulo={v.produtor}
      rodape={
        <div className="flex gap-2.5">
          <Botao variante="perigo" className="w-12 !px-0" aria-label="Excluir viagem" onClick={excluir}><I.lixo size={20} /></Botao>
          <Botao variante="secundario" className="flex-1 !px-3 whitespace-nowrap" icone={<I.lapis size={19} />} onClick={() => ui.editarViagem(v.id)}>Editar</Botao>
          {v.status !== 'pago' && <Botao className="flex-[1.35] !px-3 whitespace-nowrap" icone={<I.check size={19} />} onClick={() => mudarStatus('pago')} disabled={mudando}>Marcar pago</Botao>}
        </div>
      }>
      <div className="flex flex-col gap-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="font-display text-3xl font-bold text-ink tabular-nums leading-tight">{fmtBRL(v.valor)}</div>
            <div className="text-sm text-muted mt-0.5">{rotuloDia(v.data) === 'Hoje' || rotuloDia(v.data) === 'Ontem' ? `${rotuloDia(v.data)}, ${fmtDataCurta(v.data)}` : fmtDataLonga(v.data)}</div>
          </div>
          <Selo status={v.status} />
        </div>

        <Segmentado opcoes={ORDEM_STATUS} valor={v.status} onChange={mudarStatus} />

        <div className="rounded-2xl bg-surface border border-line px-4 py-2">
          <LinhaNota rotulo="Motorista" valor={v.motoristaNome} />
          {v.placa && <LinhaNota rotulo="Placa" valor={v.placa} />}
          <LinhaNota rotulo="Fazenda" valor={v.produtor} />
          <LinhaNota rotulo="Usina" valor={v.destino || '—'} />
          <LinhaNota rotulo="Peso líquido" valor={fmtTon(v.toneladas)} />
          <LinhaNota rotulo="Valor por tonelada" valor={v.toneladas > 0 ? fmtBRL(v.valor / v.toneladas) : '—'} />
          <LinhaNota rotulo="Total" valor={fmtBRL(v.valor)} forte />
        </div>

        {motorista && (
          <button onClick={() => ui.verMotorista(motorista.id)} className={`flex items-center gap-3 rounded-2xl bg-surface border border-line px-4 py-3 text-left ${FOCO}`}>
            <Avatar url={motorista.fotoUrl} nome={motorista.nome} size={40} />
            <span className="flex-1 min-w-0"><span className="block font-semibold text-ink truncate">{motorista.nome}</span><span className="block text-sm text-muted">Ver motorista e acerto</span></span>
            <I.seta className="text-muted" />
          </button>
        )}

        <Secao titulo="Comprovantes" direita={fotosDaViagem.length ? plural(fotosDaViagem.length, 'foto', 'fotos') : null}>
          <input ref={inputRef} type="file" accept="image/*" onChange={addFoto} className="hidden" />
          <div className="grid grid-cols-3 gap-2">
            {fotosDaViagem.map((f) => (
              <button key={f.id} onClick={() => ui.verFoto(f.id)} className={`aspect-square rounded-xl overflow-hidden bg-surface2 ${FOCO}`}>
                {f.url ? <img src={f.url} alt={f.observacao || 'Comprovante'} className="w-full h-full object-cover" loading="lazy" /> : <span className="text-xs text-muted">sem imagem</span>}
              </button>
            ))}
            <button onClick={() => inputRef.current?.click()} disabled={enviando} className={`aspect-square rounded-xl border-2 border-dashed border-line text-muted flex flex-col items-center justify-center gap-1 text-xs font-semibold ${FOCO}`}>
              {enviando ? 'Enviando…' : <><I.mais size={22} />Adicionar</>}
            </button>
          </div>
        </Secao>
      </div>
    </FolhaComFechar>
  );
}

/* =============================================================================
   Visor de foto (tela cheia)
   ============================================================================= */
function VisorFoto({ id, onClose }) {
  const app = useApp();
  const ui = useUI();
  const confirmar = useConfirmar();
  const { notificar } = useToast();
  const f = app.fotos.find((x) => x.id === id);
  const v = f ? app.viagens.find((x) => x.id === f.viagemId) : null;
  const [visivel, setVisivel] = useState(false);
  const [zoom, setZoom] = useState(false);
  const onCloseRef = useRef(onClose); onCloseRef.current = onClose;
  const fechandoRef = useRef(false);
  const fechar = useCallback(() => { if (fechandoRef.current) return; fechandoRef.current = true; setVisivel(false); setTimeout(() => onCloseRef.current(), 180); }, []);
  useVoltarFecha(fechar);
  useEffect(() => { const r = requestAnimationFrame(() => setVisivel(true)); return () => cancelAnimationFrame(r); }, []);
  useEffect(() => { if (!f) onClose(); }, [f]);
  if (!f) return null;

  async function apagar() {
    if (!(await confirmar({ titulo: 'Apagar esta foto?', texto: 'O comprovante será removido da viagem. Não dá pra desfazer.', confirmar: 'Apagar', perigo: true }))) return;
    try { await app.removerFoto(f); notificar('Foto apagada.'); } catch (e) { notificar('Não consegui apagar. Confira a internet.', 'erro'); }
  }

  return (
    <div className={`fixed inset-0 z-50 bg-black flex flex-col transition-opacity duration-200 ${visivel ? 'opacity-100' : 'opacity-0'}`}>
      <div className="flex items-center gap-2 px-2 text-white shrink-0" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.5rem)' }}>
        <button onClick={fechar} aria-label="Fechar" className="w-11 h-11 rounded-full flex items-center justify-center bg-white/10"><I.fechar size={20} /></button>
        <div className="flex-1 min-w-0 px-1">
          <div className="font-semibold truncate">{v?.produtor || 'Viagem removida'}</div>
          <div className="text-sm text-white/70 truncate">{v ? `${fmtDataMedia(v.data)} · ${v.motoristaNome}` : ''}</div>
        </div>
        {f.url && <a href={f.url} target="_blank" rel="noopener" aria-label="Abrir em tamanho real" className="w-11 h-11 rounded-full flex items-center justify-center bg-white/10"><I.ampliar size={19} /></a>}
        <button onClick={apagar} aria-label="Apagar foto" className="w-11 h-11 rounded-full flex items-center justify-center bg-white/10"><I.lixo size={19} /></button>
      </div>
      <div className={`flex-1 min-h-0 ${zoom ? 'overflow-auto' : 'overflow-hidden flex items-center justify-center'}`} onClick={() => setZoom((z) => !z)}>
        {f.url ? <img src={f.url} alt={f.observacao || 'Comprovante'} className={zoom ? 'max-w-none w-[220%]' : 'max-w-full max-h-full object-contain'} />
          : <span className="text-white/60 text-sm">Imagem indisponível</span>}
      </div>
      <div className="shrink-0 px-4 pt-3 text-center text-sm text-white/60" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 0.75rem)' }}>
        {zoom ? 'Toque para afastar' : 'Toque na foto para aproximar'}
        {v && <button onClick={() => ui.verViagem(v.id)} className="block mx-auto mt-2 h-10 px-4 rounded-full bg-white/10 text-white font-semibold">Abrir viagem</button>}
      </div>
    </div>
  );
}

/* =============================================================================
   Tela: Relatórios
   ============================================================================= */
const PERIODOS = [['hoje', 'Hoje'], ['7', '7 dias'], ['30', '30 dias'], ['safra', 'Safra']];

function GraficoBarras({ barras, formatar, rotuloVazio }) {
  const [sel, setSel] = useState(null);
  const max = Math.max(0.0001, ...barras.map((b) => b.valor));
  const temDado = barras.some((b) => b.valor > 0);
  const atual = sel != null ? barras[sel] : null;
  const pico = barras.reduce((m, b, i) => (b.valor > (barras[m]?.valor ?? -1) ? i : m), 0);
  const poucas = barras.length <= 12;
  return (
    <div>
      <div className="h-6 text-sm text-muted mb-2 tabular-nums">
        {atual ? <><span className="font-semibold text-ink">{atual.rotuloLongo}</span> · {formatar(atual.valor)}</> : temDado ? <>Maior: <span className="font-semibold text-ink">{barras[pico].rotuloLongo}</span> · {formatar(barras[pico].valor)}</> : rotuloVazio}
      </div>
      <div className="flex items-end h-36 gap-[2px] border-b border-line" onMouseLeave={() => setSel(null)}>
        {barras.map((b, i) => (
          <button key={i} type="button" onClick={() => setSel(sel === i ? null : i)} onMouseEnter={() => setSel(i)} aria-label={`${b.rotuloLongo}: ${formatar(b.valor)}`}
            className="flex-1 h-full flex items-end justify-center group">
            <span className={`w-full ${poucas ? 'max-w-[2.25rem]' : ''} rounded-t-[4px] transition-colors ${sel === i ? 'bg-gold' : b.valor > 0 ? 'bg-brand' : 'bg-transparent'}`}
              style={{ height: b.valor > 0 ? `${Math.max(3, (b.valor / max) * 100)}%` : 0 }} />
          </button>
        ))}
      </div>
      <div className="flex gap-[2px] mt-1.5">
        {barras.map((b, i) => (
          <span key={i} className={`flex-1 text-center text-[0.6875rem] text-muted truncate ${!poucas && i % 5 !== 0 && i !== barras.length - 1 ? 'invisible' : ''}`}>{b.rotulo}</span>
        ))}
      </div>
    </div>
  );
}

function TelaRelatorios() {
  const { viagens, motoristas } = useApp();
  const ui = useUI();
  const { notificar } = useToast();
  const [periodo, setPeriodo] = useState('7');
  const hoje = isoLocal();
  const safra = safraDe(hoje);

  const { inicio, rotuloPeriodo } = useMemo(() => {
    if (periodo === 'hoje') return { inicio: hoje, rotuloPeriodo: `hoje, ${fmtDataCurta(hoje)}` };
    if (periodo === 'safra') return { inicio: safra.inicio, rotuloPeriodo: safra.rotulo.toLowerCase() };
    const n = Number(periodo);
    const ini = somarDias(hoje, -(n - 1));
    return { inicio: ini, rotuloPeriodo: `${fmtDataCurta(ini)} a ${fmtDataCurta(hoje)}` };
  }, [periodo, hoje]);

  const lista = useMemo(() => viagens.filter((v) => v.data >= inicio && v.data <= hoje), [viagens, inicio, hoje]);
  const soma = (l, c) => l.reduce((s, v) => s + (v[c] || 0), 0);
  const ton = soma(lista, 'toneladas');
  const valor = soma(lista, 'valor');
  const porStatus = (st) => soma(lista.filter((v) => v.status === st), 'valor');
  const pago = porStatus('pago'), aPagar = porStatus('pendente'), emRota = porStatus('em_rota');

  const barras = useMemo(() => {
    if (periodo === 'safra') {
      const out = []; const d = dataDeISO(safra.inicio); const fim = dataDeISO(hoje);
      while (d <= fim && out.length < 12) {
        const ano = d.getFullYear(), mes = d.getMonth();
        const doMes = lista.filter((v) => { const x = dataDeISO(v.data); return x.getFullYear() === ano && x.getMonth() === mes; });
        out.push({ rotulo: MESES[mes], rotuloLongo: `${MESES[mes]} ${ano}`, valor: soma(doMes, 'toneladas') });
        d.setMonth(d.getMonth() + 1);
      }
      return out;
    }
    if (periodo === 'hoje') return null;
    const n = Number(periodo); const out = [];
    for (let i = n - 1; i >= 0; i--) {
      const iso = somarDias(hoje, -i);
      const d = dataDeISO(iso);
      out.push({ rotulo: n <= 7 ? DIAS_SEMANA[d.getDay()] : String(d.getDate()), rotuloLongo: fmtDataMedia(iso), valor: soma(lista.filter((v) => v.data === iso), 'toneladas') });
    }
    return out;
  }, [periodo, lista, hoje]);

  const ranking = useMemo(() => {
    const acc = new Map();
    for (const v of lista) {
      const k = v.motoristaId || `nome:${v.motoristaNome}`;
      const a = acc.get(k) || { ton: 0, valor: 0, qtd: 0, nome: v.motoristaNome };
      a.ton += v.toneladas; a.valor += v.valor; a.qtd += 1; acc.set(k, a);
    }
    const linhas = motoristas.filter((m) => m.ativo || acc.has(m.id)).map((m) => ({ chave: m.id, id: m.id, nome: m.nome, fotoUrl: m.fotoUrl, ...(acc.get(m.id) || { ton: 0, valor: 0, qtd: 0 }) }));
    for (const [k, a] of acc) if (!motoristas.some((m) => m.id === k)) linhas.push({ chave: k, id: null, nome: `${a.nome} (removido)`, fotoUrl: null, ...a });
    return linhas.sort((a, b) => b.ton - a.ton || a.nome.localeCompare(b.nome));
  }, [lista, motoristas]);
  const maxRank = Math.max(0.0001, ...ranking.map((r) => r.ton));

  const usinas = useMemo(() => {
    const acc = new Map();
    for (const v of lista) { const k = v.destino || 'Sem usina'; const a = acc.get(k) || { ton: 0, qtd: 0 }; a.ton += v.toneladas; a.qtd += 1; acc.set(k, a); }
    return [...acc.entries()].map(([nome, a]) => ({ nome, ...a })).sort((a, b) => b.ton - a.ton);
  }, [lista]);

  async function compartilhar() {
    const linhas = [
      `*CanaLog — ${rotuloPeriodo}*`,
      `${plural(lista.length, 'viagem', 'viagens')} · ${fmtTon(ton)} · ${fmtBRL(valor)}`,
      `Pago: ${fmtBRL(pago)} | A pagar: ${fmtBRL(aPagar)}${emRota ? ` | Em rota: ${fmtBRL(emRota)}` : ''}`,
      '',
      ...ranking.filter((r) => r.qtd > 0).map((r) => `• ${r.nome}: ${plural(r.qtd, 'viagem', 'viagens')}, ${fmtTon(r.ton)}, ${fmtBRL(r.valor)}`),
    ];
    const texto = linhas.join('\n');
    try {
      if (navigator.share) { await navigator.share({ text: texto }); return; }
    } catch (e) { if (e?.name === 'AbortError') return; }
    window.open(linkWhatsApp('', texto), '_blank');
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="sticky top-0 z-10 -mx-4 px-4 pt-1 pb-3 bg-bg/95 backdrop-blur-sm">
        <Segmentado opcoes={PERIODOS} valor={periodo} onChange={setPeriodo} />
      </div>

      <section className="-mt-3">
        <div className="text-sm text-muted px-1">{rotuloPeriodo.charAt(0).toUpperCase() + rotuloPeriodo.slice(1)}</div>
        <div className="rounded-[1.5rem] bg-hero text-white p-5 mt-2">
          <div>
            <span className="font-display font-bold leading-none tracking-tight tabular-nums" style={{ fontSize: '2.5rem' }}>{fmtNum(ton)}</span>
            <span className="font-display text-lg font-semibold text-white/70 ml-1.5">t</span>
          </div>
          <div className="font-display text-xl font-semibold tabular-nums mt-2">{fmtBRL(valor)} <span className="text-base font-normal text-white/75">em fretes</span></div>
          <div className="mt-3 pt-3 border-t border-white/15 flex flex-wrap justify-between gap-x-4 gap-y-1 text-sm text-white/75">
            <span>{plural(lista.length, 'viagem', 'viagens')}</span>
            <span>{lista.length ? `média de ${fmtTon(ton / lista.length)} por viagem` : 'nenhuma viagem'}</span>
          </div>
        </div>
      </section>

      {barras && (
        <Secao titulo={periodo === 'safra' ? 'Toneladas por mês' : 'Toneladas por dia'}>
          <div className="rounded-2xl bg-surface border border-line p-4">
            <GraficoBarras barras={barras} formatar={fmtTon} rotuloVazio="Nenhuma viagem no período" />
          </div>
        </Secao>
      )}

      <Secao titulo="Pagamentos">
        <Grupo>
          {[['pendente', aPagar], ['pago', pago], ['em_rota', emRota]].map(([st, val]) => (
            <div key={st} className="flex items-center gap-3 px-4 py-3.5">
              <Selo status={st} />
              <span className="flex-1 text-sm text-muted">{plural(lista.filter((v) => v.status === st).length, 'viagem', 'viagens')}</span>
              <span className="font-bold text-ink tabular-nums">{fmtBRL(val)}</span>
            </div>
          ))}
        </Grupo>
      </Secao>

      <Secao titulo="Por motorista">
        {ranking.length === 0 ? <div className="text-sm text-muted px-1">Nenhum motorista cadastrado.</div> : (
          <Grupo>
            {ranking.map((r, i) => (
              <button key={r.chave} disabled={!r.id} onClick={() => r.id && ui.verMotorista(r.id)} className={`w-full flex items-center gap-3 px-4 py-3 text-left ${r.ton === 0 ? 'opacity-50' : ''} ${FOCO}`}>
                <span className="w-5 text-sm font-bold text-muted tabular-nums text-center shrink-0">{i + 1}</span>
                <Avatar url={r.fotoUrl} nome={r.nome} size={36} />
                <span className="flex-1 min-w-0">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="font-semibold text-ink truncate">{r.nome}</span>
                    <span className="font-bold text-ink tabular-nums shrink-0">{fmtTon(r.ton)}</span>
                  </span>
                  <span className="mt-1.5 block h-1.5 rounded-full bg-surface2 overflow-hidden"><span className="block h-full rounded-full bg-brand" style={{ width: `${(r.ton / maxRank) * 100}%` }} /></span>
                  <span className="flex justify-between text-xs text-muted mt-1 tabular-nums"><span>{plural(r.qtd, 'viagem', 'viagens')}</span><span>{fmtBRL(r.valor)}</span></span>
                </span>
              </button>
            ))}
          </Grupo>
        )}
      </Secao>

      {usinas.length > 0 && (
        <Secao titulo="Por usina">
          <Grupo>
            {usinas.map((u) => (
              <div key={u.nome} className="flex items-center gap-3 px-4 py-3.5">
                <span className="flex-1 min-w-0 font-semibold text-ink truncate">{u.nome}</span>
                <span className="text-sm text-muted tabular-nums">{plural(u.qtd, 'viagem', 'viagens')}</span>
                <span className="font-bold text-ink tabular-nums w-24 text-right">{fmtTon(u.ton)}</span>
              </div>
            ))}
          </Grupo>
        </Secao>
      )}

      <Botao variante="contorno" icone={<I.compartilhar size={20} />} onClick={compartilhar} disabled={lista.length === 0}>Compartilhar resumo</Botao>
    </div>
  );
}

/* =============================================================================
   Tela: Fotos (extrato de comprovantes)
   ============================================================================= */
function TelaFotos() {
  const { fotos, viagens } = useApp();
  const ui = useUI();
  const [limite, setLimite] = useState(60);
  const grupos = useMemo(() => {
    const porViagem = new Map(viagens.map((v) => [v.id, v]));
    const mapa = new Map();
    for (const f of fotos.slice(0, limite)) {
      const v = porViagem.get(f.viagemId);
      const data = v?.data ?? 'sem-data';
      if (!mapa.has(data)) mapa.set(data, []);
      mapa.get(data).push({ ...f, viagem: v });
    }
    return [...mapa.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [fotos, viagens, limite]);

  if (fotos.length === 0) {
    return <Vazio icone={<I.fotos size={28} />} titulo="Nenhum comprovante" texto="As fotos das notas aparecem aqui, separadas por dia, assim que você registra uma viagem com foto."
      acao={<Botao variante="ouro" icone={<I.camera size={20} />} onClick={ui.novaViagem}>Registrar com foto</Botao>} />;
  }
  return (
    <div className="flex flex-col gap-6">
      {grupos.map(([data, itens]) => (
        <section key={data}>
          <div className="flex items-baseline justify-between px-1 mb-2">
            <span className="text-sm font-bold text-ink">{data === 'sem-data' ? 'Viagem removida' : rotuloDia(data)}</span>
            <span className="text-sm text-muted">{plural(itens.length, 'foto', 'fotos')}</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {itens.map((f) => (
              <button key={f.id} onClick={() => ui.verFoto(f.id)} className={`text-left ${FOCO} rounded-xl`}>
                <span className="block aspect-[3/4] rounded-xl overflow-hidden bg-surface2">
                  {f.url && <img src={f.url} alt={f.observacao || 'Comprovante'} className="w-full h-full object-cover" loading="lazy" />}
                </span>
                <span className="block text-xs font-semibold text-ink truncate mt-1.5 px-0.5">{f.viagem?.motoristaNome?.split(' ')[0] || '—'}</span>
                <span className="block text-xs text-muted truncate px-0.5">{f.viagem ? fmtTon(f.viagem.toneladas) : ''}</span>
              </button>
            ))}
          </div>
        </section>
      ))}
      {fotos.length > limite && <Botao variante="secundario" onClick={() => setLimite((l) => l + 60)}>Mostrar mais fotos</Botao>}
    </div>
  );
}

/* =============================================================================
   Tela: Motoristas
   ============================================================================= */
function useResumoMotoristas() {
  const { viagens } = useApp();
  return useMemo(() => {
    const r = new Map();
    for (const v of viagens) {
      if (!v.motoristaId) continue;
      const a = r.get(v.motoristaId) || { qtd: 0, ton: 0, aPagar: 0, qtdAPagar: 0, ultima: null };
      a.qtd += 1; a.ton += v.toneladas;
      if (v.status === 'pendente') { a.aPagar += v.valor; a.qtdAPagar += 1; }
      if (!a.ultima || v.data > a.ultima) a.ultima = v.data;
      r.set(v.motoristaId, a);
    }
    return r;
  }, [viagens]);
}

function TelaMotoristas() {
  const { motoristas } = useApp();
  const ui = useUI();
  const resumo = useResumoMotoristas();
  const ordenados = [...motoristas].sort((a, b) => (b.ativo - a.ativo) || a.nome.localeCompare(b.nome));
  const totalAPagar = [...resumo.values()].reduce((s, a) => s + a.aPagar, 0);

  if (motoristas.length === 0) {
    return <Vazio icone={<I.motoristas size={28} />} titulo="Nenhum motorista" texto="Cadastre cada motorista com o nº que aparece na nota da usina. Assim o app reconhece quem fez a viagem."
      acao={<Botao icone={<I.mais size={20} />} onClick={ui.novoMotorista}>Cadastrar motorista</Botao>} />;
  }
  return (
    <div className="flex flex-col gap-6">
      {totalAPagar > 0 && (
        <div className="rounded-2xl bg-pagar-bg text-pagar-fg px-4 py-3.5">
          <div className="text-sm font-semibold">Total a pagar aos motoristas</div>
          <div className="font-display text-2xl font-bold tabular-nums mt-0.5">{fmtBRL(totalAPagar)}</div>
        </div>
      )}
      <Grupo>
        {ordenados.map((m) => {
          const a = resumo.get(m.id);
          return (
            <button key={m.id} onClick={() => ui.verMotorista(m.id)} className={`w-full flex items-center gap-3 px-4 py-3.5 text-left bg-surface active:bg-surface2 transition-colors ${m.ativo ? '' : 'opacity-60'} ${FOCO}`}>
              <Avatar url={m.fotoUrl} nome={m.nome} size={48} />
              <span className="flex-1 min-w-0">
                <span className="block font-semibold text-ink truncate">{m.nome}{!m.ativo && <span className="ml-2 text-xs font-semibold text-muted">inativo</span>}</span>
                <span className="block text-sm text-muted truncate">{[m.placa, m.numero && `nº ${m.numero}`].filter(Boolean).join(' · ') || 'sem placa'}</span>
                <span className="block text-xs text-muted mt-0.5">{a ? `${plural(a.qtd, 'viagem', 'viagens')} · última ${rotuloDia(a.ultima).toLowerCase()}` : 'nenhuma viagem ainda'}</span>
              </span>
              <span className="text-right shrink-0">
                {a?.aPagar > 0 ? <><span className="block text-xs text-pagar-fg font-semibold">a pagar</span><span className="block font-bold text-ink tabular-nums">{fmtBRL(a.aPagar)}</span></>
                  : <span className="text-sm text-muted">em dia</span>}
              </span>
            </button>
          );
        })}
      </Grupo>
      <Botao variante="contorno" icone={<I.mais size={20} />} onClick={ui.novoMotorista}>Cadastrar motorista</Botao>
    </div>
  );
}

function DetalheMotorista({ id, onClose }) {
  const app = useApp();
  const ui = useUI();
  const { notificar } = useToast();
  const confirmar = useConfirmar();
  const fecharRef = useRef(null);
  const m = app.motoristas.find((x) => x.id === id);
  const historico = useMemo(() => app.viagens.filter((v) => v.motoristaId === id), [app.viagens, id]);
  const pendentes = historico.filter((v) => v.status === 'pendente');
  const totalPend = pendentes.reduce((s, v) => s + v.valor, 0);
  const tonPend = pendentes.reduce((s, v) => s + v.toneladas, 0);
  const [mostrar, setMostrar] = useState(20);
  const [pagando, setPagando] = useState(false);

  useEffect(() => { if (!m) onClose(); }, [m]);
  if (!m) return null;

  const textoAcerto = [
    `*Acerto — ${m.nome}*`,
    ...pendentes.map((v) => `${fmtDataCurta(v.data)} · ${v.produtor}${v.destino ? ` → ${v.destino}` : ''} · ${fmtTon(v.toneladas)} · ${fmtBRL(v.valor)}`),
    '',
    `Total: ${plural(pendentes.length, 'viagem', 'viagens')} · ${fmtTon(tonPend)} · *${fmtBRL(totalPend)}*`,
  ].join('\n');

  async function pagarTudo() {
    const ok = await confirmar({ titulo: 'Marcar tudo como pago?', texto: `${plural(pendentes.length, 'viagem', 'viagens')} de ${m.nome}, total de ${fmtBRL(totalPend)}, vão para "Pago".`, confirmar: 'Marcar como pago' });
    if (!ok) return;
    setPagando(true);
    try { await app.marcarStatus(pendentes.map((v) => v.id), 'pago'); vibrar(25); notificar(`Acerto de ${m.nome.split(' ')[0]} feito.`); }
    catch (e) { notificar('Não consegui marcar. Confira a internet.', 'erro'); }
    finally { setPagando(false); }
  }

  const tonTotal = historico.reduce((s, v) => s + v.toneladas, 0);
  return (
    <FolhaComFechar onClose={onClose} fecharRef={fecharRef} titulo="Motorista" tela>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col items-center text-center gap-2 pt-1">
          <Avatar url={m.fotoUrl} nome={m.nome} size={84} />
          <div className="font-display text-2xl font-bold text-ink">{m.nome}</div>
          <div className="text-sm text-muted">{[m.placa && `Placa ${m.placa}`, m.numero && `nº ${m.numero}`, m.numeroVeiculo && `veículo ${m.numeroVeiculo}`].filter(Boolean).join(' · ') || 'Sem placa e sem números cadastrados'}</div>
          {!m.ativo && <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-surface2 text-muted">Inativo</span>}
        </div>

        <div className="grid grid-cols-3 gap-2">
          <a href={m.telefone ? `tel:${m.telefone.replace(/[^\d+]/g, '')}` : undefined} aria-disabled={!m.telefone}
            className={`flex flex-col items-center gap-1 rounded-2xl bg-surface border border-line py-3 text-sm font-semibold text-ink ${m.telefone ? '' : 'opacity-40 pointer-events-none'}`}><I.telefone size={21} />Ligar</a>
          <a href={m.telefone ? linkWhatsApp(m.telefone, '') : undefined} target="_blank" rel="noopener" aria-disabled={!m.telefone}
            className={`flex flex-col items-center gap-1 rounded-2xl bg-surface border border-line py-3 text-sm font-semibold text-ink ${m.telefone ? '' : 'opacity-40 pointer-events-none'}`}><I.whats size={21} />WhatsApp</a>
          <button onClick={() => ui.editarMotorista(m.id)} className={`flex flex-col items-center gap-1 rounded-2xl bg-surface border border-line py-3 text-sm font-semibold text-ink ${FOCO}`}><I.lapis size={21} />Editar</button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-2xl bg-surface border border-line p-4"><div className="text-sm text-muted">Viagens</div><div className="font-display text-2xl font-bold text-ink tabular-nums mt-0.5">{historico.length}</div></div>
          <div className="rounded-2xl bg-surface border border-line p-4"><div className="text-sm text-muted">Transportado</div><div className="font-display text-2xl font-bold text-ink tabular-nums mt-0.5">{fmtTon(tonTotal)}</div></div>
        </div>

        <Secao titulo="Acerto">
          {pendentes.length === 0 ? (
            <div className="rounded-2xl bg-pago-bg text-pago-fg px-4 py-3.5 text-sm font-semibold flex items-center gap-2"><I.check size={18} />Nada a pagar — tudo em dia.</div>
          ) : (
            <div className="rounded-2xl bg-surface border border-line overflow-hidden">
              <div className="px-4 pt-4 pb-3 flex items-end justify-between gap-3">
                <div><div className="text-sm text-muted">A pagar · {plural(pendentes.length, 'viagem', 'viagens')}</div><div className="font-display text-3xl font-bold text-ink tabular-nums">{fmtBRL(totalPend)}</div></div>
                <div className="text-sm text-muted tabular-nums pb-1">{fmtTon(tonPend)}</div>
              </div>
              <div className="divide-y divide-line border-t border-line">
                {pendentes.slice(0, 8).map((v) => (
                  <button key={v.id} onClick={() => ui.verViagem(v.id)} className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm">
                    <span className="text-muted w-14 shrink-0 tabular-nums">{fmtDataCurta(v.data)}</span>
                    <span className="flex-1 truncate text-ink">{v.produtor}</span>
                    <span className="font-semibold text-ink tabular-nums">{fmtBRL(v.valor)}</span>
                  </button>
                ))}
                {pendentes.length > 8 && <div className="px-4 py-2.5 text-sm text-muted">e mais {plural(pendentes.length - 8, 'viagem', 'viagens')}…</div>}
              </div>
              <div className="p-3 grid grid-cols-2 gap-2 border-t border-line">
                <a href={linkWhatsApp(m.telefone, textoAcerto)} target="_blank" rel="noopener" className={`inline-flex items-center justify-center gap-2 h-12 rounded-xl bg-surface2 text-ink font-semibold ${TOQUE}`}><I.whats size={20} />Enviar</a>
                <Botao icone={<I.check size={19} />} onClick={pagarTudo} disabled={pagando}>{pagando ? 'Marcando…' : 'Pagar tudo'}</Botao>
              </div>
            </div>
          )}
        </Secao>

        <Secao titulo="Histórico" direita={historico.length ? plural(historico.length, 'viagem', 'viagens') : null}>
          {historico.length === 0 ? <div className="text-sm text-muted px-1">Nenhuma viagem com esse motorista ainda.</div> : (
            <>
              <Grupo>{historico.slice(0, mostrar).map((v) => <LinhaViagem key={v.id} v={v} mostrarData />)}</Grupo>
              {historico.length > mostrar && <Botao variante="secundario" className="w-full mt-3" onClick={() => setMostrar((n) => n + 30)}>Mostrar mais</Botao>}
            </>
          )}
        </Secao>
      </div>
    </FolhaComFechar>
  );
}

function FormMotorista({ id, onClose }) {
  const app = useApp();
  const ui = useUI();
  const { notificar } = useToast();
  const confirmar = useConfirmar();
  const fecharRef = useRef(null);
  const existente = id ? app.motoristas.find((m) => m.id === id) : null;
  const editando = Boolean(existente);
  const inputFotoRef = useRef(null);

  const [nome, setNome] = useState(existente?.nome ?? '');
  const [telefone, setTelefone] = useState(existente?.telefone ?? '');
  const [placa, setPlaca] = useState(existente?.placa ?? '');
  const [numero, setNumero] = useState(existente?.numero ?? '');
  const [numeroVeiculo, setNumeroVeiculo] = useState(existente?.numeroVeiculo ?? '');
  const [ativo, setAtivo] = useState(existente?.ativo ?? true);
  const [fotoUrl, setFotoUrl] = useState(existente?.fotoUrl ?? null);
  const [fotoArquivo, setFotoArquivo] = useState(null);
  const [salvando, setSalvando] = useState(false);

  function escolherFoto(e) {
    const a = e.target.files?.[0]; e.target.value = '';
    if (!a) return;
    setFotoArquivo(a); setFotoUrl(URL.createObjectURL(a));
  }
  function mascaraTelefone(s) {
    const d = s.replace(/\D/g, '').slice(0, 11);
    if (d.length <= 2) return d;
    if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
    return `(${d.slice(0, 2)}) ${d.slice(2, d.length - 4)}-${d.slice(-4)}`;
  }

  async function salvar(e) {
    e?.preventDefault();
    if (!nome.trim()) { notificar('Preencha o nome do motorista.', 'erro'); return; }
    const repetido = app.motoristas.find((m) => m.id !== id && numero && mesmoNumero(m.numero, numero));
    if (repetido) { notificar(`O nº ${numero} já é de ${repetido.nome}.`, 'erro'); return; }
    setSalvando(true);
    try {
      const dados = { nome: nome.trim(), telefone, placa: placa.trim().toUpperCase(), numero, numeroVeiculo, fotoArquivo };
      if (editando) { await app.editarMotorista(id, { ...dados, ativo }); notificar('Motorista atualizado.'); }
      else { await app.cadastrarMotorista(dados); notificar('Motorista cadastrado.'); }
      fecharRef.current?.();
    } catch (err) {
      console.error(err); notificar('Não consegui salvar. Confira a internet e tente de novo.', 'erro');
    } finally { setSalvando(false); }
  }
  async function excluir() {
    const ok = await confirmar({ titulo: 'Excluir motorista?', texto: `${existente.nome} sai da lista. As viagens dele continuam salvas, com o nome guardado. Se ele só parou de rodar, prefira marcar como inativo.`, confirmar: 'Excluir', perigo: true });
    if (!ok) return;
    try { await app.removerMotorista(id); notificar('Motorista excluído.'); fecharRef.current?.(); }
    catch (e) { notificar('Não consegui excluir. Confira a internet.', 'erro'); }
  }

  return (
    <FolhaComFechar onClose={onClose} fecharRef={fecharRef} titulo={editando ? 'Editar motorista' : 'Novo motorista'} tela
      rodape={<Botao className="w-full" onClick={salvar} disabled={salvando}>{salvando ? 'Salvando…' : editando ? 'Salvar alterações' : 'Cadastrar motorista'}</Botao>}>
      <form onSubmit={salvar} className="flex flex-col gap-5 pt-1">
        <div className="flex items-center gap-4">
          <Avatar url={fotoUrl} nome={nome} size={72} />
          <input ref={inputFotoRef} type="file" accept="image/*" onChange={escolherFoto} className="hidden" />
          <Botao type="button" variante="secundario" tamanho="p" icone={<I.camera size={18} />} onClick={() => inputFotoRef.current?.click()}>{fotoUrl ? 'Trocar foto' : 'Adicionar foto'}</Botao>
        </div>
        <Campo rotulo="Nome"><input className={INPUT} value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: Edson Ferreira" autoCapitalize="words" /></Campo>
        <Campo rotulo="Telefone (WhatsApp)"><input className={INPUT} inputMode="tel" value={telefone} onChange={(e) => setTelefone(mascaraTelefone(e.target.value))} placeholder="(16) 99123-4567" /></Campo>
        <Campo rotulo="Placa do caminhão"><input className={`${INPUT} uppercase`} value={placa} onChange={(e) => setPlaca(e.target.value.toUpperCase())} placeholder="ABC1D23" autoCapitalize="characters" /></Campo>
        <div className="rounded-2xl bg-surface border border-line p-4 flex flex-col gap-3">
          <div>
            <div className="font-semibold text-ink">Números da nota da usina</div>
            <div className="text-sm text-muted leading-snug mt-0.5">Na nota aparecem como “Motorista: 00500152” e “Veículo: 00025567”. Com eles o app reconhece o motorista sozinho.</div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Campo rotulo="Nº do motorista"><input className={`${INPUT} tabular-nums`} inputMode="numeric" value={numero} onChange={(e) => setNumero(e.target.value.replace(/\D/g, ''))} placeholder="00500152" /></Campo>
            <Campo rotulo="Nº do veículo"><input className={`${INPUT} tabular-nums`} inputMode="numeric" value={numeroVeiculo} onChange={(e) => setNumeroVeiculo(e.target.value.replace(/\D/g, ''))} placeholder="00025567" /></Campo>
          </div>
        </div>
        {editando && (
          <div className="rounded-2xl bg-surface border border-line p-4 flex items-center justify-between gap-3">
            <div><div className="font-semibold text-ink">Motorista ativo</div><div className="text-sm text-muted">Inativos somem da escolha de nova viagem.</div></div>
            <Interruptor ligado={ativo} onChange={setAtivo} rotulo="Motorista ativo" />
          </div>
        )}
        {editando && <Botao type="button" variante="perigo" icone={<I.lixo size={19} />} onClick={excluir}>Excluir motorista</Botao>}
        <button type="submit" className="hidden" />
      </form>
    </FolhaComFechar>
  );
}

function Interruptor({ ligado, onChange, rotulo }) {
  return (
    <button type="button" role="switch" aria-checked={ligado} aria-label={rotulo} onClick={() => { onChange(!ligado); vibrar(8); }}
      className={`shrink-0 w-[3.25rem] h-[1.875rem] rounded-full relative transition-colors ${FOCO} ${ligado ? 'bg-brand' : 'bg-line'}`}>
      <span className="absolute top-[3px] w-6 h-6 rounded-full bg-white shadow transition-[left] duration-200" style={{ left: ligado ? 'calc(100% - 27px)' : '3px' }} />
    </button>
  );
}

/* =============================================================================
   Tela: Ajustes
   ============================================================================= */
function TelaAjustes() {
  const app = useApp();
  const { tema, setTema, letra, setLetra } = usePref();
  const { notificar } = useToast();
  const confirmar = useConfirmar();
  const online = useOnline();
  const [valorInput, setValorInput] = useState(fmtNum(app.valorPorTonelada, 2, 2));
  const [ocupado, setOcupado] = useState(false);
  const inputBackupRef = useRef(null);

  useEffect(() => { setValorInput(fmtNum(app.valorPorTonelada, 2, 2)); }, [app.valorPorTonelada]);
  const novoValor = parseNum(valorInput);
  const mudou = Number.isFinite(novoValor) && Math.abs(novoValor - app.valorPorTonelada) > 0.0001;

  async function salvarValor() {
    if (!Number.isFinite(novoValor) || novoValor <= 0) { notificar('Digite um valor válido, ex: 47,50.', 'erro'); return; }
    const ok = await confirmar({ titulo: 'Mudar o valor por tonelada?', texto: `De ${fmtBRL(app.valorPorTonelada)} para ${fmtBRL(novoValor)}. Vale para as próximas viagens; as já registradas mantêm o valor delas.`, confirmar: 'Mudar valor' });
    if (!ok) return;
    try { await app.alterarValorPorTonelada(novoValor); notificar('Valor por tonelada atualizado.'); }
    catch (e) { notificar('Não consegui salvar o valor.', 'erro'); }
  }
  async function baixarBackup() {
    setOcupado(true);
    try {
      const json = JSON.stringify(await app.gerarBackup(), null, 2);
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url; a.download = `canalog-backup-${isoLocal()}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      notificar('Backup baixado.');
    } catch (e) { console.error(e); notificar('Não consegui gerar o backup.', 'erro'); }
    finally { setOcupado(false); }
  }
  async function restaurar(e) {
    const arquivo = e.target.files?.[0]; e.target.value = '';
    if (!arquivo) return;
    if (!(await confirmar({ titulo: 'Restaurar backup?', texto: 'Os registros do arquivo voltam pro app. Registros com o mesmo código são substituídos pela versão do backup.', confirmar: 'Restaurar' }))) return;
    setOcupado(true);
    try { await app.restaurarBackup(await arquivo.text()); notificar('Backup restaurado.'); }
    catch (err) { console.error(err); notificar('Esse arquivo não é um backup do CanaLog.', 'erro'); }
    finally { setOcupado(false); }
  }
  async function sair() {
    if (await confirmar({ titulo: 'Sair da conta?', texto: 'Pra entrar de novo você vai precisar do e-mail e da senha.', confirmar: 'Sair' })) await sb.auth.signOut();
  }

  return (
    <div className="flex flex-col gap-6">
      <Secao titulo="Pagamento">
        <div className="rounded-2xl bg-surface border border-line p-4 flex flex-col gap-3">
          <Campo rotulo="Valor por tonelada" dica="Usado pra calcular o valor das próximas viagens.">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none">R$</span>
                <input className={`${INPUT} pl-10 tabular-nums`} inputMode="decimal" value={valorInput} onChange={(e) => setValorInput(e.target.value.replace(/[^\d.,]/g, ''))} />
              </div>
              <Botao onClick={salvarValor} disabled={!mudou}>Salvar</Botao>
            </div>
          </Campo>
        </div>
      </Secao>

      <Secao titulo="Aparência">
        <div className="rounded-2xl bg-surface border border-line p-4 flex flex-col gap-4">
          <Campo rotulo="Tema"><Segmentado opcoes={[['auto', 'Automático'], ['claro', 'Claro'], ['escuro', 'Escuro']]} valor={tema === 'claro' || tema === 'escuro' ? tema : 'auto'} onChange={setTema} /></Campo>
          <Campo rotulo="Tamanho da letra" dica="“Grande” aumenta textos e botões no app inteiro."><Segmentado opcoes={[['normal', 'Normal'], ['grande', 'Grande']]} valor={letra} onChange={setLetra} /></Campo>
        </div>
      </Secao>

      <Secao titulo="Dados">
        <Grupo>
          <div className="flex items-center gap-3 px-4 py-3.5">
            <span className={`w-2.5 h-2.5 rounded-full ${online && app.tempoReal ? 'bg-pago-fg' : online ? 'bg-pagar-fg' : 'bg-danger'}`} />
            <span className="flex-1"><span className="block font-semibold text-ink">{!online ? 'Sem internet' : app.tempoReal ? 'Sincronizado' : 'Conectando…'}</span><span className="block text-sm text-muted">{online ? 'O que um registra aparece na hora no celular do outro.' : 'Conecte-se pra salvar ou ver mudanças.'}</span></span>
          </div>
          <button onClick={baixarBackup} disabled={ocupado} className={`w-full flex items-center gap-3 px-4 py-3.5 text-left ${FOCO}`}>
            <I.baixar className="text-muted" /><span className="flex-1"><span className="block font-semibold text-ink">Baixar backup</span><span className="block text-sm text-muted">Uma cópia de todos os dados. Faça toda semana.</span></span><I.seta className="text-muted" />
          </button>
          <input ref={inputBackupRef} type="file" accept="application/json,.json" onChange={restaurar} className="hidden" />
          <button onClick={() => inputBackupRef.current?.click()} disabled={ocupado} className={`w-full flex items-center gap-3 px-4 py-3.5 text-left ${FOCO}`}>
            <I.compartilhar className="text-muted" /><span className="flex-1"><span className="block font-semibold text-ink">Restaurar backup</span><span className="block text-sm text-muted">Traz de volta os dados de um arquivo.</span></span><I.seta className="text-muted" />
          </button>
        </Grupo>
      </Secao>

      <Secao titulo="Conta">
        <Grupo>
          <div className="px-4 py-3.5"><div className="text-sm text-muted">Entrou como</div><div className="font-semibold text-ink break-all">{app.usuario?.email}</div></div>
          <button onClick={sair} className={`w-full flex items-center gap-3 px-4 py-3.5 text-left text-danger font-semibold ${FOCO}`}><I.sair />Sair da conta</button>
        </Grupo>
      </Secao>

      <p className="text-center text-xs text-muted pb-2">CanaLog {VERSAO}</p>
    </div>
  );
}

/* =============================================================================
   Estrutura: cabeçalho, conteúdo e barra de navegação
   ============================================================================= */
const ABAS = [
  { chave: 'inicio', rotulo: 'Início', icone: I.inicio },
  { chave: 'relatorios', rotulo: 'Relatórios', icone: I.relatorios },
  { chave: 'fotos', rotulo: 'Fotos', icone: I.fotos },
  { chave: 'motoristas', rotulo: 'Motoristas', icone: I.motoristas },
];
const TITULOS = { inicio: 'CanaLog', relatorios: 'Relatórios', fotos: 'Comprovantes', motoristas: 'Motoristas', ajustes: 'Ajustes' };

function Marca({ pequena }) {
  return (
    <span className="flex items-center gap-2.5">
      <span className={`${pequena ? 'w-8 h-8 rounded-[0.6rem]' : 'w-10 h-10 rounded-xl'} bg-brand text-onbrand flex items-center justify-center shrink-0`}>
        <svg width={pequena ? 19 : 23} height={pequena ? 19 : 23} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M11.5 21.5c-.2-6.3.2-12.6 1.6-19" /><path d="M10.4 16.2h2.4" /><path d="M10.6 10.6h2.5" /><path d="M11.6 13.4C9 13.6 6.7 12.4 5.4 10c2.8-.2 5 .7 6.3 2.7" /><path d="M12.6 8.2c1.1-2.6 3.2-4 6-4.2-.8 2.8-2.8 4.4-5.6 4.8" /></svg>
      </span>
      <span className="font-display text-xl font-bold text-ink tracking-tight">CanaLog</span>
    </span>
  );
}

function BarraInferior({ tela, ir }) {
  const ui = useUI();
  const item = (a) => {
    const ativo = tela === a.chave;
    return (
      <button key={a.chave} onClick={() => ir(a.chave)} aria-current={ativo ? 'page' : undefined}
        className={`flex-1 flex flex-col items-center justify-center gap-1 h-16 ${FOCO}`}>
        <span className={`h-8 w-14 rounded-full flex items-center justify-center transition-colors ${ativo ? 'bg-brand/15 text-brandink' : 'text-muted'}`}><a.icone size={23} /></span>
        <span className={`text-xs ${ativo ? 'font-bold text-ink' : 'font-medium text-muted'}`}>{a.rotulo}</span>
      </button>
    );
  };
  return (
    <nav className="md:hidden shrink-0 bg-surface/95 backdrop-blur border-t border-line" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }} aria-label="Navegação">
      <div className="flex items-stretch max-w-xl mx-auto px-1">
        {item(ABAS[0])}{item(ABAS[1])}
        <div className="flex-1 flex items-center justify-center">
          <button onClick={() => { vibrar(10); ui.novaViagem(); }} aria-label="Registrar nova viagem"
            className={`w-14 h-14 rounded-2xl bg-gold text-ongold flex items-center justify-center shadow-lg shadow-gold/30 ${TOQUE} ${FOCO}`}><I.mais size={28} strokeWidth={2.4} /></button>
        </div>
        {item(ABAS[2])}{item(ABAS[3])}
      </div>
    </nav>
  );
}

function MenuLateral({ tela, ir }) {
  const ui = useUI();
  return (
    <aside className="hidden md:flex flex-col w-64 shrink-0 border-r border-line bg-surface px-4 pb-6" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 1.5rem)' }}>
      <div className="px-2"><Marca /></div>
      <Botao variante="ouro" className="mt-7" icone={<I.mais size={20} />} onClick={ui.novaViagem}>Registrar viagem</Botao>
      <nav className="flex flex-col gap-1 mt-6">
        {[...ABAS, { chave: 'ajustes', rotulo: 'Ajustes', icone: I.ajustes }].map((a) => (
          <button key={a.chave} onClick={() => ir(a.chave)} aria-current={tela === a.chave ? 'page' : undefined}
            className={`flex items-center gap-3 h-11 px-3 rounded-xl text-left font-semibold transition-colors ${FOCO} ${tela === a.chave ? 'bg-brand/15 text-brandink' : 'text-muted hover:bg-surface2 hover:text-ink'}`}>
            <a.icone size={21} />{a.rotulo}
          </button>
        ))}
      </nav>
    </aside>
  );
}

function Conteudo() {
  const { carregando, erroCarga, recarregar } = useApp();
  const online = useOnline();
  const [tela, setTela] = useState('inicio');
  const [rolou, setRolou] = useState(false);
  const scrollRef = useRef(null);

  function ir(t) { setTela(t); vibrar(6); if (scrollRef.current) scrollRef.current.scrollTop = 0; setRolou(false); }

  const Telas = { inicio: TelaInicio, relatorios: TelaRelatorios, fotos: TelaFotos, motoristas: TelaMotoristas, ajustes: TelaAjustes };
  const TelaAtual = Telas[tela];

  return (
    <div className="h-full flex bg-bg text-ink">
      <MenuLateral tela={tela} ir={ir} />
      <div className="flex-1 min-w-0 flex flex-col h-full">
        <header className={`shrink-0 bg-bg transition-shadow ${rolou ? 'shadow-[0_1px_0_rgb(var(--c-line))]' : ''}`} style={{ paddingTop: 'env(safe-area-inset-top)' }}>
          <div className="h-14 max-w-2xl w-full mx-auto px-4 flex items-center gap-2">
            {tela === 'ajustes' && <button onClick={() => ir('inicio')} aria-label="Voltar" className={`-ml-2 w-11 h-11 rounded-full flex items-center justify-center text-ink md:hidden ${FOCO}`}><I.voltar /></button>}
            {tela === 'inicio' ? <span className="md:hidden"><Marca pequena /></span> : null}
            <h1 className={`font-display text-2xl font-bold text-ink tracking-tight ${tela === 'inicio' ? 'hidden md:block' : ''}`}>{tela === 'inicio' ? 'Início' : TITULOS[tela]}</h1>
            <div className="ml-auto flex items-center gap-1">
              {tela !== 'ajustes' && <button onClick={() => ir('ajustes')} aria-label="Ajustes" className={`w-11 h-11 rounded-full flex items-center justify-center text-ink md:hidden ${FOCO}`}><I.ajustes /></button>}
            </div>
          </div>
          {!online && (
            <div className="bg-danger text-white text-sm font-semibold px-4 py-2 flex items-center justify-center gap-2"><I.semNet size={18} />Sem internet — nada será salvo até a conexão voltar.</div>
          )}
        </header>

        <main ref={scrollRef} onScroll={(e) => setRolou(e.currentTarget.scrollTop > 4)} className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
          <div className="max-w-2xl w-full mx-auto px-4 pt-2 pb-8">
            {erroCarga ? (
              <Vazio icone={<I.semNet size={28} />} titulo="Não consegui carregar" texto={`Confira a internet e tente de novo. (${erroCarga})`} acao={<Botao onClick={recarregar}>Tentar de novo</Botao>} />
            ) : carregando ? <Esqueleto /> : <TelaAtual />}
          </div>
        </main>

        <BarraInferior tela={tela} ir={ir} />
        {tela !== 'inicio' && <VoltarParaInicio ir={ir} />}
      </div>
    </div>
  );
}

function VoltarParaInicio({ ir }) {
  useVoltarFecha(() => ir('inicio'));
  return null;
}

function Esqueleto() {
  return (
    <div className="flex flex-col gap-6 animate-pulse" aria-label="Carregando">
      <div className="h-56 rounded-[1.75rem] bg-surface2" />
      <div className="h-12 rounded-xl bg-surface2" />
      <div className="h-48 rounded-2xl bg-surface2" />
    </div>
  );
}

/* =============================================================================
   Acesso
   ============================================================================= */
function TelaFaltaConfigurar() {
  return (
    <div className="h-full overflow-y-auto flex items-center justify-center p-6 bg-bg">
      <div className="max-w-md w-full flex flex-col gap-4">
        <Marca />
        <h1 className="font-display text-2xl font-bold text-ink">Falta conectar o banco de dados</h1>
        <p className="text-muted leading-relaxed">Abra o arquivo <code className="text-sm bg-surface2 px-1.5 py-0.5 rounded">config.js</code> do repositório e cole a <b className="text-ink">Project URL</b> e a <b className="text-ink">anon public key</b> do seu projeto no Supabase. O passo a passo está no README.</p>
      </div>
    </div>
  );
}

function TelaLogin() {
  const { notificar } = useToast();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [verSenha, setVerSenha] = useState(false);
  const [entrando, setEntrando] = useState(false);

  async function entrar(e) {
    e.preventDefault();
    setEntrando(true);
    const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password: senha });
    setEntrando(false);
    if (error) notificar(navigator.onLine === false ? 'Sem internet. Conecte-se pra entrar.' : 'E-mail ou senha incorretos.', 'erro');
  }

  return (
    <div className="h-full overflow-y-auto bg-bg">
      <div className="min-h-full flex flex-col justify-center max-w-sm mx-auto px-6" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 2rem)', paddingBottom: 'calc(env(safe-area-inset-bottom) + 2rem)' }}>
        <Marca />
        <h1 className="font-display text-3xl font-bold text-ink mt-8 leading-tight">Viagens, pesagens e acertos da safra.</h1>
        <p className="text-muted mt-2">Entre com o e-mail e a senha da sua conta.</p>
        <form onSubmit={entrar} className="flex flex-col gap-4 mt-8">
          <Campo rotulo="E-mail"><input className={INPUT} type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Campo>
          <Campo rotulo="Senha" extra={<button type="button" onClick={() => setVerSenha((v) => !v)} className="text-sm font-semibold text-brandink">{verSenha ? 'Esconder' : 'Mostrar'}</button>}>
            <input className={INPUT} type={verSenha ? 'text' : 'password'} autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} required />
          </Campo>
          <Botao type="submit" disabled={entrando} className="mt-2">{entrando ? 'Entrando…' : 'Entrar'}</Botao>
        </form>
      </div>
    </div>
  );
}

function App() {
  const [sessao, setSessao] = useState(undefined); // undefined = ainda verificando
  useEffect(() => {
    if (!sb) return;
    sb.auth.getSession().then(({ data }) => setSessao(data.session));
    const { data: sub } = sb.auth.onAuthStateChange((_evento, s) => setSessao(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!sb) return <TelaFaltaConfigurar />;
  if (sessao === undefined) return <div className="h-full flex items-center justify-center bg-bg"><Marca /></div>;
  if (!sessao) return <TelaLogin />;
  return (
    <AppProvider key={sessao.user.id} usuario={sessao.user}>
      <ConfirmarProvider>
        <UIProvider>
          <Conteudo />
        </UIProvider>
      </ConfirmarProvider>
    </AppProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <PrefProvider><ToastProvider><App /></ToastProvider></PrefProvider>
);
