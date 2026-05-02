FROM node:24-alpine
WORKDIR /app

COPY package*.json ./
RUN npm install --omit=optional

COPY . .

EXPOSE 3000
CMD ["node_modules/.bin/tsx", "src/index.ts"]
