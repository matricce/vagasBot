import 'dotenv/config';
import path from 'path';
import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';

const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

const level = () => {
  const env = process.env.NODE_ENV || 'development';
  const isDevelopment = env === 'development';
  return isDevelopment ? 'debug' : 'warn';
};

const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'white',
};

winston.addColors(colors);

const format = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:SSS' }),
  winston.format.colorize({ all: true }),
  winston.format.errors({ stack: true }),
  winston.format.printf(info => `${info.timestamp} ${info.level}: ${info.stack ? info.stack : info.message}`),
);

const logsPath = path.join(__dirname, '..', 'logs');

const transports = [
  new winston.transports.Console(),
  new winston.transports.File({
    filename: path.join(logsPath, 'error.log'),
    level: 'error',
  }),
  new DailyRotateFile({
    filename: path.join(logsPath, '%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    maxFiles: '7d',
  }),
];

const Logger = winston.createLogger({
  level: level(),
  levels,
  format,
  transports,
});

export const errLogger = (functionName: string, err: any) => {
  const msg = Logger.error(`${functionName}: ${err.response ? `${JSON.stringify(err.response.data)}` : err}`);
  if (err.message.includes('Promise was collected')) {
    Logger.debug(`exec. ${functionName} - restarting`);
    (async () => {
      await new Promise(resolve => setTimeout(resolve, 500));
      process.exit(1);
    })();
  }
  return msg;
};
export default Logger;
