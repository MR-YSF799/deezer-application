# 🎵 Deezer Charts App

Application web e-commerce/musique en architecture Docker multi-conteneurs.
Récupère les tops tracks Deezer, les stocke dans MongoDB local et les affiche
dans une interface web dynamique avec audio preview.

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Machine Windows (Host)                   │
│                                                             │
│   MongoDB local  ←──────────────────────────────────┐      │
│   (port 27017)                                       │      │
│                                              host.docker.   │
│  ┌──────────────────── Docker ──────────────internal  │      │
│  │                                                    │      │
│  │  ┌──────────────┐   /api/*    ┌──────────────┐    │      │
│  │  │   Frontend   │ ──────────► │   Backend    │────┘      │
│  │  │  Nginx :80   │            │  Express:3000 │           │
│  │  └──────────────┘            └──────────────┘           │
│  │         ▲                           ▲                    │
│  │         │ :8080                     │ :3000              │
│  └─────────┼───────────────────────────┼────────────────────│
│            │                           │                    │
│         Browser                    (direct)                 │
└─────────────────────────────────────────────────────────────┘
```

### Flux de données complet

```
1. [Browser] → GET http://localhost:8080
       ↓
2. [Nginx] sert index.html au browser

3. [Browser] → POST http://localhost:8080/api/fetch
       ↓
4. [Nginx] proxy_pass → http://backend:3000/api/fetch
       ↓
5. [Backend] appelle https://api.deezer.com/chart/0/tracks
       ↓
6. [Deezer API] retourne JSON {data: [{id, title, artist, album, preview...}]}
       ↓
7. [Backend] transforme + upsert dans MongoDB via Mongoose
       ↓
8. [MongoDB local] stocke les documents dans la collection "tracks"
       ↓
9. [Backend] répond {success: true, count: 50, inserted: 50}
       ↓
10. [Browser] → GET http://localhost:8080/api/tracks
        ↓
11. [Backend] lit MongoDB → retourne les tracks triées par rank
        ↓
12. [Browser] affiche les cards avec titre, artiste, cover, audio preview
```

---

## 🚀 Lancement rapide

### Prérequis
- Docker Desktop installé et démarré
- MongoDB en cours d'exécution sur `localhost:27017`
- Connexion internet (pour l'API Deezer)

### Vérifier que MongoDB tourne
```powershell
# Dans PowerShell
mongosh --eval "db.adminCommand('ping')"
# Doit afficher : { ok: 1 }
```

### Démarrer l'application
```powershell
# Cloner / placer ce dossier, puis :
cd deezer-app

# Construire les images et démarrer les conteneurs
docker-compose up --build

# En arrière-plan
docker-compose up --build -d
```

### Accéder à l'application
| URL | Service |
|-----|---------|
| http://localhost:8080 | Frontend (interface web) |
| http://localhost:3000/api/tracks | API backend directe |
| http://localhost:3000/health | Health check |

### Premier lancement
1. Ouvrir http://localhost:8080
2. Cliquer **"Sync Deezer"** → récupère 50 tracks et les stocke en base
3. Les tracks s'affichent automatiquement avec cover + audio preview
4. Cliquer ▶ pour écouter un extrait 30 secondes

---

## 📁 Structure du projet

```
deezer-app/
├── docker-compose.yml          ← Orchestration des 2 conteneurs
│
├── backend/
│   ├── Dockerfile              ← Image Node.js 20 Alpine
│   ├── package.json
│   ├── server.js               ← Express + Mongoose + routes API
│   └── .dockerignore
│
└── frontend/
    ├── Dockerfile              ← Image Nginx Alpine
    ├── nginx.conf              ← Config proxy + static files
    └── src/
        └── index.html          ← SPA : HTML + CSS + JS vanilla
```

---

## 🔌 API Routes

| Méthode | Route | Description |
|---------|-------|-------------|
| `GET`   | `/api/tracks` | Retourne toutes les tracks stockées (triées par rank) |
| `POST`  | `/api/fetch`  | Appelle Deezer API et upsert en MongoDB |
| `GET`   | `/api/tracks/search?q=...` | Recherche par titre / artiste / album |
| `GET`   | `/health`     | État du serveur et de la connexion MongoDB |

---

## 🧰 Commandes utiles

```powershell
# Voir les logs en temps réel
docker-compose logs -f

# Logs d'un seul service
docker-compose logs -f backend

# Arrêter les conteneurs
docker-compose down

# Reconstruire après modification du code
docker-compose up --build

# Accéder au shell du backend
docker exec -it deezer-backend sh

# Vérifier les données dans MongoDB (hors Docker)
mongosh deezerdb --eval "db.tracks.find().limit(3).pretty()"

# Compter les tracks stockées
mongosh deezerdb --eval "db.tracks.countDocuments()"
```

---

## 🔧 Dépannage

### Backend ne se connecte pas à MongoDB
```powershell
# Vérifier que MongoDB accepte les connexions externes
# Dans mongod.cfg, bindIp doit inclure 0.0.0.0 ou être absent
# Chemin typique : C:\Program Files\MongoDB\Server\X.X\bin\mongod.cfg

# Redémarrer MongoDB après modification
net stop MongoDB
net start MongoDB
```

### Tester la connexion depuis le conteneur
```powershell
docker exec -it deezer-backend sh
# Dans le conteneur :
wget -qO- http://host.docker.internal:27017
# Si MongoDB répond → connexion OK
```

### Erreur CORS
Le backend configure CORS pour accepter toutes les origines en développement.
Pour la production, modifier `cors()` dans server.js :
```js
app.use(cors({ origin: 'http://localhost:8080' }));
```

---

## 🎓 Concepts appris

| Concept | Où |
|---------|-----|
| Images Docker (FROM, COPY, RUN, CMD) | `backend/Dockerfile`, `frontend/Dockerfile` |
| Docker Compose (services, networks, ports) | `docker-compose.yml` |
| Réseau Docker inter-conteneurs | `proxy_pass http://backend:3000` dans nginx.conf |
| Accès au host depuis Docker (Windows) | `host.docker.internal` dans MONGO_URI |
| API REST Express | Routes GET/POST dans server.js |
| Mongoose / MongoDB | Schéma, Model, bulkWrite upsert |
| Appel API externe avec axios | `axios.get('https://api.deezer.com/...')` |
| Proxy inverse Nginx | `location /api/` dans nginx.conf |
| Gestion des erreurs distribuées | try/catch + codes HTTP + toast UI |
