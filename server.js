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

function normalizeName(name) {
  return String(name).trim().toLowerCase();
}

// Ajoute pseudo aux spectateurs seulement s'il n'apparaît pas déjà comme poseur
// ou spectateur (le pseudo reste unique, mais on peut quand même lui associer
// une nouvelle photo).
function addSpectateur(point, pseudo) {
  const known = new Set(point.spectateurs.map(normalizeName));
  if (point.poseur) known.add(normalizeName(point.poseur.pseudo));
  if (!known.has(normalizeName(pseudo))) {
    point.spectateurs.push(pseudo);
  }
}

// Migre les points enregistrés dans un ancien format vers le format actuel :
// poseur { pseudo, createdAt } | null, spectateurs: pseudos uniques (string[]),
// photos: [{ url, pseudo, createdAt }] (une par photo, plusieurs possibles par pseudo).
function normalizePoint(point) {
  if (Array.isArray(point.photos)) {
    return point;
  }

  const photos = [];
  let poseur = null;
  const spectateurs = [];

  if (point.poseur !== undefined || point.spectateurs !== undefined) {
    // Format intermédiaire : poseur/spectateurs avec photo directe sur chaque personne.
    if (point.poseur) {
      poseur = { pseudo: point.poseur.pseudo, createdAt: point.poseur.createdAt };
      if (point.poseur.photo) {
        photos.push({ url: point.poseur.photo, pseudo: point.poseur.pseudo, createdAt: point.poseur.createdAt });
      }
    }
    (point.spectateurs || []).forEach(s => {
      if (typeof s === 'string') {
        if (!spectateurs.some(name => normalizeName(name) === normalizeName(s))) spectateurs.push(s);
        return;
      }
      if (!spectateurs.some(name => normalizeName(name) === normalizeName(s.pseudo))) spectateurs.push(s.pseudo);
      if (s.photo) photos.push({ url: s.photo, pseudo: s.pseudo, createdAt: s.createdAt });
    });
  } else {
    // Format le plus ancien : pseudo/photo directement sur le point.
    poseur = { pseudo: point.pseudo, createdAt: point.createdAt };
    if (point.photo) photos.push({ url: point.photo, pseudo: point.pseudo, createdAt: point.createdAt });
  }

  return {
    id: point.id,
    lat: point.lat,
    lng: point.lng,
    description: point.description,
    createdAt: point.createdAt,
    poseur,
    spectateurs,
    photos
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
      spectateurs: [],
      photos: []
    };

    if (role === 'spectateur') {
      point.spectateurs.push(cleanPseudo);
    } else {
      point.poseur = { pseudo: cleanPseudo, createdAt };
    }
    if (photoPath) point.photos.push({ url: photoPath, pseudo: cleanPseudo, createdAt });

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

    const cleanPseudo = String(pseudo).slice(0, 50);
    const createdAt = new Date().toISOString();

    addSpectateur(point, cleanPseudo);
    if (req.file) {
      point.photos.push({ url: `/uploads/${req.file.filename}`, pseudo: cleanPseudo, createdAt });
    }

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
