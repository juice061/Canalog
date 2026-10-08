/** @jsxRuntime classic */
// (força o modo clássico do JSX: evita a tela branca do runtime automático do Babel)
const { useState, useEffect, useMemo, useRef, createContext, useContext } = React;

/* ============================== estilos reutilizados ============================== */
const CARD = "bg-white dark:bg-[#211F19] border border-cream-line dark:border-[#322F26] rounded-2xl shadow-[0_1px_2px_rgba(36,31,22,0.04)]";
const INPUT = "rounded-2xl border border-cream-line dark:border-[#3A362B] dark:bg-[#2A271F] bg-white px-4.5 py-3.5 text-[15px] font-normal outline-none focus:ring-2 focus:ring-forest/25 transition-shadow";
const LABEL = "text-[11px] font-bold uppercase tracking-wide text-muted dark:text-[#9C9686]";
const BTN_PRIMARY = "bg-forest text-cream font-semibold rounded-2xl py-3.5 text-sm transition-all duration-150 active:scale-[0.97] hover:brightness-110 disabled:opacity-50 disabled:active:scale-100";
const BTN_GHOST = "border border-cream-line dark:border-[#3A362B] font-semibold rounded-2xl py-2.5 text-xs transition-all duration-150 active:scale-[0.97] hover:bg-cream dark:hover:bg-white/5";
const PRESS = "transition-transform duration-150 active:scale-[0.96]";

/* ============================== Supabase ============================== */
const CHAVE_TEMA = 'canalog:tema';
const CFG = window.CANALOG_CONFIG || {};
const CONFIGURADO = Boolean(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY && !/COLE_AQUI/.test(CFG.SUPABASE_URL + CFG.SUPABASE_ANON_KEY));
const sb = CONFIGURADO && window.supabase ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY) : null;
const BUCKET = 'canalog';
const VALIDADE_URL = 60 * 60 * 24; // links das fotos valem 24h (são regerados a cada carregamento)

function uuid() { return (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16); })); }

// Reduz a foto antes de subir (economiza espaço no plano grátis do Supabase)
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

// Conversões banco (snake_case) <-> app (camelCase)
const daMotorista = (r, links) => ({
  id: r.id, nome: r.nome, telefone: r.telefone || '', placa: r.placa || '',
  numero: r.numero || '', numeroVeiculo: r.numero_veiculo || '', ativo: r.ativo,
  fotoPath: r.foto_path || null, fotoUrl: r.foto_path ? (links[r.foto_path] || null) : null,
});
const daViagem = (r) => ({
  id: r.id, produtor: r.produtor, motoristaId: r.motorista_id, motoristaNome: r.motorista_nome,
  placa: r.placa || '', destino: r.destino || '', toneladas: Number(r.toneladas),
  valorBruto: Number(r.valor_bruto), valor: Number(r.valor), status: r.status, data: r.data,
});
const daFoto = (r, links) => ({
  id: r.id, viagemId: r.viagem_id, path: r.path, url: links[r.path] || null,
  observacao: r.observacao || '', criadoEm: r.created_at,
});

/* ============================== Context de dados ============================== */
const AppCtx = createContext(null);
function useApp() { return useContext(AppCtx); }

function AppProvider({ usuario, children }) {
  const [motoristas, setMotoristas] = useState([]);
  const [viagens, setViagens] = useState([]);
  const [fotos, setFotos] = useState([]);
  const [valorPorTonelada, setValorPorTonelada] = useState(10);
  const [carregando, setCarregando] = useState(true);
  const [erroCarga, setErroCarga] = useState(null);
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
      setErroCarga(e?.message || 'Erro ao carregar dados');
    } finally {
      setCarregando(false);
    }
  }
  recarregarRef.current = recarregar;

  useEffect(() => {
    recarregar();
    // Tempo real: quando alguém (ex.: o vô no celular dele) mudar algo, recarrega aqui também
    let timer = null;
    const agendar = () => { clearTimeout(timer); timer = setTimeout(() => recarregarRef.current(), 400); };
    const canal = sb.channel('canalog-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'viagens' }, agendar)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'motoristas' }, agendar)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fotos' }, agendar)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'config' }, agendar)
      .subscribe();
    return () => { clearTimeout(timer); sb.removeChannel(canal); };
  }, []);

  const calcular = (toneladas) => Number((toneladas * valorPorTonelada).toFixed(2));

  async function registrarViagem({ produtor, motoristaId, toneladas, destino, data }) {
    const m = motoristas.find((x) => x.id === motoristaId);
    const valor = calcular(toneladas);
    const linha = {
      id: uuid(), produtor, motorista_id: m?.id ?? null, motorista_nome: m?.nome ?? 'Motorista não informado',
      placa: m?.placa ?? '', destino: destino || '', toneladas, valor_bruto: valor, valor, status: 'em_rota', data,
    };
    const { error } = await sb.from('viagens').insert(linha);
    falhou(error);
    const nova = daViagem(linha);
    setViagens((atual) => [nova, ...atual]);
    return nova;
  }
  async function editarViagem(id, patch) {
    const linha = {};
    if ('produtor' in patch) linha.produtor = patch.produtor;
    if ('destino' in patch) linha.destino = patch.destino;
    if ('data' in patch) linha.data = patch.data;
    if ('status' in patch) linha.status = patch.status;
    if ('toneladas' in patch) { linha.toneladas = patch.toneladas; linha.valor_bruto = linha.valor = calcular(patch.toneladas); }
    const { error } = await sb.from('viagens').update(linha).eq('id', id);
    falhou(error);
    setViagens((atual) => atual.map((v) => (v.id === id ? { ...v, ...patch, ...('toneladas' in patch ? { valor: linha.valor, valorBruto: linha.valor } : {}) } : v)));
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
    // Ordem importa por causa das ligações entre tabelas
    for (const [tabela, linhas] of [['config', b.config], ['motoristas', b.motoristas], ['viagens', b.viagens], ['fotos', b.fotos]]) {
      if (linhas?.length) { const { error } = await sb.from(tabela).upsert(linhas); falhou(error); }
    }
    await recarregar();
  }

  // Sugestões pros campos (e pra "encaixar" o que o OCR ler em nomes já usados)
  const produtoresConhecidos = useMemo(() => [...new Set(viagens.map((v) => v.produtor).filter(Boolean))], [viagens]);
  const destinosConhecidos = useMemo(() => [...new Set(viagens.map((v) => v.destino).filter(Boolean))], [viagens]);

  const value = {
    usuario, carregando, erroCarga, recarregar,
    motoristas, viagens, fotos, valorPorTonelada, produtoresConhecidos, destinosConhecidos,
    registrarViagem, editarViagem, removerViagem,
    cadastrarMotorista, editarMotorista, removerMotorista,
    enviarFoto, alterarValorPorTonelada, gerarBackup, restaurarBackup,
  };
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

// Se o OCR leu algo que começa com um nome já usado antes ("Usina Santa Rita E Arte"),
// usa o nome conhecido ("Usina Santa Rita"). Senão, mantém o que foi lido.
function encaixarNoConhecido(lido, conhecidos) {
  if (!lido) return lido;
  const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
  const l = norm(lido);
  const candidatos = conhecidos.filter((c) => { const n = norm(c); return n.length >= 4 && (l === n || l.startsWith(n + ' ') || n.startsWith(l + ' ')); });
  if (candidatos.length === 0) return lido;
  return candidatos.sort((a, b) => b.length - a.length)[0];
}

