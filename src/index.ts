import { Bot, Context, InputFile, Keyboard } from 'grammy';
import puppeteer, { Page } from 'puppeteer';
import fs from 'fs';
import { Message } from 'grammy/out/platform.node';
const { htmlToText } = require('html-to-text');
import 'dotenv/config';

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  throw new Error('BOT_TOKEN não encontrado!');
}

type Search = {
  jobRole: string;
  blacklisted: string[];
  datePosted: number;
  revoke: boolean;
  inProgress: string;
  ETA: number;
  reset: () => void;
  keyboard: Keyboard;
};

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

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const strIncludes = (str: string, list: string[]): string[] | [] => list.filter(item => str.match(new RegExp(`\\b${item}\\b`, 'i')));

const search = async (pesq: Search, ctx: Context, message: Message.TextMessage): Promise<void> => {
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: true,
    args: ['--no-sandbox'],
  });

  const homeUrl = `https://br.linkedin.com/jobs/search?keywords=${pesq.jobRole}&location=Brazil&f_TPR=r${pesq.datePosted}&position=1&pageNum=0`;

  const resultados: string[] = [];
  const bloqueados: string[] = [];

  const page = await browser.newPage();
  await page.goto(homeUrl);

  while (page.url().includes('authwall?trk=qf&original_referer')) {
    await page.goto(homeUrl);
    await wait(3000);
  }

  const qtdVagas =
    (await page
      .evaluate(() => Number(document.querySelector('.results-context-header__job-count')?.innerHTML))
      .catch(err => console.log(`Erro ao selecionar qtdVagas, ${err}`))) || 0;
  const whileObj = {
    lastPercent: '',
    elapsed: 0,
  };
  while ((await page.evaluate(() => document.querySelectorAll('.jobs-search__results-list > li').length)) < qtdVagas && !pesq.revoke) {
    const percentage = (((await page.evaluate(() => document.querySelectorAll('.jobs-search__results-list > li').length)) / qtdVagas) * 100).toFixed(
      2,
    );

    if (whileObj.lastPercent !== percentage) {
      await ctx.api
        .editMessageText(message.chat.id, message.message_id, `🤖Carregando lista de vagas... ${percentage}%`)
        .catch(err => console.log(`Erro ao editar mensagem, ${err}`));
      whileObj.lastPercent = percentage;
      whileObj.elapsed = 0;
    }
    await page.keyboard.press('End');
    await wait(500);
    whileObj.elapsed += 500;
    if (whileObj.elapsed > 2000) {
      const buttonShowMoreExists: boolean = await page.evaluate(() => {
        const btn: HTMLButtonElement | null = document.querySelector('.infinite-scroller__show-more-button--visible');
        btn?.click();
        return !!btn;
      });
      if (buttonShowMoreExists) {
        whileObj.elapsed = 0;
      }
    }
    if (whileObj.elapsed > 4000) {
      break;
    }
  }

  const newTab = await browser.newPage();

  const jobs = await page.evaluate(() =>
    [...document.querySelectorAll('.jobs-search__results-list > li > div')].map(div => {
      return {
        href: div
          .querySelector('div > a')
          ?.getAttribute('href')!
          .replace(/\?refId.+/, ''),
        title: (div.querySelector('div > .base-search-card__title') as HTMLElement).innerText,
        company: (div.querySelector('div > .base-search-card__subtitle') as HTMLElement).innerText,
      };
    }),
  );

  for await (const [idx, job] of jobs.entries()) {
    if (pesq.revoke) {
      pesq.revoke = false;
      await ctx.api
        .editMessageText(
          message.chat.id,
          message.message_id,
          `🤖Processando... ${idx + 1}/${jobs.length} vagas` +
            `\nAdicionadas: ${resultados.length}` +
            `\nBloqueadas: ${bloqueados.length}` +
            (pesquisa.inProgress && `\nETA:` + sec2RelativeTime(pesquisa.ETA)) +
            `\nCancelado!`,
        )
        .catch(err => console.log(`Erro ao editar mensagem, ${err}`));
      break;
    }

    await ctx.api
      .editMessageText(
        message.chat.id,
        message.message_id,
        `🤖Processando... ${idx + 1}/${jobs.length} vagas` +
          `\nAdicionadas: ${resultados.length}` +
          `\nBloqueadas: ${bloqueados.length}` +
          (pesquisa.inProgress && `\nETA:` + sec2RelativeTime(pesquisa.ETA)),
      )
      .catch(err => console.log(`Erro ao editar mensagem, ${err}`));
    const palavrasBloqueadasTitulo = strIncludes(job.title, pesq.blacklisted);
    if (palavrasBloqueadasTitulo.length > 0) {
      bloqueados.push(
        `🚫Bloqueada, no título contém: '${palavrasBloqueadasTitulo.join(', ')}'` +
          `\n🏢Empresa: ${job.company}` +
          `\n☕️Título: ${job.title}` +
          `\n🔗Link: ${job.href}`,
      );
      continue;
    }

    await newTab.goto(job.href!).catch(err => console.log(`Erro ao abrir ${job.href}, Erro: ${err}`));

    const testPage = async (pg: Page) => await pg.evaluate(() => document.querySelector('script[type="application/ld+json"]')).catch(() => '');
    const whileObj = {
      elapsed: 0,
      attempts: 0,
    };
    while (!(await testPage(newTab)) && !pesq.revoke) {
      const response = await newTab.goto(job.href!).catch(err => console.log(`Erro ao abrir ${job.href}, ${err}`));
      if (response?.status() === 429) {
        await wait(20000);
        continue;
      }
      whileObj.attempts++;
      if (whileObj.attempts > 3) {
        break;
      }
      await wait(2500);
    }

    await wait(Math.random() * (4000 - 2500) + 2500);
    pesq.ETA = (jobs.length - idx) * 4;
    const newTabUrl = newTab.url();

    const jobJSON: any = await newTab.evaluate(() => {
      const href = document.querySelector('.top-card-layout__cta')?.getAttribute('href');
      const applicants = (document.querySelector('.num-applicants__caption') as HTMLElement)?.innerText.trim() || 'Info desconhecida';
      const el = document.querySelector('script[type="application/ld+json"]');
      if (!el) {
        return undefined;
      }
      const obj = JSON.parse(el.innerHTML);
      const tempElement = document.createElement('div');

      tempElement.innerHTML = obj.description;
      obj.description = tempElement.textContent;
      tempElement.innerHTML = obj.title;
      obj.title = tempElement.textContent;
      tempElement.innerHTML = obj.hiringOrganization.name;
      obj.hiringOrganization.name = tempElement.textContent;

      obj.href = href;
      obj.applicants = applicants;
      return obj;
    });

    if (!jobJSON) {
      continue;
    }

    const linkParaVaga = decodeURIComponent(jobJSON.href || '').replace(/https:\/\/.+?url=/, '');
    const aplicacaoRapida = newTabUrl;
    jobJSON.jobUrl = linkParaVaga || !newTabUrl.includes('authwall?trk=qf&original_referer') ? aplicacaoRapida : undefined;
    jobJSON.urlType = linkParaVaga ? '(externo)' : '(app rápida)';

    const palavrasBloqueadasDescricao = strIncludes(jobJSON.description, pesq.blacklisted);

    if (palavrasBloqueadasDescricao.length > 0) {
      bloqueados.push(
        `🚫Bloqueada` +
          `, na descrição contém: '${palavrasBloqueadasDescricao.join(', ')}'` +
          `\n🏢Empresa: ${jobJSON.hiringOrganization.name}` +
          `\n☕️Título: ${jobJSON.title}` +
          `\n🔗Link ${jobJSON.urlType}: ${jobJSON.jobUrl}` +
          `\n📅Data: ${Intl.DateTimeFormat('pt-BR', {
            dateStyle: 'short',
            timeStyle: 'medium',
            timeZone: 'America/Sao_Paulo',
          }).format(new Date(jobJSON.datePosted))}` +
          `\n🐻Candidatos: ${jobJSON.applicants}`,
      );
      continue;
    }

    if (jobJSON.jobUrl) {
      resultados.push(
        `🏢Empresa: ${jobJSON.hiringOrganization.name}` +
          `\n☕️Título: ${jobJSON.title}` +
          `\n🔗Link ${jobJSON.urlType}: ${jobJSON.jobUrl}` +
          `\n📅Data: ${Intl.DateTimeFormat('pt-BR', {
            dateStyle: 'short',
            timeStyle: 'medium',
            timeZone: 'America/Sao_Paulo',
          }).format(new Date(jobJSON.datePosted))}` +
          `\n🐻Candidatos: ${jobJSON.applicants}` +
          `\n📙Descrição:\n${htmlToText(jobJSON.description, {
            wordwrap: 130,
          })}`,
      );
    }
  }
  pesq.reset();
  const now = Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'medium',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date());
  if (resultados.length > 0) {
    fs.writeFileSync('resultados.txt', `Pesquisa por '${pesq.jobRole}', em ${now}\n` + resultados.join(`\n${''.padStart(60, '✨')}\n\n`));
  }
  if (bloqueados.length > 0) {
    fs.writeFileSync('bloqueados.txt', `Pesquisa por '${pesq.jobRole}', em ${now}\n` + bloqueados.join(`\n${''.padStart(60, '✨')}\n\n`));
  }
};

