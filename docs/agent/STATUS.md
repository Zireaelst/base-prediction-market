# Status
| Package | State | Evidence | Next |
|---|---|---|---|
| Foundation | complete | Next.js production build and persistent SQLite; authenticated browser account survived navigation | keep local-only configuration |
| Live catalog | complete | actual Limitless public catalog, detail, page 2; tests cover stale/outage and invalid identities | monitor upstream schema and availability |
| Auth and rooms | complete | browser registered two users; nonmember and guest denied private room; owner invite granted member read | production hosting hardening before any launch |
| Wallet sign-in | implemented locally; physical wallet unverified | Base Sepolia SIWE server challenges and real EOA signatures; replay/origin isolation; browser flow with simulated injected provider; 320px wrong-chain rejection | verify physical wallet and smart-account ERC-1271/6492 with actual Sepolia RPC before external claims |
| Forecast and scoring | complete | browser created and revised forecast; unit tests cover lock, correction, contradictory resolution, split outcome | observe actual venue resolution for real-world scoring |
| Paper simulation | complete | browser confirmed hypothetical position and observed local history; tests cover settlement and outage | no real venue orders |
| UI and accessibility | complete | mobile/desktop screenshots, 320px no horizontal overflow, reduced motion, Tab skip link, Escape/focus recovery | monitor visual regressions and upstream venue copy |
| Swipe discovery and categories | integrated on `main` at `f1c9260` | 64 tests/11 files, build/typecheck; production browser read live Sport team outcomes, saved private and joined shared forecasts, recovered stale and total outage, reset a shrunk deck, verified 320px keyboard and reduced-motion card | monitor upstream category mappings |
| Integration/review | complete locally on `main` | Independent review identified three legacy/refresh/form issues; fixed and retested. Confirm API rejects changed terms, historical terms snapshot survives cache update, owner-only personal room uses immediate transaction | keep local-only; physical wallet and venue execution remain unverified/unimplemented |
