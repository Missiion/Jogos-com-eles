# Jogos com Eles — Setup Guide

## Ficheiros do projeto

```
jogos-com-eles/
├── index.html      ← página principal
├── styles.css      ← estilos
├── app.js          ← lógica da aplicação
├── firebase.js     ← configuração Firebase (tens de preencher)
└── README.md       ← este ficheiro
```

---

## Passo 1 — Criar o projeto Firebase

1. Vai a **https://console.firebase.google.com**
2. Clica em **"Adicionar projeto"**
3. Nome do projeto: `jogos-com-eles` (ou o que quiseres)
4. Desativa o Google Analytics (não precisas para isto)
5. Clica **"Criar projeto"** e espera

---

## Passo 2 — Criar a base de dados Firestore

1. No menu lateral, clica em **"Firestore Database"**
2. Clica **"Criar base de dados"**
3. Escolhe **"Começar no modo de teste"** (permite leitura/escrita por 30 dias — depois vamos proteger)
4. Escolhe a localização mais próxima (ex: `eur3` para Europa)
5. Clica **"Ativar"**

---

## Passo 3 — Registar a aplicação Web

1. No painel do projeto, clica no ícone **`</>`** (Web)
2. Nome da app: `jogos-com-eles`
3. **NÃO** ativas o Firebase Hosting (vais usar GitHub Pages)
4. Clica **"Registar app"**
5. Vai aparecer um bloco de código assim:

```js
const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "jogos-com-eles.firebaseapp.com",
  projectId: "jogos-com-eles",
  storageBucket: "jogos-com-eles.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123:web:abc"
};
```

6. **Copia estes valores** e cola no ficheiro `firebase.js`

---

## Passo 4 — Proteger a base de dados (Regras Firestore)

No Firebase Console:
1. Vai a **Firestore Database → Regras**
2. Substitui o conteúdo por:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /games/{gameId} {
      // Qualquer pessoa pode LER (para mostrar a lista)
      allow read: always;
      
      // Só escreve se vier com a senha correta no campo "secret"
      // (proteção básica — para uso pessoal é suficiente)
      allow write: if false; // <-- por agora bloqueado; 
                              // vamos mudar isto com autenticação
    }
  }
}
```

> **Nota:** Por agora, para testar, mantém o modo de teste (allow read, write: if true).
> Quando quiseres bloquear, fala comigo e adicionamos autenticação Firebase.

---

## Passo 5 — Credenciais IGDB (Twitch)

1. Vai a **https://dev.twitch.tv/console**
2. Faz login com a tua conta Twitch (cria uma se não tens)
3. Clica em **"Register Your Application"**
4. Preenche:
   - Name: `jogos-com-eles`
   - OAuth Redirect URLs: `http://localhost`
   - Category: `Website Integration`
5. Clica **"Create"**
6. Copia o **Client ID**
7. Clica **"New Secret"** e copia o **Client Secret**

### Obter o Access Token:

Corre este comando no terminal (substitui os valores):

```bash
curl -X POST \
  'https://id.twitch.tv/oauth2/token' \
  -d 'client_id=SEU_CLIENT_ID&client_secret=SEU_CLIENT_SECRET&grant_type=client_credentials'
```

Vais receber:
```json
{
  "access_token": "abc123...",
  "expires_in": 5035871,
  "token_type": "bearer"
}
```

Copia o `access_token`.

---

## ⚠️ Problema CORS do IGDB

A API do IGDB **bloqueia requests diretos do browser** (CORS).
Para resolver, tens duas opções:

### Opção A — Para testar localmente (mais fácil)
Usa uma extensão de browser que desativa CORS temporariamente, como:
- **"CORS Unblock"** no Chrome (só para desenvolvimento)

### Opção B — Proxy Cloudflare Worker (recomendado para produção)
Cria um Worker gratuito em **https://workers.cloudflare.com** com este código:

```js
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const target = "https://api.igdb.com/v4" + url.pathname;
    
    const res = await fetch(target, {
      method: request.method,
      headers: {
        "Client-ID": "SEU_CLIENT_ID",
        "Authorization": "Bearer SEU_ACCESS_TOKEN",
        "Content-Type": "text/plain",
      },
      body: request.body,
    });

    const data = await res.json();
    return new Response(JSON.stringify(data), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
        "Access-Control-Allow-Headers": "*",
      }
    });
  }
}
```

Depois substitui `IGDB_PROXY` no `app.js` pelo URL do teu Worker (ex: `https://igdb-proxy.o-teu-nome.workers.dev`).

---

## Passo 6 — Preencher os ficheiros

### `firebase.js`
```js
const firebaseConfig = {
  apiKey:            "colar aqui",
  authDomain:        "colar aqui",
  projectId:         "colar aqui",
  storageBucket:     "colar aqui",
  messagingSenderId: "colar aqui",
  appId:             "colar aqui"
};
```

### `app.js` (primeiras linhas de CONFIG)
```js
const IGDB_PROXY        = "URL do teu proxy Cloudflare Worker";
const IGDB_CLIENT_ID    = "o teu Twitch Client ID";
const IGDB_ACCESS_TOKEN = "o teu Bearer token";
```

---

## Passo 7 — Testar localmente

Não podes abrir o `index.html` diretamente como ficheiro (o Firebase/ES modules precisam de um servidor).

Usa o Live Server do VS Code, ou no terminal:

```bash
# Com Python
python3 -m http.server 8000

# Com Node.js
npx serve .
```

Abre `http://localhost:8000`

---

## Passo 8 — Publicar no GitHub Pages

1. Cria um repositório no GitHub
2. Faz push de todos os ficheiros
3. Nas Settings do repo → Pages → Source: `main` branch, pasta `/root`
4. GitHub Pages vai dar-te um URL como `https://teu-username.github.io/jogos-com-eles`

---

## Como usar o Admin Mode

1. Na página principal, sem clicar em nenhum input, escreve: **`admin`**
2. Vai aparecer um indicador no canto inferior direito a mostrar o que estás a escrever
3. O painel admin abre automaticamente
4. Pesquisa um jogo, clica **+ Adicionar**
5. O jogo aparece na lista em tempo real, para ti e para os teus amigos

---

## Estrutura da coleção Firestore

```
games/
  {documentId}/
    igdbId:   number   ← ID do jogo no IGDB
    addedAt:  timestamp
```

Os dados completos (screenshots, trailers, etc.) são sempre buscados do IGDB em tempo real e guardados em cache no browser.
