# Flag Pinpoint V2

Flag Pinpoint ist ein Echtzeit-Geografie-Spiel mit Solo, Daily Challenge, privaten 1-vs-1-Lobbys, Ranked/Elo, Spectator-Modus und Battle Royale für 4–8 Spieler. Geraten wird die Hauptstadt zur gezeigten Flagge auf einer 2D-Karte oder auf einem unbeschrifteten präzisen 3D-Globus.

## Start

```bash
npm install
npm start
```

Danach: `http://localhost:3000`

## Spielmodi

- **Solo** – klassisches 5000→0-Spiel mit frei wählbaren Regeln.
- **Daily Challenge** – jeden UTC-Tag dieselben 10 Länder für alle, feste faire Regeln, Tagesrangliste.
- **1-vs-1 Classic** – pro Runde baut nur der nähere Spieler seine Restpunkte Richtung 0 ab; der weiter entfernte verliert keine Punkte.
- **Distance Duel** – nur der nähere Spieler erhält in der Runde Punkteabbau.
- **Best of 3/5/7/9** – Rundensiege statt Health-Race.
- **Sudden Death** – der erste eindeutig bessere Guess entscheidet das Match.
- **Battle Royale** – 4–8 Spieler; pro Runde fliegt der schlechteste aktive Guess raus, bis einer übrig ist.
- **Ranked** – feste Standardregeln auf dem 3D-Globus und Elo-Wertung.
- **Spectator** – mit Lobby-Code live zuschauen, ohne ins Match einzugreifen.

## Match-Einstellungen

- 2D-Weltkarte oder 3D-Globus ohne Ortsnamen
- Weltweit oder Regionen/Unterregionen wie Nordeuropa, Südostasien, Karibik usw.
- 5 bis 60 Sekunden Rundenzeit
- 2.500 bis 15.000 Startpunkte
- Punkteabbau ×0,5 bis ×4
- Flaggen-Schwierigkeit Easy / Medium / Hard / Insane
- Volle Flagge / Mystery Crop / Blind Flash (2,5 Sekunden)
- Normal- oder Precision-Distanzkurve
- optionaler Streak-Bonus bis ×1,5
- Battle-Royale-Größe 4–8 Spieler
- eigene Regel-Presets im Browser speichern

Mitgelieferte Presets: Standard, Hardcore Globe, Blitz 8s, Precision, Blind Guess, Distance Duel, Ranked Standard und Chaos ×3.

## Wertung

Im klassischen Modus startet standardmäßig jeder mit 5.000 Restpunkten. Ein perfekter Hauptstadt-Guess bringt bei ×1 bis zu 1.000 Punkte Abbau; mit zunehmender Distanz fällt der Wert exponentiell ab. Precision verwendet eine deutlich steilere Distanzkurve. Der Streak-Bonus erhöht sehr gute Serien schrittweise bis maximal ×1,5.

## Profile, Elo & Achievements

Der Server führt Spielerprofile mit Rating, Matches, Siegen/Niederlagen, durchschnittlicher Distanz, bestem Guess und Best-Streak. Ranked-Matches verändern das Elo-Rating. Achievements werden live freigeschaltet, z. B. Bullseye (<10 km), Sharpshooter, Speed Demon, On Fire, Daily Grinder und Last One Standing.

Profile und Daily-Ranglisten werden standardmäßig in `data/progress.json` gespeichert. Die Datei ist per `.gitignore` ausgeschlossen. In automatischen Node-Testläufen wird Persistenz deaktiviert.

## Matchanalyse

Nach jedem Match zeigt die Ergebnisansicht Durchschnittsdistanz, besten Guess, durchschnittliche Antwortzeit und gesamte Guess-Punkte. Über **Guess-Heatmap & Analyse** werden alle eigenen Rundenpositionen erneut auf der 2D-Karte oder auf dem 3D-Globus dargestellt. Im Spectator-Modus kann die Historie aller Spieler betrachtet werden.

Der 3D-Globus nutzt präzise Ray/Sphere-Klickberechnung, zoomfeste Fadenkreuz-Marker, hochauflösende Earth-Texturen mit Fallbacks, Resultat-Kamerafahrt und eine Impact-Welle an der aufgelösten Hauptstadt.

## Sound

Soundeffekte werden direkt per Web Audio erzeugt und benötigen keine Audiodateien. Im Ingame-Menü kann Sound jederzeit deaktiviert werden.

## Technik

- Node.js 22
- Express 5
- Socket.IO 4
- Leaflet 1.9 für 2D
- Three.js als Browser-ESM für den 3D-Globus
- `world-countries` + lokale `flag-icons`
- serverseitig autoritative Runden-, Timer- und Scoringlogik

## Tests

```bash
npm test
```

Die Tests decken u. a. Capital-Daten, Solo, Custom Rules, Lobby-Sync, Leave-Verhalten, 3D-Duell, Distance Duel, Best-of, Sudden Death, Battle Royale, Spectator, Ranked/Elo, deterministische Daily-Länder, Unterregionen, Blind Visual, Precision und Streaks ab.
