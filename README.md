# Flag Pinpoint

Ein Browser-Flaggenspiel für **Solo** und **1-gegen-1 Multiplayer**. Du erkennst die Flagge und setzt deinen Tipp möglichst genau auf die Hauptstadt. Das Spiel ist wahlweise auf einer klassischen 2D-Karte oder auf einem präzisen, unbeschrifteten 3D-Globus spielbar.

## Features

- Solo-Modus ohne Gegner und private 1v1-Lobbys mit sechsstelligen Codes
- Echtzeit-Multiplayer über Socket.IO / WebSockets
- Frei konfigurierbare Regeln für Solo und neue Multiplayer-Lobbys:
  - Region: Weltweit, Europa, Asien, Afrika, Amerika oder Ozeanien
  - Zeitlimit: 10, 15, 22, 30, 45 oder 60 Sekunden pro Flagge
  - Startpunkte: 2.500, 5.000, 7.500 oder 10.000
  - Punkteabbau-Multiplikator: ×0,5, ×1, ×1,5, ×2 oder ×3
- Der Host legt alle Multiplayer-Regeln fest; beitretende Spieler übernehmen sie automatisch
- Regionseinstellung begrenzt den Flaggen-/Länderpool serverseitig auf den gewählten Kontinent
- Das Match endet, sobald ein Spieler bzw. im Solo-Modus der Spieler 0 Restpunkte erreicht
- Basiswertung: perfekter Guess = bis zu 1.000 Punkte Abbau bei ×1
- Multiplikator wirkt direkt auf den Punkteabbau, z. B. ×2 = bis zu 2.000 Punkte bei perfektem Guess
- Weicher exponentieller Distanz-Falloff: weit entfernte Tipps bauen nur wenige Punkte ab
- Zwei Kartenmodi: klassische 2D-Weltkarte oder interaktiver 3D-Globus
- 3D-Globus mit echter WebGL-Kugel, Weltraum-Look, unbeschrifteter 8K-Erdtextur und ohne Länder-/Städtenamen
- Präzise analytische Ray-Sphere-Auswahl auf dem Globus, unabhängig von der Mesh-Auflösung
- Kleine zoomfeste Zielringe mit exaktem Mittelpunkt statt großer unpräziser Marker
- Globus auf Desktop und Handy drehen und tief zoomen; Pinch-Zoom auf Touch-Geräten
- Große interaktive 2D-Weltkarte mit Leaflet + OpenStreetMap
- Distanzberechnung und Punkteberechnung ausschließlich auf dem Server
- Hauptstadt-Zielpunkte mit festen Stadtkoordinaten
- Stabiler kuratierter Flaggen-Pool mit 150+ spielbaren Ländern
- Reveal-Phase mit Ziel, Tipps, Distanz und abgebauten Punkten
- Rematch im Multiplayer und „Nochmal spielen“ im Solo-Modus mit identischen Regeln
- Reconnect-Fenster bei kurzen Verbindungsabbrüchen
- Responsive Mobil- und Desktop-Oberfläche
- Opaque Flag-URLs: Der ISO-Ländercode wird nicht in der Browser-URL verraten
- `/health` Endpoint und `render.yaml` für Render-Deployments

## Lokal starten

Voraussetzung: Node.js 22.x.

```bash
npm install
npm start
```

Danach: `http://localhost:3000`

Entwicklung mit Auto-Restart:

```bash
npm run dev
```

Tests:

```bash
npm test
```

## Match-Einstellungen

Die Startseite enthält einen gemeinsamen Einstellungsblock für **Solo** und **neue 1v1-Lobbys**. Bei einer bestehenden Lobby gelten ausschließlich die Einstellungen des Hosts.

### Region

Die Region bestimmt, aus welchem Länderpool die nächste Flagge gezogen wird. Die Karte bzw. der Globus bleibt frei navigierbar; nur die möglichen Zielländer werden auf Weltweit, Europa, Asien, Afrika, Amerika oder Ozeanien begrenzt.

