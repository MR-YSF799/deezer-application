// Importe Express - framework pour créer le serveur HTTP
const express = require('express');
// Importe Mongoose - ORM pour gérer MongoDB
const mongoose = require('mongoose');
// Importe CORS - permet les requêtes d'autres domaines
const cors = require('cors');
// Importe Axios - pour faire des requêtes HTTP vers l'API Deezer
const axios = require('axios');

// Crée une instance Express pour configurer le serveur
const app = express();
// Définit le port : 3000 par défaut, ou récupère depuis les variables d'environnement
const PORT = process.env.PORT || 3000;

// Sur Windows avec Docker Desktop, host.docker.internal pointe vers la machine hôte
// Chaine de connexion MongoDB : utilise une variable d'environnement ou se connecte localement
const MONGO_URI = process.env.MONGO_URI || 'mongodb://host.docker.internal:27017/deezerdb';

// ─── Middleware ───────────────────────────────────────────────────────────────
// Active CORS - permet aux requêtes du frontend d'accéder à ce backend
app.use(cors());
// Configure Express pour parser les requêtes JSON automatiquement
app.use(express.json());

// ─── Connexion MongoDB ────────────────────────────────────────────────────────
// Se connecte à MongoDB avec la chaine MONGO_URI
mongoose
  .connect(MONGO_URI)
  // Si la connexion réussit, affiche un message de confirmation
  .then(() => console.log('✅ MongoDB connecté sur', MONGO_URI))
  // Si la connexion échoue, affiche l'erreur
  .catch((err) => console.error('❌ Erreur MongoDB:', err.message));

// ─── Schéma et Modèle Track ───────────────────────────────────────────────────
// Définit la structure d'une track (une chanson) dans la base de données
const trackSchema = new mongoose.Schema({
  // ID unique de la track provenant de l'API Deezer
  deezerId: { type: Number, required: true, unique: true },
  // Titre de la chanson (obligatoire)
  title:    { type: String, required: true },
  // Durée en secondes
  duration: { type: Number },
  // Classement de popularité
  rank:     { type: Number },
  // URL de l'aperçu audio
  preview:  { type: String },
  // Informations sur l'artiste
  artist: {
    // Identifiant de l'artiste
    id:      Number,
    // Nom de l'artiste
    name:    String,
    // URL de la photo de l'artiste
    picture: String,
  },
  // Informations sur l'album
  album: {
    // Identifiant de l'album
    id:    Number,
    // Titre de l'album
    title: String,
    // URL de la couverture de l'album
    cover: String,
  },
  // Date à laquelle la track a été récupérée (automatiquement définie à la date actuelle)
  fetchedAt: { type: Date, default: Date.now },
});

// Crée un modèle MongoDB basé sur le schéma défini
const Track = mongoose.model('Track', trackSchema);

