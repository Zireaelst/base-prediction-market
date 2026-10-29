# Status
| Package | State | Evidence | Next |
|---|---|---|---|
| Foundation | complete | Next.js production build and persistent SQLite; authenticated browser account survived navigation | keep local-only configuration |
| Live catalog | complete | actual Limitless public catalog, detail, page 2; tests cover stale/outage and invalid identities | monitor upstream schema and availability |
| Auth and rooms | complete | browser registered two users; nonmember and guest denied private room; owner invite granted member read | production hosting hardening before any launch |
| Forecast and scoring | complete | browser created and revised forecast; unit tests cover lock, correction, contradictory resolution, split outcome | observe actual venue resolution for real-world scoring |
| Paper simulation | complete | browser confirmed hypothetical position and observed local history; tests cover settlement and outage | no real venue orders |
| UI and accessibility | complete | mobile/desktop screenshots, 320px no horizontal overflow, reduced motion, Tab skip link, Escape/focus recovery | monitor visual regressions and upstream venue copy |
| Integration/review | complete | two independent reviews addressed; 28 tests, typecheck, clean production build, final browser smoke | local-only; public hardening/legal review outside MVP |