const botBusy = (ctx: Context): boolean => {
  if (pesquisa.inProgress) {
    ctx.reply(`Há uma pesquisa em andamento por ${pesquisa.inProgress}, aguarde! (aprox. ${sec2RelativeTime(pesquisa.ETA)})`, {
      reply_markup: pesquisa.keyboard,
    });
    return true;
  }
  return false;
};

const sec2RelativeTime = (sec: number): string => {
  const di = Math.floor(sec / 86400) || '';
  const hr = Math.floor((sec % 86400) / 3600) || '';
  const min = Math.floor((sec % 3600) / 60) || '';
  const se = Math.floor(sec % 60) || '';
  return '' + (di && `${di}d`) + (hr && ` ${hr}hr`) + (min && ` ${min}min`) + (se && ` ${se}seg`);
};

const bot = new Bot(BOT_TOKEN);

bot.command('start', ctx => {
  ctx.reply(
    'Olá, eu sou o bot de pesquisa de vagas do linkedin!' +
      '\n\nPara começar, digite /pesquisar + o cargo que deseja pesquisar, por exemplo: /pesquisar dev' +
      '\n\nPara cancelar a pesquisa, digite /cancelar' +
      '\n\nPara alterar o período, digite /periodo + tempo em segundos, por exemplo: /periodo 84600' +
      '\n\nPara adicionar palavras na lista de bloqueio envie /bloquear e em seguida as palavras, uma por linha' +
      '\n\nPara ver as configurações atuais, digite /config',
    { reply_markup: pesquisa.keyboard },
  );
});

