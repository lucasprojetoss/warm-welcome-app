# Warm Welcome App

.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/1e2b929e-7609-4704-be35-2bfedc12cdb0).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```


## Lucas Gravações Desktop (Electron)

A versão desktop reaproveita o mesmo `index.html` do sistema e abre em uma janela Electron própria.

### Testar no Windows

É necessário ter Node.js e npm instalados. Depois, dentro da pasta do projeto:

```sh
npm install
npm run electron:start
```

O Electron abre o Lucas Gravações como programa de computador. A janela foi configurada com processamento de fundo sem throttling e ativa proteção contra suspensão enquanto um lote estiver em andamento.

### Gerar instalador do Windows

```sh
npm run electron:dist
```

O instalador será gerado em `dist-electron/`.

### Estrutura Electron

- `electron/main.cjs` — processo principal do aplicativo.
- `electron/preload.cjs` — ponte segura entre a interface e o processo principal.
- `index.html` — mesma interface usada no navegador/PWA.
- `analysis-worker.js` — análise musical em Worker.
- `mp3-worker.js` — mixagem/codificação MP3 em Worker.

Enquanto há processamento, a interface avisa o Electron para usar `powerSaveBlocker` com `prevent-app-suspension`. A janela também usa `backgroundThrottling: false`, para que minimizar não reduza os timers e Workers como acontece no navegador comum.
