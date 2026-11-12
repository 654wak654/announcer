FROM node:26-slim

WORKDIR /usr/src/app

COPY ./app .

RUN npm ci --omit=dev

ENV NODE_ENV=production

CMD [ "npm", "start" ]
