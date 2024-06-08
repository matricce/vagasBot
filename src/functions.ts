import fs from 'fs';
import { Context } from 'grammy';
import { InputFile, Message } from 'grammy/types';
import { htmlToText } from 'html-to-text';
import puppeteer, { Page } from 'puppeteer';
import logger, { errLogger } from './logger';
import { Search } from './types';
import { sec2RelativeTime, strIncludes, wait } from './utils';

const search = async (pesq: Search, ctx: Context, message: Message.TextMessage, pesquisa: Search): Promise<void> => {
  pesquisa.browser = await puppeteer.launch({
    headless: false,
    executablePath: process.env.CHROME_PATH,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const homeUrl = `https://br.linkedin.com/jobs/search?keywords=${pesq.jobRole}&location=Brazil&f_TPR=r${pesq.datePosted}&position=1&pageNum=0`;
  logger.info(`Acessando '${homeUrl}'...`);

  const resultados: string[] = [];
  const bloqueados: string[] = [];

  const pages = [...(await pesq.browser!.pages())];
  const page = pages[0];
  pages.shift();
  for (const pg in pages) {
    await pages[pg].close();
  }
  await page.goto(homeUrl);

  while (page.url().includes('authwall?trk=qf&original_referer')) {
    logger.debug(`Caiu na tela de login, tentando novamente...`);
    await page.goto(homeUrl);
    await wait(3000);
  }

  const qtdVagas =
    (await page
      .evaluate(() => Number(document.querySelector('.results-context-header__job-count')?.innerHTML))
      .catch((err: Error) => errLogger('Erro ao selecionar qtdVagas', err))) && 0;
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
        .catch((err: Error) => errLogger('Erro ao editar mensagem', err));
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

  const newTab = await pesq.browser!.newPage();

  const jobs = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.jobs-search__results-list > li > div')).map(div => {
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
    logger.debug(`exec. search - jobs - ${idx + 1}/${jobs.length} - ${job.href}`);
    logger.debug(`job - ${job.href} - ${job.title} - ${job.company}`);
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
        .catch(err => errLogger('Erro ao editar mensagem', err));
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
      .catch((err: Error) => errLogger('Erro ao editar mensagem', err));
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

    await newTab.goto(job.href!).catch((err: Error) => errLogger(`Erro ao abrir ${job.href}`, err));

    const testPage = async (pg: Page) => await pg.evaluate(() => document.querySelector('script[type="application/ld+json"]')).catch(() => '');
    const whileObj = {
      elapsed: 0,
      attempts: 0,
    };
    while (!(await testPage(newTab)) && !pesq.revoke) {
      const response = await newTab.goto(job.href!).catch((err: Error) => errLogger(`Erro ao abrir ${job.href}`, err) && null);
      if (response?.status() === 429) {
        await wait(20000);
        continue;
      }
      whileObj.attempts++;
      if (whileObj.attempts > 3) {
        break;
      }
      await wait(5000);
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
  await pesq.browser?.close();
};

const botIsBusy = (ctx: Context, pesquisa: Search): boolean => {
  if (pesquisa.inProgress) {
    ctx.reply(`Há uma pesquisa em andamento por ${pesquisa.inProgress}, aguarde! (aprox. ${sec2RelativeTime(pesquisa.ETA)})`, {
      reply_markup: pesquisa.keyboard,
    });
    return true;
  }
  return false;
};

const updateInterval = async (ctx: Context, pesquisa: Search) => {
  if (botIsBusy(ctx, pesquisa)) {
    return;
  }
  pesquisa.datePosted = Number(ctx.message?.text?.replace(/\/periodo /, '')) || 86400;
  ctx.reply(`Período atualizado para ${sec2RelativeTime(pesquisa.datePosted)}`, { reply_markup: pesquisa.keyboard });
};

const cancelSearch = async (ctx: Context, pesquisa: Search) => {
  if (ctx.message?.from?.id.toString() === pesquisa.inProgress) {
    pesquisa.revoke = true;
    ctx.reply('Pesquisa cancelada!', { reply_markup: pesquisa.keyboard });
  } else if (pesquisa.inProgress) {
    ctx.reply(`Somente o usuário de id ${pesquisa.inProgress} pode cancelar a pesquisa!`, { reply_markup: pesquisa.keyboard });
  } else {
    ctx.reply('Nenhuma pesquisa em andamento!', { reply_markup: pesquisa.keyboard });
  }
};

const showSettings = async (ctx: Context, pesquisa: Search) => {
  ctx.reply(
    `*Cargo:* ${pesquisa.jobRole}` +
      `\n*Palavras bloqueadas:*\n\`${pesquisa.blacklisted.join('\n')}\`` +
      `\n*Período:* Desde ${sec2RelativeTime(pesquisa.datePosted)} atrás` +
      `\n*Pesq. em andamento:* ${pesquisa.inProgress ? 'Sim' : 'Não'}` +
      (pesquisa.inProgress && `\n*ETA:*` + sec2RelativeTime(pesquisa.ETA)),
    { parse_mode: 'Markdown', reply_markup: pesquisa.keyboard },
  );
};

const helpMessage = async (ctx: Context, pesquisa: Search) => {
  ctx.reply(
    'Olá, eu sou o bot de pesquisa de vagas do linkedin!' +
      '\n\nPara começar, digite /pesquisar + o cargo que deseja pesquisar, por exemplo: /pesquisar dev' +
      '\n\nPara cancelar a pesquisa, digite /cancelar' +
      '\n\nPara alterar o período, digite /periodo + tempo em segundos, por exemplo: /periodo 86400' +
      '\n\nPara adicionar palavras na lista de bloqueio envie /bloquear e em seguida as palavras, uma por linha' +
      '\n\nPara ver as configurações atuais, digite /config',
    { reply_markup: pesquisa.keyboard },
  );
};

const updateBlockList = async (ctx: Context, pesquisa: Search) => {
  if (botIsBusy(ctx, pesquisa)) {
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
};

const initSearch = async (ctx: Context, pesquisa: Search) => {
  if (botIsBusy(ctx, pesquisa)) {
    return;
  }

  pesquisa.inProgress = ctx.message?.from?.id.toString() || '';
  pesquisa.jobRole = ctx.message?.text?.replace(/\/pesquisar/, '').trim() || pesquisa.jobRole;

  logger.debug(`exec. initSearch - ${pesquisa.inProgress} - ${pesquisa.jobRole} - ${pesquisa.datePosted}`);

  await ctx.reply(
    `*Cargo:* ${pesquisa.jobRole}` +
      `\n*Palavras bloqueadas:*` +
      `\n\`${pesquisa.blacklisted.join('\n')}\`` +
      `\n*Período:* Desde ${sec2RelativeTime(pesquisa.datePosted)} atrás`,
    { parse_mode: 'Markdown', reply_markup: pesquisa.keyboard },
  );
  const processingMessage: Message.TextMessage = await ctx.reply('🤖Processando...');
  search(pesquisa, ctx, processingMessage, pesquisa).then(async () => {
    if (fs.existsSync('resultados.txt')) {
      const file = new InputFile('resultados.txt');
      await ctx.replyWithDocument(file).catch(err => logger.error(err));
      fs.rmSync('resultados.txt');
    } else {
      await ctx.reply('Nenhum resultado encontrado!', { reply_markup: pesquisa.keyboard });
    }
    if (fs.existsSync('bloqueados.txt')) {
      const file = new InputFile('bloqueados.txt');
      await ctx.replyWithDocument(file).catch(err => logger.error(err));
      fs.rmSync('bloqueados.txt');
    }
  });
};

export { botIsBusy, cancelSearch, helpMessage, initSearch, showSettings, updateBlockList, updateInterval };
