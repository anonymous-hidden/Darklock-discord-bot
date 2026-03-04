# Darklock Guard Release Preflight Checklist
- Service installs and starts on boot (systemd/Windows service) and keeps running with GUI closed.
- Strict mode fail-closed verified: chain/baseline/watchers/self-integrity failure -> Tampered & UI locked.
- Website relay allowlist enforced (status/scan/verify only); GUI approval required; requests include device_id/request_id/timestamp; GUI absent -> rejected.
- Onboarding complete flag persisted in backend (`meta.json`); “Protected” not shown until cleared.
- Dev tools/mocks disabled in prod build; binaries signed if applicable.
- Service binary bundled as resource for all targets; GUI bundle version matches Cargo/package version.
- Hashes published: `sha256sum DarklockGuard-Setup.exe darklock-guard_*.deb > SHA256SUMS.txt`.
