# Image Nginx officielle légère
FROM nginx:alpine

# Supprimer la config par défaut de Nginx
RUN rm /etc/nginx/conf.d/default.conf

# Copier notre configuration personnalisée
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copier les fichiers statiques du frontend
COPY src/ /usr/share/nginx/html/

# Exposer le port HTTP
EXPOSE 80

# Nginx démarre automatiquement avec l'image de base
CMD ["nginx", "-g", "daemon off;"]
