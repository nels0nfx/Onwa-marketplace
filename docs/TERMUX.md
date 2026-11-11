# Android / Termux workflow

Termux handles files and git. It is not expected to run `next build` (Next.js native compilers are unreliable on Android). Builds happen on GitHub Actions, Vercel and Render after you push.

One-time setup:
```
pkg update && pkg install -y git unzip
termux-setup-storage
git clone https://github.com/nels0nfx/Onwa-marketplace.git ~/Onwa-marketplace   # skip if already cloned
```

Apply a release (the ZIP is a complete project, not a patch). Save `ONWA-v0.1.0.zip` to Downloads, then:
```
cd ~/Onwa-marketplace
git pull --rebase origin main
unzip -o ~/storage/downloads/ONWA-v0.1.0.zip -d ~/Onwa-marketplace
git status
git add .
git commit -m "ONWA v0.1.0 - Stage 1 foundation"
git push origin main
```
Authenticate with your own GitHub credentials or token when prompted. Never paste tokens into files.

Optional checks in Termux (pure Node): `pkg install nodejs`, then `node scripts/check-secrets.mjs`.
After pushing, open the repository's **Actions** tab to see the real build/test results.
