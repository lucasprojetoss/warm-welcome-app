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

A versão desktop enxuta fica na pasta `desktop` e instala somente o Electron.

### Jeito mais fácil no Windows

1. Baixe o ZIP mais recente do repositório e extraia.
2. Abra `warm-welcome-app-main\desktop`.
3. Dê dois cliques em `INICIAR-LUCAS-GRAVACOES.bat`.
4. Na primeira execução, ele instala apenas o Electron.
5. Nas próximas execuções, abre direto.

Não rode `npm install` na pasta principal para testar o Electron. A pasta principal continua sendo o projeto Lovable; a versão desktop foi isolada para evitar baixar dependências desnecessárias.

A janela Electron usa `backgroundThrottling: false` e ativa `powerSaveBlocker` enquanto o lote estiver em processamento.
