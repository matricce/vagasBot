## Sobre o projeto

Este projeto se trata de um bot que permite o usuário pesquisar vagas no LinkedIn possibilitando filtrar com base na data de publicação e palvras-chave.

## Requisitos

- NodeJS instalado na máquina
- Bot criado no Telegram

## Como usar o projeto

- Com o token do bot em mãos, criar um arquivo na pasta do projeto com o nome **.env** e colocar o token dentro do arquivo, na variável **BOT_TOKEN** seguinho como exemplificado no arquivo **.env.example**;

- Abra um novo terminal na pasta do projeto;

- Para instalar as dependências do projeto, execute o comando **npm install**;

- Para executar o bot, execute o comando **npm run start:dev**.

## Docker

- Buildar a imagem: **docker build -t vagas-bot-image .**
- Rodar o container: **docker run -d --env-file ./.env --name vagas-bot vagas-bot-image**
- Parar o container: **docker stop vagas-bot**
- Iniciar o container: **docker start vagas-bot**
- Remover o container: **docker rm vagas-bot**

## Como usar o bot

- Iniciar uma conversa com o bot no Telegram;

- Comandos:

  - /pesquisar - inicia a pesquisa de vagas
  - /cancelar - cancela a pesquisa
  - /periodo - filtro para vagas mais recentes (informar o tempo em segundos)
  - /bloquear - filtra palavras que não devem aparecer nos resultados
  - /config - mostra as configurações atuais
  - /ajuda - mostra os comandos disponíveis e como usá-los

- Exemplos

  ```
  /periodo 86400
  ```

  86400 segundos = 1 dia (60seg * 60min * 24h)

  ```
  /bloquear
  sr
  pl
  pleno
  senior
  ```

  ```
  /pesquisar desenvolvedor
  ```
