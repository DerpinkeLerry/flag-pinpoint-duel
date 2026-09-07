# Flag Pinpoint Duel

Ein komplettes 1-gegen-1-Flaggen-Spiel für den Browser. Ein Spieler erstellt eine Lobby, teilt den sechsstelligen Code und sobald ein zweiter Spieler beitritt, startet das Match automatisch.

## Features

- Private 1v1-Lobbys mit sechsstelligen Codes
- Echtzeit-Multiplayer über Socket.IO / WebSockets
- Beide Spieler starten mit 5000 Restpunkten; wer zuerst 0 erreicht, gewinnt
- Bis zu 1000 Punkte Fortschritt pro Guess, mit weichem Distanz-Falloff zur Hauptstadt
- 22 Sekunden pro Flagge; das Match läuft so viele Runden wie nötig
- Große interaktive Weltkarte mit Leaflet + OpenStreetMap
- Pin setzen und Tipp verbindlich abgeben
- Distanzberechnung ausschließlich auf dem Server (Haversine)
- Je näher der Tipp an der Hauptstadt liegt, desto mehr Restpunkte werden beim eigenen Stand abgezogen
- Hauptstadt-Zielpunkte mit festen Stadtkoordinaten statt ungefährem Ländermittelpunkt
- Stabiler kuratierter Flaggen-Pool mit 150+ eher spielbaren Ländern; unabhängig von optionalen `world-countries`-Feldern
- 9 Sekunden Reveal-Zeit mit sichtbaren Spieler-Pins, Hauptstadt-Ziel und Verbindungslinien
- Live-Restscore und Ergebnisbox mit Distanz + abgebauten Punkten
- Rematch ohne neue Lobby
- Reconnect-Fenster bei kurzen Verbindungsabbrüchen
- Mobil- und Desktop-Layout
- Opaque Flag-URLs: Der ISO-Ländercode wird nicht im Browser-URL verraten
- `/health` Endpoint für Render
- `render.yaml` für direkten Render-Deploy

## Lokal starten

Voraussetzung: Node.js 22.x.

```bash
npm install
npm start
```

Danach: `http://localhost:3000`

Für Entwicklung mit Auto-Restart:

```bash
npm run dev
```

Tests:

```bash
npm test
```

## Auf Render deployen

### Variante A: mit `render.yaml`

1. Dieses Projekt in ein GitHub-Repository pushen.
2. Bei Render **New > Blueprint** wählen.
3. Repository verbinden.
4. Render erkennt `render.yaml` und erstellt den Node Web Service.
5. Nach dem Deploy die erzeugte `*.onrender.com` URL öffnen.

### Variante B: normaler Web Service

1. Bei Render **New > Web Service** wählen und das Repository verbinden.
2. Runtime: **Node**
3. Build Command: `npm install --omit=dev`
4. Start Command: `npm start`
5. Health Check Path: `/health`

Der Server bindet an `0.0.0.0` und verwendet automatisch `process.env.PORT`, wie es Render für Web Services erwartet.

## Architektur

```text
flag-guessing-game/
├── public/
│   ├── app.js          # Browser-Logik, Leaflet, UI, Socket-Events
│   ├── index.html      # Screens für Home, Lobby, Spiel und Ergebnis
│   └── styles.css      # Responsive Design
├── src/
│   ├── capitals.js     # Hauptstadt-Koordinaten für die Spielziele
│   ├── countryPool.js  # Stabiler kuratierter ISO-Länderpool
│   └── gameServer.js   # Express, Socket.IO, Lobbys, Runden, Scoring
├── tests/
│   ├── capitals.test.js
│   ├── countryPool.test.js
│   └── smoke.test.js   # Multiplayer-Smoke-Test
├── render.yaml
├── server.js
└── package.json
```

## Wichtiger Hosting-Hinweis

Die Lobby-Daten liegen absichtlich im Arbeitsspeicher des Node-Prozesses. Für einen einzelnen Render-Instance ist das ideal und simpel. Wenn du später horizontal auf mehrere Instanzen skalieren willst, solltest du Lobby-/Spielzustand in Redis speichern und den Socket.IO Redis Adapter einsetzen, damit beide Spieler unabhängig von der gewählten Instanz denselben Zustand sehen.

## Karten- und Flag-Daten

- Karte: OpenStreetMap Tiles über Leaflet
- Länder-Metadaten: `world-countries`
- SVG-Flaggen: `flag-icons`

Die Flaggen werden vom eigenen Server über zufällige Tokens ausgeliefert. Dadurch steht der Ländercode nicht direkt in der Flag-URL des Clients.

## Hotfix 1.1.1

`world-countries@5.1.0` stellt kein `population`-Feld bereit. In Version 1.1.0 wurde ein fehlender Wert dadurch als `0` behandelt und der Flaggen-Pool fiel auf nur acht Sonderfälle zusammen. Version 1.1.1 verwendet stattdessen eine feste kuratierte ISO-Liste und fällt bei unerwarteten Paketänderungen auf alle Länder mit vollständigen Hauptstadt- und Flag-Daten zurück, statt den Render-Prozess beim Start abzubrechen.

## Scoring

Jeder Spieler startet bei **5000**. Pro Runde werden anhand der Entfernung zur gesuchten Hauptstadt **0 bis 1000 Punkte** vom eigenen Reststand abgezogen. Ein perfekter Treffer ergibt 1000 Punkte; mit wachsender Entfernung fällt die Wertung exponentiell ab, sodass sehr weit entfernte Tipps nur wenige oder gar keine Punkte abbauen. Das Match endet, sobald ein Spieler 0 erreicht.
