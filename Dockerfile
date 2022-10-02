# Build environment
FROM node:lts-slim AS env-builder
WORKDIR /app
COPY . .

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD 1

RUN apt-get update && apt-get upgrade -y

RUN apt-get install -y git
RUN npm install
RUN npm run build && rm -rf node_modules
RUN npm install --omit=dev

# Production environment
FROM node:lts-slim AS env-prod
WORKDIR /app

RUN apt-get update && apt-get upgrade -y

ENV CHROME_PATH /usr/bin/google-chrome-stable

RUN apt-get install curl gnupg -y \
  && curl --location --silent https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
  && sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list' \
  && apt-get update \
  && apt-get install google-chrome-stable -y --no-install-recommends \
  && rm -rf /var/lib/apt/lists/*

RUN apt-get autoremove -y && apt autoclean -y

# Copy production files
COPY --from=env-builder ./app/dist ./dist
COPY --from=env-builder ./app/node_modules ./node_modules

CMD ["node","dist/index.js"]