FROM node:18-slim

WORKDIR /usr/src/app

COPY ./app .

RUN npm install

ENV NODE_ENV=production
CMD [ "npm", "start" ]
