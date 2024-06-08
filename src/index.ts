import 'dotenv/config';
import { Bot, CommandContext, Context, Keyboard } from 'grammy';
import { cancelSearch, helpMessage, initSearch, updateBlockList, updateInterval } from './functions';
import logger, { errLogger } from './logger';
import { Search } from './types';

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  throw new Error('BOT_TOKEN não encontrado!');
}

const pesquisa: Search = {
  jobRole: 'dev',
  blacklisted: ['sr', 'pl', 'pleno', 'senior', 'sênior', 'experiência', 'experiencia', 'experience'],
  datePosted: 86400,
  revoke: false,
  inProgress: '',
  ETA: 0,
  reset: () => {
    pesquisa.revoke = false;
    pesquisa.inProgress = '';
    pesquisa.ETA = 0;
  },
  keyboard: new Keyboard().text('/pesquisar').text('/config').text('/cancelar').resized(),
};

const bot = new Bot(BOT_TOKEN);

bot.command(['start', 'help', 'ajuda'], ctx => {
  helpMessage(ctx, pesquisa);
});

bot.command('bloquear', (ctx: Context) => {
  updateBlockList(ctx, pesquisa);
});

bot.command('pesquisar', async ctx => {
  initSearch(ctx, pesquisa);
});

bot.command('config', ctx => {
  showSettings(ctx, pesquisa);
});

bot.command('cancelar', ctx => {
  cancelSearch(ctx, pesquisa);
});

bot.command('periodo', ctx => {
  updateInterval(ctx, pesquisa);
});

const init = async () => {
  bot
    .start()
    .then(() => logger.info('Bot iniciado!'))
    .catch((err: Error) => errLogger('Erro ao iniciar bot', err));
};

init();
function showSettings(ctx: CommandContext<Context>, pesquisa: Search) {
  throw new Error('Function not implemented.');
}
