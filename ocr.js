// ============================================================================
// OCR 100% local (Tesseract.js). Todos os arquivos ficam em /vendor/tesseract,
// então nada depende de servidor externo e não tem custo nenhum.
// ============================================================================
window.__ocrWorkerPromise = null;

function urlLocal(caminho) { return new URL(caminho, window.location.href).href; }

async function getOcrWorker() {
  if (!window.__ocrWorkerPromise) {
    window.__ocrWorkerPromise = Tesseract.createWorker('por', 1 /* LSTM */, {
      workerPath: urlLocal('vendor/tesseract/worker.min.js'),
      corePath: urlLocal('vendor/tesseract/'),   // escolhe sozinho a versão mais rápida pro aparelho
      langPath: urlLocal('vendor/tesseract/'),   // carrega vendor/tesseract/por.traineddata.gz
      gzip: true,
      logger: (m) => {
        if (!m.status) return;
        console.log('[OCR]', m.status, Math.round((m.progress || 0) * 100) + '%');
        // a tela de nova viagem escuta isso pra mostrar a barra de progresso
        if (typeof window.__ocrOnProgress === 'function') { try { window.__ocrOnProgress(m); } catch (e) {} }
      },
    }).catch((e) => { window.__ocrWorkerPromise = null; throw e; });
  }
  return window.__ocrWorkerPromise;
}

async function reconhecerTextoDaImagem(arquivo) {
  const worker = await getOcrWorker();
  const { data } = await worker.recognize(arquivo);
  console.log('[OCR] texto lido:\n' + data.text);
  return data.text;
}

// Tolerante a pequenos erros de leitura do OCR (pontos/dois-pontos trocados,
// letras confundidas com números, espaços a mais etc.).
function extrairDadosDaNota(texto) {
  const resultado = {
    produtor: null, destino: null, toneladas: null, data: null,
    numeroMotorista: null, numeroVeiculo: null,
  };
  const t = texto.replace(/\r/g, '');

  // Destino: qualquer "USINA ALGUMA COISA" no texto
  const mUsina = t.match(/USINA\s+([A-ZÀ-Ý][A-ZÀ-Ý ]{2,30})/i);
  if (mUsina) {
    const nome = mUsina[1].replace(/[*]+/g, '').replace(/\s+/g, ' ').trim();
    resultado.destino = 'Usina ' + nome.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  }

  // Fazenda: pega o que vem depois de "Fazenda", tirando o código numérico e o "Ds: ..."
  const linhaFazenda = t.split('\n').find((l) => /faz/i.test(l) && /ds|\d{3,}/i.test(l));
  if (linhaFazenda) {
    let f = linhaFazenda
      .replace(/^.*?fazenda\s*[:.;]?\s*/i, '')   // remove "Fazenda:"
      .replace(/^\d+\s*[-–]\s*/, '')              // remove "2960-"
      .replace(/\s+D[s5]\s*[:.]?.*$/i, '')        // remove " Ds: 110"
      .trim();
    if (f.length >= 3) resultado.produtor = f;
  }

  // Peso líquido total (em kg) → toneladas
  const mLiquido = t.match(/Total\s*L[ií1l]qu[ií1l]do\s*[:.;]?\s*([\d.,]+)/i);
  if (mLiquido) {
    const numero = parseFloat(mLiquido[1].replace(/\./g, '').replace(',', '.'));
    if (!Number.isNaN(numero) && numero > 0) resultado.toneladas = Number((numero / 1000).toFixed(2));
  }

  // Data: prefere a de "Entrada"; se não achar, a primeira data do texto
  const mData = t.match(/Entrada[^\d]{0,6}(\d{2})\/(\d{2})\/(\d{4})/i) || t.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (mData) resultado.data = `${mData[3]}-${mData[2]}-${mData[1]}`;

  // Número do motorista e do veículo (como aparecem no extrato)
  const mMot = t.match(/Motorista\s*[:.;]?\s*(\d{3,})/i);
  if (mMot) resultado.numeroMotorista = mMot[1];
  const mVei = t.match(/Ve[ií1l]cu[l1]o\s*[:.;]?\s*(\d{3,})/i);
  if (mVei) resultado.numeroVeiculo = mVei[1];

  return resultado;
}

// Compara números ignorando zeros à esquerda ("00500152" == "500152")
function mesmoNumero(a, b) {
  if (!a || !b) return false;
  const limpa = (x) => String(x).replace(/\D/g, '').replace(/^0+/, '');
  return limpa(a) !== '' && limpa(a) === limpa(b);
}
