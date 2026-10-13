# Lucas Gravações

Projeto conectado ao Lovable e ao GitHub.

## Lucas Gravações Desktop (Electron)

A versão usada no Windows fica na pasta `desktop` e abre o sistema de Auto Vinhetas como aplicativo.

### Primeira instalação no Windows

1. Baixe e extraia o ZIP do repositório.
2. Abra a pasta `desktop`.
3. Execute `INSTALAR-AUTO-ATUALIZACAO.bat` uma única vez.
4. O instalador cria uma cópia fixa em `%LOCALAPPDATA%\LucasGravacoes`.
5. Ele cria o atalho **Lucas Gravacoes** na Área de Trabalho.

Depois disso, use somente o atalho da Área de Trabalho. Ao abrir, ele tenta buscar atualizações no GitHub e, se não conseguir atualizar, mantém a instalação já existente.

### Processamento em segundo plano

O Electron desativa o throttling da janela e ativa `powerSaveBlocker` durante o processamento do lote. Ao minimizar, o aplicativo permanece normalmente na barra de tarefas do Windows.

### Dados permanentes

Vinheta padrão, metadados, capa, perfis e estado de retomada ficam na pasta de dados do aplicativo e não são apagados pelas atualizações do código.

## Fila automática de lotes

No aplicativo desktop, é possível adicionar até 30 lotes dentro da mesma janela. Cada lote guarda sua pasta, vinheta, metadados, capa e configuração. A fila processa um lote por vez e inicia o próximo automaticamente. Em caso de interrupção, as músicas já concluídas do lote ficam registradas para retomada.

## Modo portátil

Execute `PREPARAR-LUCAS-GRAVACOES-PORTATIL.bat` em um computador com Node.js/npm e escolha o HD, SSD externo ou pendrive. O preparador cria `LucasGravacoes-Portable` com o Electron e o codificador MP3 locais. Depois, abra pelo arquivo `ABRIR-LUCAS-GRAVACOES-PORTATIL.vbs` dentro da pasta portátil. Dados, vinheta, perfis, fila e retomadas ficam em `LucasGravacoes-Dados`. Caminhos de músicas no mesmo disco são independentes da letra atribuída pelo Windows.

Quando estiver no modo portátil, use o botão **Atualizar portátil** dentro do próprio Lucas Gravações. O GitHub publica automaticamente um pacote pronto com Electron e dependências; o programa baixa esse pacote, preserva `LucasGravacoes-Dados`, troca a versão e reinicia. A atualização do portátil não depende de Git, Node.js ou npm no computador onde o HD estiver conectado.