### Zeitlimit

Jede Runde bekommt das gewählte Zeitlimit. Nach Ablauf wird ein nicht abgegebener Tipp mit 0 Punkten gewertet.

### Startpunkte

Jeder Teilnehmer startet mit der gewählten Restpunktzahl. Im Solo-Modus gilt dieselbe Zahl für den eigenen Run.

### Punkteabbau-Multiplikator

Die normale Distanzkurve bleibt gleich, aber der mögliche Punkteabbau wird multipliziert. Bei ×1 bringt ein perfekter Treffer bis zu 1.000 Punkte, bei ×1,5 bis zu 1.500, bei ×2 bis zu 2.000 usw. Der Reststand kann dabei niemals unter 0 fallen.

## Architektur

```text
flag-guessing-game/
├── public/
│   ├── app.js          # Browser-Logik, Solo/Multiplayer, Einstellungen, UI, Socket-Events
│   ├── globe.js        # Three.js/WebGL-Globus, exakte Auswahl, 3D-Marker und Ergebnisbögen
│   ├── index.html      # Home, Einstellungen, Lobby, Spiel und Ergebnis
│   └── styles.css      # Responsive Design
├── src/
│   ├── capitals.js     # Hauptstadt-Koordinaten
│   ├── countryPool.js  # Kuratierter ISO-Länderpool
│   └── gameServer.js   # Express, Socket.IO, Solo/Lobbys, Regionen, Timer und Scoring
├── tests/
│   ├── capitals.test.js
│   ├── countryPool.test.js
│   ├── settings-solo.test.js
│   └── smoke.test.js
├── render.yaml
├── server.js
└── package.json
```

## Auf Render deployen

### Variante A: mit `render.yaml`

1. Projekt in ein GitHub-Repository pushen.
2. Bei Render **New > Blueprint** wählen.
3. Repository verbinden.
4. Render erkennt `render.yaml` und erstellt den Node Web Service.
5. Danach die erzeugte `*.onrender.com` URL öffnen.

### Variante B: normaler Web Service

1. Bei Render **New > Web Service** wählen und das Repository verbinden.
2. Runtime: **Node**
3. Build Command: `npm install --omit=dev`
4. Start Command: `npm start`
5. Health Check Path: `/health`

Die Lobby- und Solo-Zustände liegen im Arbeitsspeicher des Node-Prozesses. Für horizontale Skalierung auf mehrere Instanzen sollten Zustand und Socket.IO-Pub/Sub später über Redis geteilt werden.

## Karten-, Globus- und Flag-Daten

- 2D-Karte: OpenStreetMap Tiles über Leaflet
- 3D-Globus: Three.js/WebGL; keine Kartenlabels oder Ortsnamen auf der Kugel
- Erdoberfläche: 8192×4096 NASA-Blue-Marble-Satellitentextur ohne Labels, mit 4K/2K-Fallback für kleinere GPU-Texturlimits
- Länder-Metadaten und Kontinentzuordnung: `world-countries`
- SVG-Flaggen: `flag-icons`

Three.js und die Erdtextur werden im 3D-Modus per HTTPS geladen. Der Globus wählt abhängig vom WebGL-Texturlimit des Geräts automatisch die höchste sichere Auflösung und nutzt anisotrope Filterung für schärfere Details.

## Version 1.3.0 – Solo & Custom Rules

Neu sind ein echter Solo-Modus und gemeinsame Match-Einstellungen für Solo und Multiplayer. Region, Rundenzeit, Startpunkte und Punkteabbau-Multiplikator sind Teil des serverseitigen Matchzustands. Bei Multiplayer-Partien werden sie automatisch an beide Spieler synchronisiert und bei Rematches beibehalten.

Die Regionsauswahl filtert den zufälligen Länderpool serverseitig, während das bestehende Hauptstadt-/Distanzsystem unverändert bleibt. Das Scoring berücksichtigt jetzt zusätzlich den Match-Multiplikator.
