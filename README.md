# AlgoDesk Pro — Fresh GitHub APK
This main branch is a fresh rebuild of the mobile trading-analysis app. The previous server analytics/test files are removed from the active tree.

Features:
- Market index tiles
- Dark/light theme
- Signals screen with strict verified-signal gate (>=80% win rate and >=100 trades; otherwise no signal)
- OI Lab with live Angel One quotes, ATM and option-chain rows, PCR
- Watchlist and OI classification
- Search
- Floating AI helper that opens/closes independently
- Read-only design: no Buy/Sell or order placement

Architecture:
- Capacitor Android wrapper
- Node 20/Express backend
- Angel One credentials only on backend environment
- GitHub Actions produces app-debug.apk

Required GitHub Actions secrets: API_BASE and APP_KEY.
Backend secrets: APP_KEY, ANTHROPIC_API_KEY, BRAVE_API_KEY, ANGEL_API_KEY, ANGEL_CLIENT_CODE, ANGEL_PIN, ANGEL_TOTP_SECRET.

Important: no fabricated 80% signal is displayed. A real backtest dataset/engine is required before a signal is marked verified.