bot.command('bloquear', (ctx: Context) => {
  if (botBusy(ctx)) {
    return;
  }
  pesquisa.blacklisted = [
    ...(ctx.message?.text?.replace(/\/bloquear/, '') || '')
      .split('\n')
      .map(e => e.trim().toLowerCase())
      .filter(e => e),
  ];
  if (pesquisa.blacklisted.length > 0) {
    ctx.reply(`Palavras bloqueadas: ${pesquisa.blacklisted.join(', ')}`, { reply_markup: pesquisa.keyboard });
  } else {
    ctx.reply('A lista de palavras bloqueadas ficou vazia!', { reply_markup: pesquisa.keyboard });
  }
  ctx.reply('Palavras bloqueadas atualizadas!', { reply_markup: pesquisa.keyboard });
});

bot.command('pesquisar', async ctx => {
  if (botBusy(ctx)) {
    return;
  }

  pesquisa.inProgress = ctx.message?.from?.id.toString() || '';
  pesquisa.jobRole = ctx.message?.text.replace(/\/pesquisar/, '').trim() || pesquisa.jobRole;
  await ctx.reply(
    `*Cargo:* ${pesquisa.jobRole}` +
      `\n*Palavras bloqueadas:*` +
      `\n\`${pesquisa.blacklisted.join('\n')}\`` +
      `\n*Período:* Desde ${sec2RelativeTime(pesquisa.datePosted)} atrás`,
    { parse_mode: 'Markdown', reply_markup: pesquisa.keyboard },
  );
  const processingMessage: Message.TextMessage = await ctx.reply('🤖Processando...');
  search(pesquisa, ctx, processingMessage).then(async () => {
    if (fs.existsSync('resultados.txt')) {
      const file = new InputFile('resultados.txt');
      await ctx.replyWithDocument(file).catch(err => console.log(err));
      fs.rmSync('resultados.txt');
    } else {
      await ctx.reply('Nenhum resultado encontrado!', { reply_markup: pesquisa.keyboard });
    }
    if (fs.existsSync('bloqueados.txt')) {
      const file = new InputFile('bloqueados.txt');
      await ctx.replyWithDocument(file).catch(err => console.log(err));
      fs.rmSync('bloqueados.txt');
    }
  });
});

bot.command('config', ctx => {
  ctx.reply(
    `*Cargo:* ${pesquisa.jobRole}` +
      `\n*Palavras bloqueadas:*\n\`${pesquisa.blacklisted.join('\n')}\`` +
      `\n*Período:* Desde ${sec2RelativeTime(pesquisa.datePosted)} atrás` +
      `\n*Pesq. em andamento:* ${pesquisa.inProgress ? 'Sim' : 'Não'}` +
      (pesquisa.inProgress && `\n*ETA:*` + sec2RelativeTime(pesquisa.ETA)),
    { parse_mode: 'Markdown', reply_markup: pesquisa.keyboard },
  );
});

bot.command('cancelar', ctx => {
  if (ctx.message?.from?.id.toString() === pesquisa.inProgress) {
    pesquisa.revoke = true;
    ctx.reply('Pesquisa cancelada!', { reply_markup: pesquisa.keyboard });
  } else if (pesquisa.inProgress) {
    ctx.reply(`Somente o usuário de id ${pesquisa.inProgress} pode cancelar a pesquisa!`, { reply_markup: pesquisa.keyboard });
  } else {
    ctx.reply('Nenhuma pesquisa em andamento!', { reply_markup: pesquisa.keyboard });
  }
});

bot.command('periodo', ctx => {
  if (botBusy(ctx)) {
    return;
  }
  pesquisa.datePosted = Number(ctx.message?.text.replace(/\/periodo /, '')) || 86400;
  ctx.reply(`Período atualizado para ${sec2RelativeTime(pesquisa.datePosted)}`, { reply_markup: pesquisa.keyboard });
});

bot.start();
