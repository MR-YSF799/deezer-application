# ── Étape 1 : image de base Node.js légère ──────────────────────────────────
FROM node:20-alpine

# Définir le répertoire de travail dans le conteneur
WORKDIR /app

# Copier les fichiers de dépendances en premier (optimise le cache Docker)
COPY package.json ./

# Installer les dépendances de production uniquement
RUN npm install --omit=dev

# Copier le reste du code source
COPY . .

# Exposer le port utilisé par Express
EXPOSE 3000

# Commande de démarrage
CMD ["node", "server.js"]