// ─── Utilitaire : transformer une track Deezer ────────────────────────────────
// Cette fonction convertit les données de l'API Deezer au format attendu par la base de données
function transformTrack(t) {
  return {
    // Récupère l'ID de la track de Deezer
    deezerId: t.id,
    // Récupère le titre
    title:    t.title,
    // Récupère la durée en secondes
    duration: t.duration,
    // Récupère le classement de popularité
    rank:     t.rank,
    // Récupère l'URL de l'aperçu audio
    preview:  t.preview,
    // Extrait les informations d'artiste (avec fallback si prépré manquant)
    artist: {
      id:      t.artist?.id,
      name:    t.artist?.name,
      // Utilise picture_medium en priorité, puis picture
      picture: t.artist?.picture_medium || t.artist?.picture,
    },
    // Extrait les informations d'album
    album: {
      id:    t.album?.id,
      title: t.album?.title,
      // Utilise cover_medium en priorité, puis cover
      cover: t.album?.cover_medium || t.album?.cover,
    },
  };
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET /api/tracks — retourne les tracks stockées (triées par rank)
// Cette route est appelée quand le frontend demande la liste des chansons
app.get('/api/tracks', async (req, res) => {
  try {
    // Récupère toutes les tracks de la base de données, triées par rank (popularité)
    const tracks = await Track.find().sort({ rank: 1 }).lean();
    // Retourne une réponse JSON avec les tracks et le nombre d'éléments
    res.json({ success: true, count: tracks.length, data: tracks });
  } catch (err) {
    // En cas d'erreur, affiche l'erreur dans la console
    console.error('Erreur /api/tracks:', err);
    // Retourne une erreur 500 (erreur serveur) au client
    res.status(500).json({ success: false, message: 'Erreur serveur', error: err.message });
  }
});

// POST /api/fetch — appelle l'API Deezer et upsert les tracks en base
// Cette route est appelée pour synchroniser les chansons depuis l'API Deezer
app.post('/api/fetch', async (req, res) => {
  try {
    // Affiche un message indiquant que l'appel à l'API Deezer commence
    console.log('🔄 Appel à l\'API Deezer...');
    // Appelle l'API Deezer pour récupérer les 50 meilleures chansons du classement
    // Ajoute un timeout de 10 secondes pour éviter les requêtes interminables
    const { data } = await axios.get('https://api.deezer.com/chart/0/tracks?limit=50', {
      timeout: 10000,
    });

    // Vérifie que la réponse contient des données valides
    if (!data?.data?.length) {
      // Si données invalides, retourne une erreur 502 (Bad Gateway)
      return res.status(502).json({ success: false, message: 'Réponse Deezer invalide' });
    }

    // Transforme chaque track de Deezer au format attendu par la base de données
    const tracks = data.data.map(transformTrack);

    // Crée une liste d'opérations pour mettre à jour ou insérer les tracks en base
    // upsert : met à jour la track si elle existe déjà, sinon l'insère
    const ops = tracks.map((t) => ({
      updateOne: {
        // Cherche la track par son deezerId
        filter: { deezerId: t.deezerId },
        // Met à jour les données de la track
        update: { $set: { ...t, fetchedAt: new Date() } },
        // Si la track n'existe pas, la crée
        upsert: true,
      },
    }));

    // Exécute l'ensemble des opérations upsert de manière massive en base
    const result = await Track.bulkWrite(ops);
    // Affiche le nombre de tracks synchronisées et combien sont nouvelles
    console.log(`✅ ${tracks.length} tracks synchronisées (${result.upsertedCount} nouvelles)`);

    // Retourne une réponse JSON avec les statistiques de la synchronisation
    res.json({
      success: true,
      message: `${tracks.length} tracks synchronisées`,
      // Nombre de nouvelles tracks insérées
      inserted: result.upsertedCount,
      // Nombre de tracks existantes mises à jour
      updated: result.modifiedCount,
    });
  } catch (err) {
    // Affiche l'erreur dans la console
    console.error('Erreur /api/fetch:', err.message);
    // Vérifie si l'erreur est un timeout de connexion
    if (err.code === 'ECONNABORTED') {
      // Retourne une erreur 504 (Gateway Timeout) pour les timeouts
      return res.status(504).json({ success: false, message: 'Timeout Deezer API' });
    }
    // Pour les autres erreurs, retourne une erreur 500
    res.status(500).json({ success: false, message: 'Erreur serveur', error: err.message });
  }
});

// GET /api/tracks/search?q=... — recherche par titre ou artiste
// Cette route permet de chercher des chansons par titre, artiste ou album
app.get('/api/tracks/search', async (req, res) => {
  try {
    // Récupère le paramètre de recherche 'q' depuis l'URL et supprime les espaces inutiles
    const q = req.query.q?.trim();
    // Si la recherche est vide, retourne un résultat vide
    if (!q) return res.json({ success: true, count: 0, data: [] });

    // Crée une expression régulière pour chercher le texte (insensible à la casse avec 'i')
    const regex = new RegExp(q, 'i');
    // Recherche les tracks qui contiennent le texte dans le titre, le nom de l'artiste ou l'album
    const tracks = await Track.find({
      // Le '$or' signifie que au moins une condition doit être satisfaite
      $or: [
        { title: regex },           // Recherche dans les titres
        { 'artist.name': regex },   // Recherche dans les noms d'artistes
        { 'album.title': regex },   // Recherche dans les titres d'albums
      ],
    })
      // Trie les résultats par rang (popularité)
      .sort({ rank: 1 })
      // Le '.lean()' optimise la requête en retournant des objets simples au lieu de documents Mongoose
      .lean();

    // Retourne une réponse JSON avec les résultats de la recherche
    res.json({ success: true, count: tracks.length, data: tracks });
  } catch (err) {
    // En cas d'erreur, retourne une erreur 500
    res.status(500).json({ success: false, message: 'Erreur serveur', error: err.message });
  }
});

// GET /health — vérification de l'état du service
// Cette route permet de vérifier si le serveur et la base de données fonctionnent correctement
app.get('/health', (req, res) => {
  // Récupère l'état actuel de la connexion MongoDB (0-3 : disconnected, connected, connecting, disconnecting)
  const dbState = mongoose.connection.readyState;
  // Mappe les états numériques à des chaînes lisibles
  const states = { 0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting' };
  // Retourne un JSON indiquant que le serveur est actif et l'état de la base de données
  res.json({ status: 'ok', mongodb: states[dbState] || 'unknown' });
});

// ─── Démarrage ────────────────────────────────────────────────────────────────
// Démarre le serveur Express et écoute sur le port défini
app.listen(PORT, () => {
  // Affiche un message confirmant que le serveur a démarré avec l'URL
  console.log(`🚀 Backend démarré sur http://localhost:${PORT}`);
});