/* ============================== Toasts ============================== */
const ToastCtx = createContext(null);
function useToast() { return useContext(ToastCtx); }
function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  function notificar(msg, tipo = 'sucesso') {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg, tipo }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }
  return (
    <ToastCtx.Provider value={{ notificar }}>
      {children}
      <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2 items-center px-4 w-full pointer-events-none">
        {toasts.map((t) => (
          <div key={t.id} className={`pointer-events-auto text-sm font-semibold px-4 py-2.5 rounded-xl shadow-lg max-w-sm text-center ${t.tipo === 'erro' ? 'bg-terracotta text-cream' : 'bg-forest text-cream'}`}>
            {t.msg}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ============================== Tema (claro/escuro) ============================== */
function useTema() {
  const [escuro, setEscuro] = useState(() => { try { return localStorage.getItem(CHAVE_TEMA) === 'escuro'; } catch (e) { return false; } });
  useEffect(() => {
    document.documentElement.classList.toggle('dark', escuro);
    try { localStorage.setItem(CHAVE_TEMA, escuro ? 'escuro' : 'claro'); } catch (e) {}
  }, [escuro]);
  return [escuro, setEscuro];
}

/* ============================== Ícones ============================== */
const Icon = {
  relatorios: (p) => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="20" x2="5" y2="12"/><line x1="12" y1="20" x2="12" y2="7"/><line x1="19" y1="20" x2="19" y2="14"/></svg>,
  fotos: (p) => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10.5" r="1.5"/><path d="M21 15l-5-5-9 9"/></svg>,
  home: (p) => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 11l9-7 9 7"/><path d="M5 10v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9"/></svg>,
  motoristas: (p) => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="3.5"/><path d="M4.5 20c1-4 4-6 7.5-6s6.5 2 7.5 6"/></svg>,
  config: (p) => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 13a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H2a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H8a1.7 1.7 0 0 0 1-1.6V2a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V8a1.7 1.7 0 0 0 1.6 1H22a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.6 1z"/></svg>,
  camera: (p) => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.5"/></svg>,
  sparkle: (p) => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v3M12 18v3M3 12h3M18 12h3M6 6l1.8 1.8M16.2 16.2 18 18M6 18l1.8-1.8M16.2 7.8 18 6"/><circle cx="12" cy="12" r="3"/></svg>,
  pessoa: (p) => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c1.2-4.5 4.6-7 8-7s6.8 2.5 8 7"/></svg>,
};

const NAV = [
  { chave: 'relatorios', label: 'Relatórios', icon: Icon.relatorios },
  { chave: 'fotos', label: 'Fotos', icon: Icon.fotos },
  { chave: 'home', label: 'Home', icon: Icon.home },
  { chave: 'motoristas', label: 'Motoristas', icon: Icon.motoristas },
  { chave: 'config', label: 'Config.', icon: Icon.config },
];

/* ============================== Navegação ============================== */
function Sidebar({ tela, setTela }) {
  return (
    <aside className="hidden md:flex md:flex-col w-64 shrink-0 bg-white dark:bg-[#1B1A15] border-r border-cream-line dark:border-[#322F26] h-full px-5 py-8">
      <div className="flex items-center gap-3 px-1">
        <div className="w-10 h-10 rounded-2xl bg-forest text-cream flex items-center justify-center font-display font-bold text-lg">C</div>
        <div>
          <div className="font-display text-xl font-bold text-forest dark:text-gold-light leading-none">CanaLog</div>
          <div className="text-[11px] text-muted dark:text-[#9C9686] mt-1">Safra 2026</div>
        </div>
      </div>
      <nav className="flex flex-col gap-1.5 mt-10">
        {NAV.map((item) => (
          <button key={item.chave} onClick={() => setTela(item.chave)}
            className={`flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-semibold text-left transition-all duration-150 ${tela === item.chave ? 'bg-forest text-cream translate-x-0.5' : 'text-muted dark:text-[#9C9686] hover:bg-cream dark:hover:bg-white/5 hover:text-ink dark:hover:text-cream hover:translate-x-0.5'}`}>
            <item.icon width="19" height="19" />
            {item.label}
          </button>
        ))}
      </nav>
    </aside>
  );
}

function BottomNav({ tela, setTela }) {
  return (
    <nav className="md:hidden h-[78px] bg-white dark:bg-[#1B1A15] border-t border-cream-line dark:border-[#322F26] flex items-center justify-around pb-2 shrink-0" style={{ paddingBottom: 'max(8px, env(safe-area-inset-bottom, 0px))' }}>
      {NAV.map((item) => (
        <button key={item.chave} onClick={() => setTela(item.chave)}
          className={`flex flex-col items-center gap-1 px-3 py-2 rounded-2xl transition-all duration-150 active:scale-90 ${tela === item.chave ? 'bg-forest text-cream -mt-5 shadow-lg' : 'text-muted dark:text-[#9C9686]'}`}>
          <item.icon width="21" height="21" />
          <span className="text-[10px] font-semibold">{item.label}</span>
        </button>
      ))}
    </nav>
  );
}

/* ============================== Avatar de motorista ============================== */
function Avatar({ url, size = 40 }) {
  const s = { width: size, height: size };
  if (url) return <img src={url} style={s} className="rounded-full object-cover shrink-0" />;
  return (
    <div style={s} className="rounded-full bg-transit-bg dark:bg-[#2C2A22] text-transit-text dark:text-[#C9C0A6] flex items-center justify-center shrink-0">
      <Icon.pessoa width={Math.round(size * 0.55)} height={Math.round(size * 0.55)} />
    </div>
  );
}

/* ============================== Card de viagem ============================== */
const statusMap = {
  pago: { label: 'Pago', bg: 'bg-forest-soft dark:bg-[#22362A]', text: 'text-forest-soft-text dark:text-[#9FD3AE]' },
  pendente: { label: 'Pendente', bg: 'bg-pending-bg dark:bg-[#3A2E17]', text: 'text-pending-text dark:text-[#E3B96A]' },
  em_rota: { label: 'Em rota', bg: 'bg-transit-bg dark:bg-[#2C2A22]', text: 'text-transit-text dark:text-[#C9C0A6]' },
};

function TripCard({ viagem }) {
  const status = statusMap[viagem.status] ?? statusMap.em_rota;
  return (
    <div className={`${CARD} px-5 py-4.5 flex justify-between items-center gap-4`}>
      <div className="min-w-0">
        <div className="text-[14.5px] font-semibold truncate">{viagem.produtor}</div>
        <div className="text-xs text-muted dark:text-[#9C9686] mt-1.5">{viagem.motoristaNome}{viagem.placa ? ` · ${viagem.placa}` : ''}</div>
        {viagem.destino && <div className="text-xs text-muted dark:text-[#9C9686] mt-1">→ {viagem.destino}</div>}
      </div>
      <div className="text-right shrink-0">
        <div className="text-sm font-bold">{viagem.toneladas.toFixed(1)} t</div>
        <span className={`inline-block mt-2 text-[11px] font-bold px-2.5 py-1 rounded-full ${status.bg} ${status.text}`}>{status.label}</span>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return <label className="flex flex-col gap-1.5">{label && <span className={LABEL}>{label}</span>}{children}</label>;
}

/* ============================== Modal: Viagem (com leitura de nota por IA) ============================== */
function ViagemModal({ viagemExistente, onClose }) {
  const { motoristas, valorPorTonelada, registrarViagem, editarViagem, removerViagem, enviarFoto, produtoresConhecidos, destinosConhecidos } = useApp();
  const { notificar } = useToast();
  const editando = Boolean(viagemExistente);

  const [produtor, setProdutor] = useState(viagemExistente?.produtor ?? '');
  const [motoristaId, setMotoristaId] = useState(viagemExistente?.motoristaId ?? motoristas[0]?.id ?? '');
  const [destino, setDestino] = useState(viagemExistente?.destino ?? '');
  const [toneladas, setToneladas] = useState(viagemExistente?.toneladas?.toString() ?? '');
  const [data, setData] = useState(viagemExistente?.data ?? new Date().toISOString().slice(0, 10));
  const [status, setStatus] = useState(viagemExistente?.status ?? 'em_rota');
  const [confirmando, setConfirmando] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const inputNotaRef = useRef(null);
  const [notaArquivo, setNotaArquivo] = useState(null);
  const [notaPreview, setNotaPreview] = useState(null);
  const [lendoNota, setLendoNota] = useState(false);

  const t = parseFloat(toneladas) || 0;
  const valorBruto = t * valorPorTonelada;

  async function handleAnexarNota(e) {
    const arquivo = e.target.files?.[0];
    e.target.value = '';
    if (!arquivo) return;
    setNotaArquivo(arquivo);
    setNotaPreview(URL.createObjectURL(arquivo));

    setLendoNota(true);
    try {
      const comTimeout = (promessa, ms) => Promise.race([
        promessa,
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout_ocr')), ms)),
      ]);
      const texto = await comTimeout(reconhecerTextoDaImagem(arquivo), 25000);
      const lido = extrairDadosDaNota(texto);

      let algoPreenchido = false;
      if (lido.produtor) { setProdutor(encaixarNoConhecido(lido.produtor, produtoresConhecidos)); algoPreenchido = true; }
      if (lido.destino) { setDestino(encaixarNoConhecido(lido.destino, destinosConhecidos)); algoPreenchido = true; }
      if (lido.toneladas != null) { setToneladas(String(lido.toneladas)); algoPreenchido = true; }
      if (lido.data) { setData(lido.data); algoPreenchido = true; }

      // Motorista: primeiro pelo número do motorista, depois pelo número do caminhão
      let avisoMotorista = '';
      if (lido.numeroMotorista || lido.numeroVeiculo) {
        const achado =
          motoristas.find((m) => mesmoNumero(m.numero, lido.numeroMotorista)) ||
          motoristas.find((m) => mesmoNumero(m.numeroVeiculo, lido.numeroVeiculo));
        if (achado) {
          setMotoristaId(achado.id);
          algoPreenchido = true;
        } else {
          avisoMotorista = ` Motorista nº ${lido.numeroMotorista ?? '?'} / veículo nº ${lido.numeroVeiculo ?? '?'} não está cadastrado — confere o motorista.`;
        }
      }

      if (algoPreenchido) {
        notificar('Nota lida — confere os campos antes de salvar.' + avisoMotorista, avisoMotorista ? 'erro' : 'sucesso');
      } else {
        notificar('Não consegui identificar os dados na nota. Preenche na mão mesmo.', 'erro');
      }
    } catch (err) {
      console.error(err);
      if (err?.message === 'timeout_ocr') window.__ocrWorkerPromise = null;
      notificar(err?.message === 'timeout_ocr' ? 'A leitura demorou demais e foi cancelada. Preenche na mão.' : 'Não consegui ler a nota agora. Preenche os campos na mão.', 'erro');
    } finally {
      setLendoNota(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!produtor || !toneladas) return;
    setSalvando(true);
    try {
      if (editando) {
        await editarViagem(viagemExistente.id, { produtor: produtor.trim(), destino: destino.trim(), toneladas: parseFloat(toneladas), data, status });
        notificar('Viagem atualizada.');
      } else {
        const nova = await registrarViagem({ produtor: produtor.trim(), motoristaId: motoristaId || null, destino: destino.trim(), toneladas: parseFloat(toneladas), data });
        if (notaArquivo) {
          try { await enviarFoto({ viagemId: nova.id, arquivo: notaArquivo, observacao: 'Nota da viagem' }); }
          catch (err) { console.error(err); notificar('Viagem salva, mas a foto da nota não subiu. Tenta de novo editando depois.', 'erro'); onClose(); return; }
        }
        notificar('Viagem registrada.');
      }
      onClose();
    } catch (err) {
      console.error(err);
      notificar('Não consegui salvar. Confere a internet e tenta de novo.', 'erro');
    } finally {
      setSalvando(false);
    }
  }

  async function handleExcluir() {
    try {
      await removerViagem(viagemExistente.id);
      notificar('Viagem excluída.');
      onClose();
    } catch (err) {
      console.error(err);
      notificar('Não consegui excluir. Confere a internet e tenta de novo.', 'erro');
    }
  }

  return (
    <div className="fixed inset-0 bg-ink/40 flex items-end md:items-center md:justify-center z-40 p-0 md:p-4">
      <form onSubmit={handleSubmit} className="w-full md:max-w-md bg-cream dark:bg-[#1B1A15] rounded-t-3xl md:rounded-3xl p-8 flex flex-col gap-6 max-h-[92%] overflow-auto">
        <div className="flex justify-between items-center">
          <h2 className="font-display text-2xl font-bold text-forest dark:text-gold-light">{editando ? 'Editar viagem' : 'Nova viagem'}</h2>
          <button type="button" onClick={onClose} className={`text-muted dark:text-[#9C9686] text-2xl leading-none ${PRESS}`}>×</button>
        </div>

        {!editando && (
          <div className="rounded-2xl border border-dashed border-gold/60 bg-gold/5 p-4 flex flex-col gap-2.5">
            <input ref={inputNotaRef} type="file" accept="image/*" capture="environment" onChange={handleAnexarNota} className="hidden" />
            {notaPreview ? (
              <div className="flex items-center gap-3">
                <img src={notaPreview} className="w-14 h-14 rounded-xl object-cover" />
                <div className="flex-1 text-xs">
                  {lendoNota ? (
                    <span className="flex items-center gap-1.5 text-gold-light font-semibold"><Icon.sparkle width="14" height="14" className="animate-pulse" /> Lendo a nota…</span>
                  ) : (
                    <span className="text-muted dark:text-[#9C9686]">Nota de pesagem anexada — confere os campos antes de salvar.</span>
                  )}
                </div>
                <button type="button" onClick={() => inputNotaRef.current?.click()} className={`text-xs font-semibold text-forest dark:text-gold-light ${PRESS}`}>Trocar</button>
              </div>
            ) : (
              <button type="button" onClick={() => inputNotaRef.current?.click()} className={`flex items-center justify-center gap-2 text-sm font-semibold text-forest dark:text-gold-light ${PRESS}`}>
                <Icon.sparkle width="17" height="17" />
                {'Anexar nota de pesagem (leitura automática por OCR)'}
              </button>
            )}
          </div>
        )}

        <Field label="Produtor / fazenda">
          <input className={INPUT} list="lista-produtores" value={produtor} onChange={(e) => setProdutor(e.target.value)} placeholder="Ex: Sítio Boa Esperança" required />
          <datalist id="lista-produtores">{produtoresConhecidos.map((p) => <option key={p} value={p} />)}</datalist>
        </Field>

        {!editando && (
          <Field label="Motorista">
            {motoristas.length === 0 ? (
              <span className="text-xs font-normal text-terracotta">Cadastre um motorista primeiro, na aba Motoristas.</span>
            ) : (
              <select className={INPUT} value={motoristaId} onChange={(e) => setMotoristaId(e.target.value)}>
                {motoristas.map((m) => <option key={m.id} value={m.id}>{m.nome} — {m.placa || 'sem placa'}</option>)}
              </select>
            )}
          </Field>
        )}

        <Field label="Destino (usina)">
          <input className={INPUT} list="lista-destinos" value={destino} onChange={(e) => setDestino(e.target.value)} placeholder="Ex: Usina São João" />
          <datalist id="lista-destinos">{destinosConhecidos.map((d) => <option key={d} value={d} />)}</datalist>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Toneladas">
            <input className={INPUT} type="number" step="0.01" min="0" value={toneladas} onChange={(e) => setToneladas(e.target.value)} required />
          </Field>
          <Field label="Data">
            <input className={INPUT} type="date" value={data} onChange={(e) => setData(e.target.value)} />
          </Field>
        </div>

        {editando && (
          <Field label="Status">
            <div className="flex gap-2">
              {[['em_rota', 'Em rota'], ['pendente', 'Pendente'], ['pago', 'Pago']].map(([v, l]) => (
                <button type="button" key={v} onClick={() => setStatus(v)} className={`flex-1 py-2.5 rounded-xl text-xs font-semibold border transition-all duration-150 active:scale-95 ${status === v ? 'bg-forest text-cream border-forest' : 'bg-white dark:bg-transparent border-cream-line dark:border-[#3A362B] text-muted dark:text-[#9C9686]'}`}>{l}</button>
              ))}
            </div>
          </Field>
        )}

        <div className={`${CARD} px-5 py-4 flex justify-between items-center`}>
          <span className="text-sm font-medium text-muted dark:text-[#9C9686]">Valor da viagem ({t.toFixed(2)} t × R$ {valorPorTonelada.toFixed(2).replace('.', ',')})</span>
          <span className="font-bold text-forest dark:text-gold-light text-[16px] shrink-0 ml-3">R$ {valorBruto.toFixed(2).replace('.', ',')}</span>
        </div>

        <button type="submit" disabled={salvando || (!editando && motoristas.length === 0)} className={BTN_PRIMARY}>{editando ? 'Salvar alterações' : 'Registrar viagem'}</button>

        {editando && (
          confirmando ? (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted dark:text-[#9C9686]">Excluir essa viagem?</span>
              <button type="button" onClick={handleExcluir} className="font-semibold text-terracotta">Sim, excluir</button>
              <button type="button" onClick={() => setConfirmando(false)} className="text-muted dark:text-[#9C9686]">Cancelar</button>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirmando(true)} className="text-sm font-semibold text-terracotta text-left">Excluir viagem</button>
          )
        )}
      </form>
    </div>
  );
}

/* ============================== Modal: Motorista (com foto de perfil) ============================== */
function MotoristaModal({ motoristaExistente, onClose }) {
  const { cadastrarMotorista, editarMotorista, removerMotorista, viagens } = useApp();
  const { notificar } = useToast();
  const editando = Boolean(motoristaExistente);
  const inputFotoRef = useRef(null);

  const [nome, setNome] = useState(motoristaExistente?.nome ?? '');
  const [telefone, setTelefone] = useState(motoristaExistente?.telefone ?? '');
  const [placa, setPlaca] = useState(motoristaExistente?.placa ?? '');
  const [numero, setNumero] = useState(motoristaExistente?.numero ?? '');
  const [numeroVeiculo, setNumeroVeiculo] = useState(motoristaExistente?.numeroVeiculo ?? '');
  const [ativo, setAtivo] = useState(motoristaExistente?.ativo ?? true);
  const [fotoUrl, setFotoUrl] = useState(motoristaExistente?.fotoUrl ?? null);
  const [fotoArquivo, setFotoArquivo] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);

  const historico = useMemo(() => {
    if (!editando) return [];
    return viagens.filter((v) => v.motoristaId === motoristaExistente.id).sort((a, b) => (a.data < b.data ? 1 : -1));
  }, [viagens, editando, motoristaExistente]);
  const historicoTotais = useMemo(() => ({
    toneladas: historico.reduce((s, v) => s + v.toneladas, 0),
    valor: historico.reduce((s, v) => s + v.valor, 0),
  }), [historico]);

  function handleFoto(e) {
    const arquivo = e.target.files?.[0];
    e.target.value = '';
    if (!arquivo) return;
    setFotoArquivo(arquivo);
    setFotoUrl(URL.createObjectURL(arquivo));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!nome) return;
    setSalvando(true);
    try {
      const dadosMotorista = { nome: nome.trim(), telefone, placa, numero, numeroVeiculo, fotoArquivo };
      if (editando) {
        await editarMotorista(motoristaExistente.id, { ...dadosMotorista, ativo });
        notificar('Motorista atualizado.');
      } else {
        await cadastrarMotorista(dadosMotorista);
        notificar('Motorista cadastrado.');
      }
      onClose();
    } catch (err) {
      console.error(err);
      notificar('Não consegui salvar. Confere a internet e tenta de novo.', 'erro');
    } finally {
      setSalvando(false);
    }
  }
  async function handleExcluir() {
    try {
      await removerMotorista(motoristaExistente.id);
      notificar('Motorista excluído.');
      onClose();
    } catch (err) {
      console.error(err);
      notificar('Não consegui excluir. Confere a internet e tenta de novo.', 'erro');
    }
  }

  return (
    <div className="fixed inset-0 bg-ink/40 flex items-end md:items-center md:justify-center z-40 p-0 md:p-4">
      <form onSubmit={handleSubmit} className="w-full md:max-w-md bg-cream dark:bg-[#1B1A15] rounded-t-3xl md:rounded-3xl p-8 flex flex-col gap-6 max-h-[92%] overflow-auto">
        <div className="flex justify-between items-center">
          <h2 className="font-display text-2xl font-bold text-forest dark:text-gold-light">{editando ? 'Editar motorista' : 'Novo motorista'}</h2>
          <button type="button" onClick={onClose} className={`text-muted dark:text-[#9C9686] text-2xl leading-none ${PRESS}`}>×</button>
        </div>

        <div className="flex items-center gap-4">
          <Avatar url={fotoUrl} size={64} />
          <input ref={inputFotoRef} type="file" accept="image/*" onChange={handleFoto} className="hidden" />
          <button type="button" onClick={() => inputFotoRef.current?.click()} className={`text-sm font-semibold text-forest dark:text-gold-light ${PRESS}`}>
            {fotoUrl ? 'Trocar foto' : 'Adicionar foto de perfil'}
          </button>
        </div>

        <Field label="Nome"><input className={INPUT} value={nome} onChange={(e) => setNome(e.target.value)} required /></Field>
        <Field label="Telefone"><input className={INPUT} value={telefone} onChange={(e) => setTelefone(e.target.value)} placeholder="Ex: (16) 99123-4567" /></Field>
        <Field label="Placa"><input className={INPUT} value={placa} onChange={(e) => setPlaca(e.target.value.toUpperCase())} placeholder="Ex: OQR-4B12" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Nº do motorista"><input className={INPUT} inputMode="numeric" value={numero} onChange={(e) => setNumero(e.target.value.replace(/\D/g, ''))} placeholder="Ex: 00500152" /></Field>
          <Field label="Nº do veículo"><input className={INPUT} inputMode="numeric" value={numeroVeiculo} onChange={(e) => setNumeroVeiculo(e.target.value.replace(/\D/g, ''))} placeholder="Ex: 00025567" /></Field>
        </div>
        <p className="text-[11px] text-muted dark:text-[#9C9686] -mt-3">São os números que aparecem no extrato de pesagem da usina — usados pra identificar o motorista automaticamente ao ler a nota.</p>

        {editando && (
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} /> Ativo
          </label>
        )}

        {editando && (
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <span className={LABEL}>Histórico de viagens</span>
              <span className="text-[11px] text-muted dark:text-[#9C9686]">{historicoTotais.toneladas.toFixed(1)} t · R$ {historicoTotais.valor.toFixed(2).replace('.', ',')}</span>
            </div>
            {historico.length === 0 ? (
              <div className="text-xs text-muted dark:text-[#9C9686] py-2">Nenhuma viagem registrada com esse motorista ainda.</div>
            ) : (
              <div className="flex flex-col gap-2 max-h-56 overflow-auto pr-1">
                {historico.map((v) => {
                  const status = statusMap[v.status] ?? statusMap.em_rota;
                  return (
                    <div key={v.id} className={`${CARD} px-4 py-3 flex justify-between items-center gap-3 text-xs`}>
                      <div className="min-w-0">
                        <div className="font-semibold truncate">{v.produtor}</div>
                        <div className="text-muted dark:text-[#9C9686] mt-0.5">{new Date(v.data + 'T00:00:00').toLocaleDateString('pt-BR')}{v.destino ? ` · → ${v.destino}` : ''}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-bold">{v.toneladas.toFixed(1)} t</div>
                        <div className="text-muted dark:text-[#9C9686]">R$ {v.valor.toFixed(2).replace('.', ',')}</div>
                        <span className={`inline-block mt-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${status.bg} ${status.text}`}>{status.label}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <button type="submit" disabled={salvando} className={BTN_PRIMARY}>{salvando ? 'Salvando…' : (editando ? 'Salvar alterações' : 'Cadastrar motorista')}</button>

        {editando && (
          confirmando ? (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted dark:text-[#9C9686]">Excluir esse motorista?</span>
              <button type="button" onClick={handleExcluir} className="font-semibold text-terracotta">Sim, excluir</button>
              <button type="button" onClick={() => setConfirmando(false)} className="text-muted dark:text-[#9C9686]">Cancelar</button>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirmando(true)} className="text-sm font-semibold text-terracotta text-left">Excluir motorista</button>
          )
        )}
      </form>
    </div>
  );
}

/* ============================== Tela: Home ============================== */
function TelaHome() {
  const { viagens } = useApp();
  const [modalAberto, setModalAberto] = useState(false);
  const [editando, setEditando] = useState(null);
  const hojeStr = new Date().toISOString().slice(0, 10);

  const resumo = useMemo(() => {
    const deHoje = viagens.filter((v) => v.data === hojeStr);
    const pendentes = viagens.filter((v) => v.status === 'pendente');
    return {
      toneladas: deHoje.reduce((s, v) => s + v.toneladas, 0),
      valor: deHoje.reduce((s, v) => s + v.valor, 0),
      pendQtd: pendentes.length,
      pendValor: pendentes.reduce((s, v) => s + v.valor, 0),
    };
  }, [viagens, hojeStr]);

  return (
    <div className="flex flex-col h-full">
      <div className="px-7 pt-8 pb-5 shrink-0">
        <div className="font-display text-[26px] font-bold text-forest dark:text-gold-light tracking-tight">CanaLog</div>
        <div className="text-[13px] text-muted dark:text-[#9C9686] mt-1">Safra 2026 · Fazenda Bela Vista</div>
      </div>
      <div className="px-7 grid grid-cols-2 gap-4 shrink-0">
        <div className="bg-forest rounded-2xl p-6">
          <div className="text-xs font-bold uppercase tracking-wide text-[#B9C9BB]">Hoje</div>
          <div className="text-[28px] font-bold text-cream mt-2.5 leading-none">{resumo.toneladas.toFixed(1)} t</div>
          <div className="text-[13px] text-gold-light mt-2">R$ {resumo.valor.toFixed(2).replace('.', ',')}</div>
        </div>
        <div className={`${CARD} p-6`}>
          <div className="text-xs font-bold uppercase tracking-wide text-terracotta">Pendente</div>
          <div className="text-[28px] font-bold mt-2.5 leading-none">{resumo.pendQtd} viagens</div>
          <div className="text-[13px] text-muted dark:text-[#9C9686] mt-2">R$ {resumo.pendValor.toFixed(2).replace('.', ',')}</div>
        </div>
      </div>
      <div className="px-7 pt-8 pb-3.5 flex justify-between items-center shrink-0">
        <div className="text-[17px] font-bold">Últimas viagens</div>
        <span className="text-[13px] font-semibold text-forest dark:text-gold-light">{viagens.length} no total</span>
      </div>
      <div className="flex-1 overflow-auto px-7 pb-28 md:pb-7 grid grid-cols-1 md:grid-cols-2 gap-3.5 content-start">
        {viagens.length === 0 && <div className="col-span-full text-sm text-muted dark:text-[#9C9686] text-center py-12">Nenhuma viagem ainda. Toca no + pra começar.</div>}
        {viagens.map((v) => (
          <button key={v.id} onClick={() => setEditando(v)} className={`text-left ${PRESS}`}><TripCard viagem={v} /></button>
        ))}
      </div>
      <button onClick={() => setModalAberto(true)} className="absolute right-6 bottom-[104px] md:bottom-9 w-14 h-14 rounded-full bg-gold shadow-lg flex items-center justify-center transition-all duration-150 hover:scale-105 active:scale-90">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#241F16" strokeWidth="2.4" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      </button>
      {modalAberto && <ViagemModal onClose={() => setModalAberto(false)} />}
      {editando && <ViagemModal viagemExistente={editando} onClose={() => setEditando(null)} />}
    </div>
  );
}

/* ============================== Tela: Relatórios ============================== */
function TelaRelatorios() {
  const { viagens, motoristas } = useApp();
  const periodos = [ { chave: 'dia', label: 'Dia', dias: 0 }, { chave: 'semana', label: 'Semana', dias: 6 }, { chave: 'mes', label: 'Mês', dias: 29 }, { chave: 'safra', label: 'Safra', dias: null } ];
  const [periodoChave, setPeriodoChave] = useState('semana');
  const diasLabel = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
  const hoje = useMemo(() => { const d = new Date(); d.setHours(0,0,0,0); return d; }, []);

  function dentro(v, dias) {
    if (dias === null) return true;
    const dv = new Date(v.data + 'T00:00:00');
    const diff = (hoje - dv) / 86400000;
    return diff >= 0 && diff <= dias;
  }
  const periodoAtual = periodos.find((p) => p.chave === periodoChave);
  const viagensPeriodo = viagens.filter((v) => dentro(v, periodoAtual.dias));
  const totalT = viagensPeriodo.reduce((s, v) => s + v.toneladas, 0);
  const totalV = viagensPeriodo.reduce((s, v) => s + v.valor, 0);

  const ultimosDias = useMemo(() => { const arr = []; for (let i = 6; i >= 0; i--) { const d = new Date(hoje); d.setDate(d.getDate() - i); arr.push(d); } return arr; }, [hoje]);
  const barras = ultimosDias.map((d) => { const iso = d.toISOString().slice(0, 10); const total = viagens.filter((v) => v.data === iso).reduce((s, v) => s + v.toneladas, 0); return { label: diasLabel[d.getDay()], total }; });
  const maxBarra = Math.max(1, ...barras.map((b) => b.total));

  const ranking = useMemo(() => {
    const porMotorista = new Map();
    for (const v of viagensPeriodo) {
      const k = v.motoristaId ?? v.motoristaNome;
      if (!porMotorista.has(k)) porMotorista.set(k, { toneladas: 0, valor: 0, viagens: 0, nomeFallback: v.motoristaNome });
      const acc = porMotorista.get(k);
      acc.toneladas += v.toneladas;
      acc.valor += v.valor;
      acc.viagens += 1;
    }
    // Todo motorista cadastrado entra no ranking, mesmo zerado no período.
    const linhas = motoristas.map((m) => {
      const acc = porMotorista.get(m.id);
      return {
        chave: m.id, nome: m.nome, fotoUrl: m.fotoUrl ?? null, ativo: m.ativo,
        toneladas: acc?.toneladas ?? 0, valor: acc?.valor ?? 0, viagens: acc?.viagens ?? 0,
      };
    });
    // Motoristas que já foram removidos mas ainda têm viagens no histórico continuam aparecendo, marcados como removidos.
    for (const [k, acc] of porMotorista.entries()) {
      if (!motoristas.some((m) => m.id === k)) {
        linhas.push({ chave: k, nome: `${acc.nomeFallback} (removido)`, fotoUrl: null, ativo: false, toneladas: acc.toneladas, valor: acc.valor, viagens: acc.viagens });
      }
    }
    return linhas.sort((a, b) => b.toneladas - a.toneladas || a.nome.localeCompare(b.nome));
  }, [viagensPeriodo, motoristas]);
  const temAlgumComViagem = ranking.some((r) => r.toneladas > 0);

  return (
    <div className="flex flex-col h-full">
      <div className="px-7 pt-8 pb-5 shrink-0"><div className="font-display text-[26px] font-bold text-forest dark:text-gold-light">Relatórios</div></div>
      <div className="mx-7 mb-5 bg-transit-bg dark:bg-[#2C2A22] rounded-2xl p-1.5 flex gap-1 shrink-0">
        {periodos.map((p) => (
          <button key={p.chave} onClick={() => setPeriodoChave(p.chave)} className={`flex-1 py-2.5 text-xs font-semibold rounded-xl transition-all duration-200 ${periodoChave === p.chave ? 'bg-forest text-cream shadow-sm' : 'text-muted dark:text-[#9C9686]'}`}>{p.label}</button>
        ))}
      </div>
      <div className="flex-1 overflow-auto px-7 pb-28 md:pb-7">
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-forest rounded-2xl p-6"><div className="text-xs font-bold uppercase tracking-wide text-[#B9C9BB]">Toneladas</div><div className="text-[28px] font-bold text-cream mt-2.5 leading-none">{totalT.toFixed(1)} t</div></div>
          <div className={`${CARD} p-6`}><div className="text-xs font-bold uppercase tracking-wide text-muted dark:text-[#9C9686]">Recebido</div><div className="text-[28px] font-bold mt-2.5 leading-none">R$ {totalV.toFixed(2).replace('.', ',')}</div></div>
        </div>
        <div className="text-xs text-muted dark:text-[#9C9686] mt-2.5 px-1">{viagensPeriodo.length} viagem{viagensPeriodo.length === 1 ? '' : 's'} no período</div>

        <div className={`mt-8 ${CARD} px-6 pt-6 pb-5`}>
          <div className="text-[14px] font-bold mb-5">Últimos 7 dias</div>
          <div className="flex items-end gap-2.5 h-[110px]">
            {barras.map((b, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-2.5 justify-end h-full">
                <div className="w-full rounded-t-lg bg-gold transition-all duration-500 ease-out" style={{ height: `${Math.max(4, Math.round((b.total / maxBarra) * 80))}px` }} title={`${b.total.toFixed(1)} t`}></div>
                <div className="text-[10px] text-muted dark:text-[#9C9686] font-medium">{b.label}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-8 pb-2">
          <div className="text-[14px] font-bold mb-4">Ranking de motoristas no período</div>
          {ranking.length === 0 ? <div className="text-sm text-muted dark:text-[#9C9686] py-4">Nenhum motorista cadastrado ainda.</div> : (
            <div className="flex flex-col gap-3">
              {ranking.map((m, i) => {
                const destaque = temAlgumComViagem && i === 0 && m.toneladas > 0;
                return (
                  <div key={m.chave} className={`flex items-center gap-3.5 ${CARD} px-5 py-4 ${m.toneladas === 0 ? 'opacity-60' : ''}`}>
                    <div className={`rounded-full text-xs font-bold flex items-center justify-center shrink-0 ${destaque ? 'bg-gold text-ink' : 'bg-cream-line dark:bg-[#3A362B] text-ink dark:text-[#F3EEE1]'}`} style={{ width: 24, height: 24 }}>{i + 1}</div>
                    <Avatar url={m.fotoUrl} size={32} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[13.5px] font-semibold truncate">{m.nome}</div>
                      <div className="text-[11px] text-muted dark:text-[#9C9686] mt-0.5">{m.viagens} viagem{m.viagens === 1 ? '' : 's'}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[13.5px] font-bold text-forest dark:text-gold-light">{m.toneladas.toFixed(1)} t</div>
                      <div className="text-[11px] text-muted dark:text-[#9C9686] mt-0.5">R$ {m.valor.toFixed(2).replace('.', ',')}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ============================== Tela: Fotos (extrato, só leitura) ============================== */
function TelaFotos() {
  const { fotos, viagens } = useApp();

  const grupos = useMemo(() => {
    const porViagem = new Map(viagens.map((v) => [v.id, v]));
    const mapa = new Map();
    for (const f of fotos) {
      const v = porViagem.get(f.viagemId);
      const data = v?.data ?? 'sem-data';
      if (!mapa.has(data)) mapa.set(data, []);
      mapa.get(data).push({ ...f, viagem: v });
    }
    return [...mapa.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [fotos, viagens]);

  function formatarData(iso) {
    if (iso === 'sem-data') return 'Viagem removida';
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-7 pt-8 pb-2 shrink-0">
        <div className="font-display text-[26px] font-bold text-forest dark:text-gold-light">Fotos</div>
        <div className="text-[13px] text-muted dark:text-[#9C9686] mt-1.5">
          Extrato de comprovantes por data — a foto da nota é anexada ao cadastrar a viagem, aqui é só consulta.
        </div>
      </div>
      <div className="flex-1 overflow-auto px-7 pt-5 pb-28 md:pb-7">
        {grupos.length === 0 && (
          <div className="text-sm text-muted dark:text-[#9C9686] text-center py-14">
            Nenhum comprovante ainda. Anexe a foto da nota na hora de registrar uma viagem.
          </div>
        )}
        <div className="flex flex-col gap-7">
          {grupos.map(([data, itens]) => (
            <div key={data}>
              <div className="text-xs font-bold uppercase tracking-wide text-muted dark:text-[#9C9686] mb-2.5">{formatarData(data)}</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {itens.map((foto) => (
                  <div key={foto.id} className={`${CARD} p-4 flex gap-4`}>
                    <img src={foto.url} className="w-16 h-16 rounded-xl object-cover shrink-0" />
                    <div className="flex-1 flex flex-col justify-center min-w-0">
                      <div className="text-sm font-semibold truncate">{foto.viagem?.produtor ?? 'Viagem removida'}</div>
                      <div className="text-xs text-muted dark:text-[#9C9686] mt-0.5">{foto.viagem?.motoristaNome}</div>
                      {foto.observacao && <div className="text-xs text-muted dark:text-[#9C9686] italic mt-0.5">{foto.observacao}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ============================== Tela: Motoristas ============================== */
function TelaMotoristas() {
  const { motoristas, viagens } = useApp();
  const [modalAberto, setModalAberto] = useState(false);
  const [editando, setEditando] = useState(null);
  const totais = useMemo(() => { const m = new Map(); for (const v of viagens) m.set(v.motoristaId, (m.get(v.motoristaId) ?? 0) + v.toneladas); return m; }, [viagens]);

  return (
    <div className="flex flex-col h-full">
      <div className="px-7 pt-8 pb-2 shrink-0"><div className="font-display text-[26px] font-bold text-forest dark:text-gold-light">Motoristas</div></div>
      <div className="flex-1 overflow-auto px-7 pt-5 pb-28 md:pb-7 grid grid-cols-1 md:grid-cols-2 gap-3 content-start">
        {motoristas.length === 0 && <div className="col-span-full text-sm text-muted dark:text-[#9C9686] text-center py-12">Nenhum motorista cadastrado.</div>}
        {motoristas.map((m) => (
          <button key={m.id} onClick={() => setEditando(m)} className={`text-left ${PRESS}`}>
            <div className={`${CARD} p-5 h-full`}>
              <div className="flex justify-between items-start gap-3">
                <div className="flex items-center gap-3.5 min-w-0">
                  <Avatar url={m.fotoUrl} size={44} />
                  <div className="min-w-0">
                    <div className="text-sm font-bold truncate">{m.nome}</div>
                    {m.telefone && <div className="text-xs text-muted dark:text-[#9C9686] mt-1">{m.telefone}</div>}
                    {m.placa && <div className="text-xs text-muted dark:text-[#9C9686]">Placa {m.placa}</div>}
                    {(m.numero || m.numeroVeiculo) && <div className="text-xs text-muted dark:text-[#9C9686]">{m.numero ? `Nº ${m.numero}` : ''}{m.numero && m.numeroVeiculo ? ' · ' : ''}{m.numeroVeiculo ? `Veículo ${m.numeroVeiculo}` : ''}</div>}
                  </div>
                </div>
                <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full shrink-0 ${m.ativo ? 'bg-forest-soft dark:bg-[#22362A] text-forest-soft-text dark:text-[#9FD3AE]' : 'bg-transit-bg dark:bg-[#2C2A22] text-transit-text dark:text-[#C9C0A6]'}`}>{m.ativo ? 'Ativo' : 'Inativo'}</span>
              </div>
              <div className="mt-4 pt-4 border-t border-cream-line dark:border-[#322F26] text-xs text-muted dark:text-[#9C9686]">
                Total transportado: <span className="font-bold text-ink dark:text-[#F3EEE1]">{(totais.get(m.id) ?? 0).toFixed(1)} t</span>
              </div>
            </div>
          </button>
        ))}
      </div>
      <div className="px-7 pb-5 pt-2 shrink-0">
        <button onClick={() => setModalAberto(true)} className={`w-full ${BTN_PRIMARY}`}>Cadastrar motorista</button>
      </div>
      {modalAberto && <MotoristaModal onClose={() => setModalAberto(false)} />}
      {editando && <MotoristaModal motoristaExistente={editando} onClose={() => setEditando(null)} />}
    </div>
  );
}

/* ============================== Tela: Configurações ============================== */
function TelaConfig({ escuro, setEscuro }) {
  const { usuario, valorPorTonelada, alterarValorPorTonelada, gerarBackup, restaurarBackup } = useApp();
  const { notificar } = useToast();
  const [valorInput, setValorInput] = useState(valorPorTonelada.toString());
  const [ocupado, setOcupado] = useState(false);
  const inputBackupRef = useRef(null);

  useEffect(() => { setValorInput(valorPorTonelada.toString()); }, [valorPorTonelada]);

  async function salvarValor() {
    const n = parseFloat(valorInput);
    if (Number.isNaN(n) || n <= 0) { notificar('Digita um valor válido.', 'erro'); setValorInput(valorPorTonelada.toString()); return; }
    if (n === valorPorTonelada) return;
    try { await alterarValorPorTonelada(n); notificar('Valor por tonelada atualizado.'); }
    catch (e) { notificar('Não consegui salvar o valor.', 'erro'); setValorInput(valorPorTonelada.toString()); }
  }

  async function handleBackup() {
    setOcupado(true);
    try {
      const json = JSON.stringify(await gerarBackup(), null, 2);
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url; a.download = `canalog-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      notificar('Backup baixado.');
    } catch (e) { console.error(e); notificar('Não consegui gerar o backup agora.', 'erro'); }
    finally { setOcupado(false); }
  }

  async function handleImportar(e) {
    const arquivo = e.target.files?.[0]; e.target.value = '';
    if (!arquivo) return;
    if (!confirm('Restaurar esse backup? Registros com o mesmo ID serão sobrescritos.')) return;
    setOcupado(true);
    try { await restaurarBackup(await arquivo.text()); notificar('Backup restaurado.'); }
    catch (err) { console.error(err); notificar('Esse arquivo não é um backup válido do CanaLog.', 'erro'); }
    finally { setOcupado(false); }
  }

  async function sair() { await sb.auth.signOut(); }

  return (
    <div className="flex flex-col h-full">
      <div className="px-7 pt-8 pb-5 shrink-0"><div className="font-display text-[26px] font-bold text-forest dark:text-gold-light">Configurações</div></div>
      <div className="flex-1 overflow-auto px-7 pb-28 md:pb-7 flex flex-col gap-3">
        <div className={`${CARD} px-6 py-5 flex justify-between items-center`}>
          <span className="text-sm font-medium">Valor por tonelada (R$)</span>
          <input type="number" step="0.5" min="0" value={valorInput} onChange={(e) => setValorInput(e.target.value)} onBlur={salvarValor} className="w-20 text-right border border-cream-line dark:border-[#3A362B] bg-transparent rounded-lg px-2 py-1.5 text-sm" />
        </div>

        <div className={`${CARD} px-6 py-5 flex justify-between items-center`}>
          <span className="text-sm font-medium">Modo escuro</span>
          <button role="switch" aria-checked={escuro} onClick={() => setEscuro((v) => !v)} className={`shrink-0 w-[52px] h-[30px] rounded-full transition-colors duration-200 relative ${escuro ? 'bg-forest' : 'bg-cream-line dark:bg-[#3A362B]'}`}>
            <span style={{ left: escuro ? '25px' : '3px' }} className="absolute top-[3px] w-6 h-6 rounded-full bg-white shadow-md transition-[left] duration-200 ease-out" />
          </button>
        </div>

        <div className={`${CARD} px-6 py-5 flex justify-between items-center gap-3`}>
          <span className="text-sm font-medium">Banco de dados</span>
          <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-forest-soft dark:bg-[#22362A] text-forest-soft-text dark:text-[#9FD3AE]">Nuvem · sincronizado</span>
        </div>

        <div className={`${CARD} px-6 py-5 flex flex-col gap-3`}>
          <span className="text-sm font-medium">Backup dos dados</span>
          <p className="text-xs text-muted dark:text-[#9C9686]">Os dados ficam na nuvem, mas é bom baixar uma cópia de vez em quando (as fotos continuam no Storage).</p>
          <div className="flex gap-2">
            <button disabled={ocupado} onClick={handleBackup} className={`flex-1 ${BTN_PRIMARY} py-2.5`}>Baixar backup</button>
            <input ref={inputBackupRef} type="file" accept="application/json" onChange={handleImportar} className="hidden" />
            <button disabled={ocupado} onClick={() => inputBackupRef.current?.click()} className={`flex-1 ${BTN_GHOST}`}>Restaurar backup</button>
          </div>
        </div>

        <div className={`${CARD} px-6 py-5 flex justify-between items-center gap-3`}>
          <div className="min-w-0">
            <div className="text-sm font-medium">Conta</div>
            <div className="text-xs text-muted dark:text-[#9C9686] truncate">{usuario?.email}</div>
          </div>
          <button onClick={sair} className={`${BTN_GHOST} px-4 text-terracotta`}>Sair</button>
        </div>
      </div>
    </div>
  );
}

/* ============================== Telas de acesso ============================== */
function TelaFaltaConfigurar() {
  return (
    <div className="min-h-full flex items-center justify-center p-6">
      <div className={`${CARD} max-w-md w-full p-8 flex flex-col gap-4`}>
        <div className="font-display text-2xl font-bold text-forest dark:text-gold-light">CanaLog</div>
        <p className="text-sm">Falta conectar o banco de dados.</p>
        <p className="text-sm text-muted dark:text-[#9C9686]">
          Abra o arquivo <code className="font-mono text-xs">config.js</code> do repositório e cole a <b>Project URL</b> e a <b>anon public key</b> do seu projeto no Supabase (Project Settings → API). O passo a passo completo está no README.
        </p>
      </div>
    </div>
  );
}

function TelaLogin() {
  const { notificar } = useToast();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [entrando, setEntrando] = useState(false);

  async function entrar(e) {
    e.preventDefault();
    setEntrando(true);
    const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password: senha });
    setEntrando(false);
    if (error) notificar('E-mail ou senha incorretos.', 'erro');
  }

  return (
    <div className="min-h-full flex items-center justify-center p-6">
      <form onSubmit={entrar} className={`${CARD} max-w-sm w-full p-8 flex flex-col gap-5`}>
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-forest text-cream flex items-center justify-center font-display font-bold text-xl">C</div>
          <div>
            <div className="font-display text-2xl font-bold text-forest dark:text-gold-light leading-none">CanaLog</div>
            <div className="text-xs text-muted dark:text-[#9C9686] mt-1">Entre pra continuar</div>
          </div>
        </div>
        <Field label="E-mail"><input className={INPUT} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
        <Field label="Senha"><input className={INPUT} type="password" autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} required /></Field>
        <button type="submit" disabled={entrando} className={BTN_PRIMARY}>{entrando ? 'Entrando…' : 'Entrar'}</button>
      </form>
    </div>
  );
}

function TelaCarregando({ texto = 'Carregando…' }) {
  return <div className="h-full flex items-center justify-center text-sm text-muted dark:text-[#9C9686]">{texto}</div>;
}

/* ============================== App ============================== */
function Conteudo() {
  const { carregando, erroCarga, recarregar } = useApp();
  const [tela, setTela] = useState('home');
  const [escuro, setEscuro] = useTema();
  const Telas = { home: TelaHome, relatorios: TelaRelatorios, fotos: TelaFotos, motoristas: TelaMotoristas };
  const TelaAtual = Telas[tela];

  return (
    <div className="h-screen flex bg-cream dark:bg-[#171712] overflow-hidden">
      <Sidebar tela={tela} setTela={setTela} />
      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        <main className="flex-1 overflow-hidden">
          <div className="h-full mx-auto w-full max-w-3xl md:py-8 md:px-6">
            <div className="h-full relative md:bg-white md:dark:bg-[#211F19] md:border md:border-cream-line md:dark:border-[#322F26] md:rounded-3xl md:shadow-sm md:overflow-hidden flex flex-col">
              {erroCarga ? (
                <div className="h-full flex flex-col items-center justify-center gap-3 p-8 text-center">
                  <div className="text-sm">Não consegui carregar os dados.</div>
                  <div className="text-xs text-muted dark:text-[#9C9686]">{erroCarga}</div>
                  <button onClick={recarregar} className={`${BTN_PRIMARY} px-6`}>Tentar de novo</button>
                </div>
              ) : carregando ? <TelaCarregando /> : (tela === 'config' ? <TelaConfig escuro={escuro} setEscuro={setEscuro} /> : <TelaAtual />)}
            </div>
          </div>
        </main>
        <BottomNav tela={tela} setTela={setTela} />
      </div>
    </div>
  );
}

function App() {
  useTema(); // aplica o tema salvo já na tela de login
  const [sessao, setSessao] = useState(undefined); // undefined = ainda verificando

  useEffect(() => {
    if (!sb) return;
    sb.auth.getSession().then(({ data }) => setSessao(data.session));
    const { data: sub } = sb.auth.onAuthStateChange((_evento, s) => setSessao(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!sb) return <TelaFaltaConfigurar />;
  if (sessao === undefined) return <TelaCarregando />;
  if (!sessao) return <TelaLogin />;
  return <AppProvider key={sessao.user.id} usuario={sessao.user}><Conteudo /></AppProvider>;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <ToastProvider><App /></ToastProvider>
);
