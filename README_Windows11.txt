SRC Web-Trainer (lokal, Original-Audio) – Start unter Windows 11

WICHTIG:
Öffne index.html NICHT per Doppelklick (file://...), weil der Browser dann JSON/Audio teils blockiert.
Starte stattdessen einen lokalen Webserver (localhost).

Variante A (Python, kostenlos):
1) cmd öffnen
2) In den Ordner wechseln, z.B.:
   cd C:\SRC-WebTrainer
3) Server starten:
   python -m http.server 8000
4) Browser:
   http://localhost:8000

Variante B (Node.js, kostenlos):
1) Node.js LTS installieren
2) cmd:
   cd C:\SRC-WebTrainer
   npx http-server -p 8000
3) Browser:
   http://localhost:8000

iPhone im selben WLAN:
- PC-IP herausfinden: cmd → ipconfig → IPv4-Adresse
- iPhone Safari:
  http://DEINE-PC-IP:8000

Audio:
- Button "Original-Audio abspielen" spielt die MP3 unter /audio/ ab (Text 01–27).
- "Stopp" stoppt und setzt zurück.
