# CanaLog

Gestão do transporte de cana: viagens, motoristas, comprovantes e relatórios.
Leitura automática do extrato de pesagem por OCR, dados na nuvem e sincronização em tempo real entre aparelhos.

**Custo: zero.** GitHub Pages (hospedagem) + Supabase plano Free (banco, login e fotos) + Tesseract (OCR que roda no próprio aparelho).

---

## Como colocar no ar

### 1. Criar o banco no Supabase

1. Entre em [supabase.com](https://supabase.com) → **New project**. Nome: `canalog`. Região: **South America (São Paulo)**. Guarde a senha do banco num lugar seguro.
2. Quando o projeto terminar de criar, vá em **SQL Editor → New query**, cole **todo** o conteúdo de `supabase/schema.sql` e clique em **Run**.
   Isso cria as tabelas, as regras de segurança, o bucket privado das fotos e liga o tempo real. Pode rodar de novo sem problema.

### 2. Criar os usuários (você e o vô)

1. **Authentication → Users → Add user → Create new user**.
2. Coloque e-mail e senha e marque **Auto Confirm User**. Repita pro segundo usuário.
3. **Authentication → Sign In / Providers** → desative **Allow new users to sign up**.
   Isso garante que ninguém mais consegue criar conta, mesmo achando o link do site.

### 3. Conectar o app ao banco

1. **Project Settings → API Keys** (ou **API**, em projetos antigos). Copie:
   - a **Project URL** (ex: `https://abcdefgh.supabase.co`), que fica em **Data API** ou no topo da página;
   - a **anon public key** (ou **publishable key**, nos projetos novos).
2. Abra `config.js` e cole os dois valores nos lugares indicados.

> ⚠️ Nunca coloque a **service_role key** / **secret key** no `config.js`. Ela ignora todas as regras de segurança.

### 4. Publicar no GitHub Pages

1. No GitHub: **New repository** → nome `canalog` → **Public** (o Pages grátis exige repositório público; os dados continuam protegidos pelo login).
2. Na página do repositório: **Add file → Upload files** e **arraste o conteúdo da pasta** (os arquivos e as pastas `vendor`, `icons` e `supabase`), não o .zip → **Commit changes**.
3. **Settings → Pages → Build and deployment** → Source: **Deploy from a branch** → Branch: `main` / `(root)` → **Save**.
4. Em 1 ou 2 minutos o site fica em `https://SEU-USUARIO.github.io/canalog/`.

### 5. Instalar no celular

Abra o link no celular e faça login:
- **Android (Chrome):** menu ⋮ → **Adicionar à tela inicial / Instalar app**.
- **iPhone (Safari):** botão Compartilhar → **Adicionar à Tela de Início**.

---

## Uso no dia a dia

- **Cadastre os motoristas com o Nº do motorista e o Nº do veículo** que aparecem no extrato da usina. É assim que o app reconhece quem fez a viagem ao ler a nota.
- Ao registrar uma viagem, toque em **Anexar nota de pesagem**. O app lê o extrato e preenche fazenda, usina, toneladas, data e motorista. **Sempre confira antes de salvar.**
- O app aprende os nomes que você já usou: se o OCR ler algo como "Usina Santa Rita E Arte" e você já tiver salvo "Usina Santa Rita", ele usa o nome certo.
- **Configurações → Baixar backup** de vez em quando, por segurança.

## Pontos de atenção do plano grátis

- **Supabase pausa o projeto depois de 7 dias sem nenhum acesso.** Na entressafra, se isso acontecer, entre no painel e clique em **Restore project**. Nenhum dado se perde.
- Limites do Free: 500 MB de banco e 1 GB de arquivos. As fotos são comprimidas antes de subir (~200 KB cada), então cabem milhares.
- O leitor de notas foi feito pro layout do extrato da **Usina Santa Rita**. Se o formato mudar ou entrar outra usina, ajuste a função `extrairDadosDaNota` em `ocr.js`.

## Atualizando o app

Pra subir uma versão nova sem perder a configuração: no GitHub, **Add file → Upload files** e arraste os arquivos/pastas da atualização. Arquivos com o mesmo nome são substituídos; os outros continuam lá. **Nunca envie um `config.js` com `COLE_AQUI`** por cima do seu.

Depois do commit, espere 1–2 minutos e, no celular, feche e abra o app de novo.

## Dicas de uso (versão 2)

- **Botão + no meio da barra**: registra uma viagem. "Tirar foto" abre a câmera e o app lê a nota.
- **Toque numa viagem** pra ver o extrato, as fotos, mudar a situação ou marcar como paga.
- **Motoristas → toque no motorista → Acerto**: mostra o que está a pagar, manda o extrato no WhatsApp e marca tudo como pago de uma vez.
- **Ajustes** (ícone no canto de cima): valor por tonelada, tema claro/escuro e **letra grande**.
- O botão **voltar** do Android fecha a janela aberta e, fora do Início, volta pro Início.

---

## Estrutura

```
index.html          página principal (carrega tudo)
app.jsx             o app (React + JSX, compilado no navegador pelo Babel)
ocr.js              leitura das notas (Tesseract) + extração dos campos
config.js           URL e chave pública do Supabase  ← editar
manifest.json       permite instalar como app
supabase/schema.sql estrutura do banco + segurança + storage + tempo real
vendor/             bibliotecas locais (React, Supabase, Babel, Tesseract, CSS e fontes)
icons/              ícones do app
```

Todas as bibliotecas e as fontes ficam dentro do repositório. O app não depende de nenhum servidor externo além do Supabase.

Para editar: mude `app.jsx`, faça commit e o GitHub Pages atualiza sozinho. Se o celular continuar mostrando a versão antiga, feche e abra o app de novo.

Se mudar alguma classe de estilo nova (Tailwind) que ainda não existia no app, ela precisa estar em `vendor/tailwind.css`, que é gerado com:
```
npx tailwindcss@3 -c dev/tailwind.config.js -i dev/in.css -o vendor/tailwind.css --minify
```
(rodando na raiz do repositório; a configuração está na pasta `dev/`).
