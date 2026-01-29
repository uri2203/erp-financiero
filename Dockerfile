FROM node:18

# Crear directorio de trabajo
WORKDIR /app

# Instalar dependencias
COPY package*.json ./
RUN npm install

# Copiar el resto del código
COPY . .

# Exponer el puerto (aunque Render lo maneja automático)
EXPOSE 3000

# Comando para iniciar
CMD ["node", "server.js"]
