FROM nvidia/cuda:12.6.3-runtime-ubuntu24.04

# Install Node.js 20 and ffmpeg (Ubuntu's ffmpeg includes nvenc support)
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl ffmpeg && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY . .

RUN mkdir -p /app/data

EXPOSE 3000

CMD ["node", "server.js"]
