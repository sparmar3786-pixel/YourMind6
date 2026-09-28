# AlgoDesk — Fresh Build

Fresh Android + Node backend implementation from the uploaded AlgoDesk blueprint. This branch does not reuse the old Android project, Gradle setup, package identity, UI code or old trading formulas.

## App scope
- Market, Signals, OI Lab, Watchlist, Search and More.
- Touchable index cards/chips, dark + bright theme, touchable AI helper, live option-chain snapshot.
- Option detail: strike, CE/PE, ATM/ITM/OTM, LTP, OI, OI change, PCR, support/resistance, and reference entry/stop-loss/target/exit levels.
- Angel One SmartAPI is read-only; no order placement. Current SmartAPI host and Scrip Master wiring use Angel One's `apiconnect.angelone.in` / `margincalculator.angelone.in` endpoints.
- Option-chain rows are assembled from the Angel One Scrip Master plus SmartAPI market quotes; SmartAPI documentation also describes token-based WebSocket streaming for live option data.
- AI helper explains supplied data in simple Hindi.
- Search + AI public-page reading and broker-screen photo/text reading.
- A signal is **verified** only when it has at least 100 completed trades and at least 80% win rate. Until historical backtest evidence exists, signals remain demo/unverified.

## Structure
- `www/index.html` — single-page mobile UI.
- `server/server.js` — Node 20 API.
- `server/lib/analytics.js` — tested OI/signal calculations.
- `server/test/` — Node built-in tests.
- `.github/workflows/android.yml` — Capacitor Android debug APK build.

## Backend secrets
Use `server/.env.example`. Keep Angel One credentials and API keys on the backend only.

## APK
GitHub Actions expects `API_BASE` and `APP_KEY` as Actions secrets. The artifact is `algodesk-apk` containing `app-debug.apk`.

## Angel One configuration
Set these on the backend host (never inside the APK): `ANGEL_API_KEY`, `ANGEL_CLIENT_CODE`, `ANGEL_PIN`, `ANGEL_TOTP_SECRET`. The app only receives read-only market data through `/api/quotes` and `/api/option-chain`.

## Data status
Live-capable pieces depend on configured server credentials/network. Option signal win-rate claims are not treated as verified until a historical backtest engine produces the required sample size.

## Local tests
```bash
cd server
npm install
npm test
npm start
```
