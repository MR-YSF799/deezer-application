const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Sur Windows avec Docker Desktop, host.docker.internal pointe vers la machine hôte
const MONGO_URI = process.env.MONGO_URI || 'mongodb://host.docker.internal:27017/deezerdb';

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ─── Connexion MongoDB ────────────────────────────────────────────────────────
mongoose
  .connect(MONGO_URI)
  .then(() => console.log('✅ MongoDB connecté sur', MONGO_URI))
  .catch((err) => console.error('❌ Erreur MongoDB:', err.message));

// ─── Schéma et Modèle Track ───────────────────────────────────────────────────
const trackSchema = new mongoose.Schema({
  deezerId: { type: Number, required: true, unique: true },
  title:    { type: String, required: true },
  duration: { type: Number },
  rank:     { type: Number },
  preview:  { type: String },
  artist: {
    id:      Number,
    name:    String,
    picture: String,
  },
  album: {
    id:    Number,
    title: String,
    cover: String,
  },
  fetchedAt: { type: Date, default: Date.now },
});

const Track = mongoose.model('Track', trackSchema);

// ─── Utilitaire : transformer une track Deezer ────────────────────────────────
function transformTrack(t) {
  return {
    deezerId: t.id,
    title:    t.title,
    duration: t.duration,
    rank:     t.rank,
    preview:  t.preview,
    artist: {
      id:      t.artist?.id,
      name:    t.artist?.name,
      picture: t.artist?.picture_medium || t.artist?.picture,
    },
    album: {
      id:    t.album?.id,
      title: t.album?.title,
      cover: t.album?.cover_medium || t.album?.cover,
    },
  };
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET /api/tracks — retourne les tracks stockées (triées par rank)
app.get('/api/tracks', async (req, res) => {
  try {
    const tracks = await Track.find().sort({ rank: 1 }).lean();
    res.json({ success: true, count: tracks.length, data: tracks });
  } catch (err) {
    console.error('Erreur /api/tracks:', err);
    res.status(500).json({ success: false, message: 'Erreur serveur', error: err.message });
  }
});

// POST /api/fetch — appelle l'API Deezer et upsert les tracks en base
app.post('/api/fetch', async (req, res) => {
  try {
    console.log('🔄 Appel à l\'API Deezer...');
    const { data } = await axios.get('https://api.deezer.com/chart/0/tracks?limit=50', {
      timeout: 10000,
    });

    if (!data?.data?.length) {
      return res.status(502).json({ success: false, message: 'Réponse Deezer invalide' });
    }

    const tracks = data.data.map(transformTrack);

    // upsert : met à jour si la track existe déjà, sinon l'insère
    const ops = tracks.map((t) => ({
      updateOne: {
        filter: { deezerId: t.deezerId },
        update: { $set: { ...t, fetchedAt: new Date() } },
        upsert: true,
      },
    }));

    const result = await Track.bulkWrite(ops);
    console.log(`✅ ${tracks.length} tracks synchronisées (${result.upsertedCount} nouvelles)`);

    res.json({
      success: true,
      message: `${tracks.length} tracks synchronisées`,
      inserted: result.upsertedCount,
      updated: result.modifiedCount,
    });
  } catch (err) {
    console.error('Erreur /api/fetch:', err.message);
    if (err.code === 'ECONNABORTED') {
      return res.status(504).json({ success: false, message: 'Timeout Deezer API' });
    }
    res.status(500).json({ success: false, message: 'Erreur serveur', error: err.message });
  }
});

// GET /api/tracks/search?q=... — recherche par titre ou artiste
app.get('/api/tracks/search', async (req, res) => {
  try {
    const q = req.query.q?.trim();
    if (!q) return res.json({ success: true, count: 0, data: [] });

    const regex = new RegExp(q, 'i');
    const tracks = await Track.find({
      $or: [{ title: regex }, { 'artist.name': regex }, { 'album.title': regex }],
    })
      .sort({ rank: 1 })
      .lean();

    res.json({ success: true, count: tracks.length, data: tracks });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur serveur', error: err.message });
  }
});

// GET /health — vérification de l'état du service
app.get('/health', (req, res) => {
  const dbState = mongoose.connection.readyState;
  const states = { 0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting' };
  res.json({ status: 'ok', mongodb: states[dbState] || 'unknown' });
});

// ─── Démarrage ────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 Backend démarré sur http://localhost:${PORT}`);
});
