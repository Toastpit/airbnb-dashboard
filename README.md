# airbnb-dashboard

Kleines Self-Hosted Dashboard für Airbnb/Booking/Private Buchungen inkl. Settings (Status/Quelle/Zahlstatus/Kurtaxe), Login + Lockout, SQLite DB und Docker-Deployment.

---

## Inhalt

- [Projektstruktur](#projektstruktur)
- [Konfiguration](#konfiguration)
- [Lokal starten](#lokal-starten)
- [Server-Deployment](#server-deployment)
- [Update-Workflow (neue Version aus Git auf Server)](#update-workflow-neue-version-aus-git-auf-server)
- [Datenbank / Persistenz](#datenbank--persistenz)
- [Reverse Proxy (nginx)](#reverse-proxy-nginx)
- [Wichtige Hinweise / typische Fehler](#wichtige-hinweise--typische-fehler)

---




**Wichtig:**
- Alles im Ordner `public/` ist Frontend und wird 1:1 vom Server ausgeliefert.
- Backend-API sitzt in `server/server.js`.
- DB + Migrationen sind in `server/db.js`.

---

## Konfiguration

### `.env`
Lege im Projektroot eine `.env` an (NICHT committen):

```env
DASH_PASS=dein_super_passwort

## Update-Workflow (neue Version aus Git auf Server)

Wenn du lokal etwas geändert hast:
git status
git add .
git commit -m "feat: xyz"
git push

Server
cd /opt/airbnb-dashboard-new
git pull
docker compose up -d --build
docker compose logs -f