# Self-hosting on your own Linux server

This sets up the app to run as a systemd service, with a small webhook
listener that automatically pulls, rebuilds, and restarts it every time you
push to GitHub. Written for Ubuntu/Debian; adjust package manager commands
if you're on something else.

You'll run all of this yourself over SSH — nothing here can be run for you
remotely.

## 0. Prerequisites

- A Linux VPS with a public IP and sudo access.
- (Recommended) A domain name with an A record pointing at the server's IP —
  needed for HTTPS via Caddy. Without one, the app is still fully usable at
  `http://your-server-ip:3000`, just without a padlock.
- Ports 80 and 443 open (if using a domain/TLS).

## 1. Install Node.js, git, and Caddy

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt-get install -y nodejs git

# Optional, only if you have a domain and want HTTPS:
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt-get update && sudo apt-get install -y caddy
```

## 2. Create a deploy user and clone the repo

```bash
sudo adduser --disabled-password --gecos "" deploy
sudo su - deploy
git clone https://github.com/mrwuwei777/discogs-test.git
cd discogs-test
git checkout claude/discogs-photo-collection-app-is1u4y
npm ci
npm run build
```

## 3. Configure secrets

```bash
cp .env.example .env.local
nano .env.local   # fill in DISCOGS_TOKEN, DISCOGS_USERNAME, GEMINI_API_KEY

cp deploy/webhook.env.example deploy/webhook.env
nano deploy/webhook.env   # set WEBHOOK_SECRET to: openssl rand -hex 32
```

Both `.env.local` and `deploy/webhook.env` are gitignored — they never get
committed or pushed.

## 4. Let the deploy user restart the app service without a password

Back as your regular sudo user (exit the `deploy` shell first: `exit`):

```bash
echo "deploy ALL=(root) NOPASSWD: /bin/systemctl restart discogs-app.service" | sudo tee /etc/sudoers.d/discogs-deploy
sudo chmod 0440 /etc/sudoers.d/discogs-deploy
```

## 5. Install the systemd services

```bash
sudo cp /home/deploy/discogs-test/deploy/systemd/discogs-app.service /etc/systemd/system/
sudo cp /home/deploy/discogs-test/deploy/systemd/discogs-webhook.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now discogs-app.service
sudo systemctl enable --now discogs-webhook.service
```

Check both came up clean:

```bash
sudo systemctl status discogs-app.service
sudo systemctl status discogs-webhook.service
```

At this point the app is already running on `localhost:3000`.

## 6. Reverse proxy (optional but recommended)

If you have a domain, edit `deploy/Caddyfile.example`, replace
`your-domain.com`, then:

```bash
sudo cp /home/deploy/discogs-test/deploy/Caddyfile.example /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Caddy will provision an HTTPS certificate automatically. Your webhook URL
will be `https://your-domain.com/webhook`.

No domain? Skip this step — access the app directly at
`http://your-server-ip:3000`, and point the GitHub webhook (next step) at
`http://your-server-ip:9001/webhook` instead (open port 9001 in your
firewall/security group for GitHub's IP ranges, or just for testing).

## 7. Add the GitHub webhook

In the GitHub repo: **Settings → Webhooks → Add webhook**

- Payload URL: `https://your-domain.com/webhook` (or the IP:9001 URL above)
- Content type: `application/json`
- Secret: the same value you put in `deploy/webhook.env`
- Events: just "push"

Save it, then push any commit to `claude/discogs-photo-collection-app-is1u4y`
and watch it deploy:

```bash
sudo journalctl -u discogs-webhook.service -f
sudo journalctl -u discogs-app.service -f
```

## Manual deploy / troubleshooting

Run a deploy by hand at any time:

```bash
/home/deploy/discogs-test/deploy/deploy.sh
```

Restart just the app without redeploying:

```bash
sudo systemctl restart discogs-app.service
```
