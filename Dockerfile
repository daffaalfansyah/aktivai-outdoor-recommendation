# Base image dengan Node.js LTS
FROM node:20-slim

# Install Python 3, pip, dan dependensi sistem yang dibutuhkan
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    git \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package.json jika ada
COPY package*.json ./

# Install Node.js packages (bisa dibuat kosong jika tidak ada npm dependencies tambahan)
RUN npm install --production || true

# Copy requirements.txt dan install Python ML packages
COPY requirements.txt ./
RUN pip3 install --no-cache-dir --break-system-packages -r requirements.txt || pip3 install --no-cache-dir -r requirements.txt

# Copy seluruh source code project
COPY . .

# Environment variable Port (Render akan set variabel PORT secara otomatis)
ENV PORT=3000
EXPOSE 3000

# Jalankan server
CMD ["node", "server.js"]
