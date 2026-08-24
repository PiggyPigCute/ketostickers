const STICKER_COLORS = ['#e8607a', '#2f9e8f', '#f2c14e', '#ef7d3b', '#8b6fd9'];
const STICKER_EMOJIS = ['📍', '✨', '🔥', '🌟', '💫'];

const map = L.map('map', { zoomControl: true, worldCopyJump: true }).setView([30, 10], 2.5);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors',
  maxZoom: 19,
  minZoom: 2
}).addTo(map);

const markersLayer = L.layerGroup().addTo(map);
const hint = document.getElementById('hint');
const counterBadge = document.getElementById('counter-badge');

function stickerIcon(seed) {
  const color = STICKER_COLORS[seed % STICKER_COLORS.length];
  const emoji = STICKER_EMOJIS[seed % STICKER_EMOJIS.length];
  const rotation = (seed % 7) - 3;
  return L.divIcon({
    className: '',
    html: `<div class="sticker-marker" style="background:${color}; transform: rotate(${rotation}deg);">${emoji}</div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17]
  });
}

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

function renderPoint(point, index) {
  const marker = L.marker([point.lat, point.lng], { icon: stickerIcon(index) });
  marker.on('click', () => openInfo(point));
  marker.addTo(markersLayer);
}

async function loadPoints() {
  const res = await fetch('/api/points');
  const points = await res.json();
  markersLayer.clearLayers();
  points.forEach((p, i) => renderPoint(p, i));
  counterBadge.textContent = `${points.length} sticker${points.length > 1 ? 's' : ''}`;
  return points;
}

// --- Info modale ---
const infoBackdrop = document.getElementById('info-backdrop');
const infoContent = document.getElementById('info-content');

function openInfo(point) {
  const statusLines = [];
  if (point.poseur) {
    statusLines.push(`Posé par <b>${escapeHtml(point.poseur.pseudo)}</b>`);
  }
  if (point.spectateurs && point.spectateurs.length) {
    const names = point.spectateurs.map(name => `<b>${escapeHtml(name)}</b>`).join(', ');
    statusLines.push(`Vu par ${names}`);
  }

  const photos = point.photos || [];

  infoContent.innerHTML = `
    <p class="info-status">${statusLines.join('<br>')}</p>
    <p class="info-date">${formatDate(point.createdAt)}</p>
    <p class="info-desc">${escapeHtml(point.description)}</p>
    ${photos.length ? `<div class="photo-gallery">${photos.map(p => `
      <figure>
        <img src="${p.url}" alt="Photo du sticker">
        <figcaption>Par <b>${escapeHtml(p.pseudo)}</b> — ${formatDate(p.createdAt)}</figcaption>
      </figure>
    `).join('')}</div>` : ''}
    <div class="btn-row">
      <button type="button" class="btn-secondary" id="close-info">Fermer</button>
      <button type="button" class="btn-primary" id="open-sighting">Je l'ai vu !</button>
    </div>
  `;
  infoBackdrop.classList.add('visible');
  document.getElementById('close-info').addEventListener('click', closeInfo);
  document.getElementById('open-sighting').addEventListener('click', () => openSighting(point));
}
function closeInfo() {
  infoBackdrop.classList.remove('visible');
}
infoBackdrop.addEventListener('click', (e) => {
  if (e.target === infoBackdrop) closeInfo();
});

// --- Modale "Je l'ai vu !" ---
const sightingBackdrop = document.getElementById('sighting-backdrop');
const sightingForm = document.getElementById('sighting-form');
const sightingError = document.getElementById('sighting-error');
const submitSightingBtn = document.getElementById('submit-sighting');
let sightingPointId = null;

function openSighting(point) {
  sightingPointId = point.id;
  sightingError.classList.remove('visible');
  sightingForm.reset();
  closeInfo();
  sightingBackdrop.classList.add('visible');
}
document.getElementById('cancel-sighting').addEventListener('click', () => {
  sightingBackdrop.classList.remove('visible');
});
sightingBackdrop.addEventListener('click', (e) => {
  if (e.target === sightingBackdrop) sightingBackdrop.classList.remove('visible');
});

sightingForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!sightingPointId) return;

  submitSightingBtn.disabled = true;
  submitSightingBtn.textContent = 'Envoi...';
  sightingError.classList.remove('visible');

  const formData = new FormData();
  formData.append('pseudo', document.getElementById('sighting-pseudo').value);
  const photoFile = document.getElementById('sighting-photo').files[0];
  if (photoFile) formData.append('photo', photoFile);

  try {
    const res = await fetch(`/api/points/${sightingPointId}/sightings`, { method: 'POST', body: formData });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Erreur lors de l'envoi");
    }
    sightingBackdrop.classList.remove('visible');
    await loadPoints();
  } catch (err) {
    sightingError.textContent = err.message;
    sightingError.classList.add('visible');
  } finally {
    submitSightingBtn.disabled = false;
    submitSightingBtn.textContent = 'Valider';
  }
});

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// --- Ajout par appui long ---
const addBackdrop = document.getElementById('add-backdrop');
const addForm = document.getElementById('add-form');
const addError = document.getElementById('add-error');
const submitBtn = document.getElementById('submit-add');
let pendingLatLng = null;

let pressTimer = null;
let pressStart = null;
const LONG_PRESS_MS = 550;
const MOVE_TOLERANCE = 12;

const mapContainer = map.getContainer();

function startPress(e) {
  // Un pincement à 2 doigts (zoom) ne doit jamais déclencher l'ajout
  if (e.touches && e.touches.length > 1) {
    cancelPress();
    return;
  }
  const point = e.touches ? e.touches[0] : e;
  pressStart = { x: point.clientX, y: point.clientY };
  pressTimer = setTimeout(() => {
    const latlng = map.containerPointToLatLng(
      map.mouseEventToContainerPoint(point)
    );
    triggerAdd(latlng);
  }, LONG_PRESS_MS);
}

function movePress(e) {
  if (!pressStart) return;
  // Dès qu'un deuxième doigt apparaît (pincement), on annule
  if (e.touches && e.touches.length > 1) {
    cancelPress();
    return;
  }
  const point = e.touches ? e.touches[0] : e;
  const dx = point.clientX - pressStart.x;
  const dy = point.clientY - pressStart.y;
  if (Math.sqrt(dx * dx + dy * dy) > MOVE_TOLERANCE) {
    cancelPress();
  }
}

function cancelPress() {
  clearTimeout(pressTimer);
  pressStart = null;
}

mapContainer.addEventListener('mousedown', startPress);
mapContainer.addEventListener('mousemove', movePress);
mapContainer.addEventListener('mouseup', cancelPress);
mapContainer.addEventListener('mouseleave', cancelPress);

mapContainer.addEventListener('touchstart', startPress, { passive: true });
mapContainer.addEventListener('touchmove', movePress, { passive: true });
mapContainer.addEventListener('touchend', cancelPress);
mapContainer.addEventListener('touchcancel', cancelPress);
mapContainer.addEventListener('contextmenu', (e) => e.preventDefault());

// --- Toggle "Tu as posé" / "Tu as vu" ---
const roleButtons = {
  poseur: document.getElementById('role-poseur'),
  spectateur: document.getElementById('role-spectateur')
};
const addSubtitle = document.getElementById('add-subtitle');
let selectedRole = 'poseur';

const ROLE_TEXT = {
  poseur: { subtitle: "Raconte où et comment tu l'as posé", submit: 'Poser le sticker' },
  spectateur: { subtitle: "Raconte où et comment tu l'as vu", submit: "Valider" }
};

function setRole(role) {
  selectedRole = role;
  roleButtons.poseur.classList.toggle('active', role === 'poseur');
  roleButtons.spectateur.classList.toggle('active', role === 'spectateur');
  addSubtitle.textContent = ROLE_TEXT[role].subtitle;
  submitBtn.textContent = ROLE_TEXT[role].submit;
}
roleButtons.poseur.addEventListener('click', () => setRole('poseur'));
roleButtons.spectateur.addEventListener('click', () => setRole('spectateur'));

function triggerAdd(latlng) {
  pendingLatLng = latlng;
  addError.classList.remove('visible');
  addForm.reset();
  setRole('poseur');
  addBackdrop.classList.add('visible');
  hint.classList.add('hidden');
}

document.getElementById('cancel-add').addEventListener('click', () => {
  addBackdrop.classList.remove('visible');
});
addBackdrop.addEventListener('click', (e) => {
  if (e.target === addBackdrop) addBackdrop.classList.remove('visible');
});

addForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!pendingLatLng) return;

  submitBtn.disabled = true;
  submitBtn.textContent = 'Envoi...';
  addError.classList.remove('visible');

  const formData = new FormData();
  formData.append('lat', pendingLatLng.lat);
  formData.append('lng', pendingLatLng.lng);
  formData.append('role', selectedRole);
  formData.append('pseudo', document.getElementById('pseudo').value);
  formData.append('description', document.getElementById('description').value);
  const photoFile = document.getElementById('photo').files[0];
  if (photoFile) formData.append('photo', photoFile);

  try {
    const res = await fetch('/api/points', { method: 'POST', body: formData });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Erreur lors de l\'envoi');
    }
    addBackdrop.classList.remove('visible');
    await loadPoints();
  } catch (err) {
    addError.textContent = err.message;
    addError.classList.add('visible');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = ROLE_TEXT[selectedRole].submit;
  }
});

// Masque l'astuce après la première interaction avec la carte
map.once('movestart zoomstart', () => hint.classList.add('hidden'));
setTimeout(() => hint.classList.add('hidden'), 6000);

loadPoints();
