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
