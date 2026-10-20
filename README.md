# Fährtenfuchs 🦊

Fahrrad-Schnitzeljagd fürs Handy: Route mit Checkpoints auf der Karte planen, unterwegs Rätsel lösen, am Ende ein Fotobuch.
Läuft komplett auf dem Gerät – kein Backend, Route, Spielstand und Fotos bleiben lokal.

- `www/` – die App (HTML/CSS/JS, Karte über OpenStreetMap/Leaflet, Routen vom FOSSGIS-OSM-Routing, kein API-Key)
- `android/` – Android-Hülle mit [Capacitor](https://capacitorjs.com/) (`de.faehrtenfuchs.app`)
- `assets/` – App-Symbol und Splash
- Community-Routen: [faehrtenfuchs-routen](https://github.com/Arno-Hoefer/faehrtenfuchs-routen)

## Bauen

```bash
npm install
npx cap sync android
cd android && ./gradlew assembleDebug
```

Als Web-App reicht ein statischer Host mit HTTPS (GPS und Kamera brauchen HTTPS), z. B. `www/` auf Netlify oder GitHub Pages.

## Bedienung

- **Planungsmodus:** auf der Startseite 5× auf die Flagge tippen → auf die Karte tippen setzt Checkpoints (Name, Rätsel, Antwort, Tipp);
  der letzte Checkpoint ist der Schatz. Route als JSON exportieren/importieren.
- **Spiel:** Karte mit Position, Linie und Entfernung zum nächsten Checkpoint; im Zielradius öffnet sich das Rätsel, danach das Foto.
- **Fotobuch:** nach dem Finale – Cover mit gefahrener Route, pro Checkpoint Foto, Rätsel und Uhrzeit, als PDF druckbar.
- **GPS-Simulation** im Planungsmodus zum Testen vom Sofa aus.
