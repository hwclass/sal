FROM node:22-alpine
WORKDIR /ui
COPY package.json ./
RUN npm install
COPY . .
EXPOSE 4000
CMD ["npm", "start"]
