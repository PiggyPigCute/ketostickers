const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3003;

const DATA_FILE = path.join(__dirname, 'data', 'points.json');
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');

// S'assure que les dossiers/fichiers nécessaires existent
if (!fs.existsSync(path.dirname(DATA_FILE))) fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 }, // 8 Mo max
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Seules les images sont autorisées'));
  }
});

app.use(express.static(path.join(__dirname, 'public')));

// Migre les points enregistrés à l'ancien format (pseudo/photo/description directs)
// vers le nouveau format (poseur + spectateurs).
function normalizePoint(point) {
  if (point.poseur !== undefined || point.spectateurs !== undefined) {
    if (!point.spectateurs) point.spectateurs = [];
    return point;
  }
  return {
    ...point,
    poseur: { pseudo: point.pseudo, photo: point.photo || null, createdAt: point.createdAt },
    spectateurs: []
  };
}

function readPoints() {
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')).map(normalizePoint);
}

function writePoints(points) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(points, null, 2));
}

app.get('/api/points', (req, res) => {
  res.json(readPoints());
});

app.post('/api/points', upload.single('photo'), (req, res) => {
  try {
    const { lat, lng, description, pseudo, role } = req.body;

    if (!lat || !lng || !description || !pseudo) {
      return res.status(400).json({ error: 'Champs manquants (lat, lng, description, pseudo requis)' });
    }

    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);
    if (Number.isNaN(latNum) || Number.isNaN(lngNum)) {
      return res.status(400).json({ error: 'Coordonnées invalides' });
    }

    const createdAt = new Date().toISOString();
    const cleanPseudo = String(pseudo).slice(0, 50);
    const photoPath = req.file ? `/uploads/${req.file.filename}` : null;

    const point = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      lat: latNum,
      lng: lngNum,
      description: String(description).slice(0, 500),
      createdAt,
      poseur: null,
      spectateurs: []
    };

    if (role === 'spectateur') {
      point.spectateurs.push({ pseudo: cleanPseudo, photo: photoPath, createdAt });
    } else {
      point.poseur = { pseudo: cleanPseudo, photo: photoPath, createdAt };
    }

    const points = readPoints();
    points.push(point);
    writePoints(points);
    res.status(201).json(point);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/points/:id/sightings', upload.single('photo'), (req, res) => {
  try {
    const { pseudo } = req.body;
    if (!pseudo) {
      return res.status(400).json({ error: 'Champ manquant (pseudo requis)' });
    }

    const points = readPoints();
    const point = points.find(p => p.id === req.params.id);
    if (!point) {
      return res.status(404).json({ error: 'Sticker introuvable' });
    }

    point.spectateurs.push({
      pseudo: String(pseudo).slice(0, 50),
      photo: req.file ? `/uploads/${req.file.filename}` : null,
      createdAt: new Date().toISOString()
    });

    writePoints(points);
    res.status(201).json(point);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Gestion des erreurs multer (ex: fichier trop gros, mauvais type)
app.use((err, req, res, next) => {
  if (err) {
    return res.status(400).json({ error: err.message || 'Erreur lors de l\'upload' });
  }
  next();
});

app.listen(PORT, () => {
  console.log(`KetoStickers server running on port ${PORT}`);
});
