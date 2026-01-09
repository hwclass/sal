FROM node:22-bookworm

WORKDIR /automation

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      ca-certificates wget fonts-liberation libasound2 \
      libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libnss3 \
      libxkbcommon0 libxrandr2 libxdamage1 libxcomposite1 \
      libxfixes3 libxext6 libxshmfence1 libgbm1 xvfb \
      build-essential python3 && \
    rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install --omit=dev

# Install Playwright browsers for benchmarking
RUN npx playwright install chromium --with-deps

COPY . .

CMD ["tail", "-f", "/dev/null"]
