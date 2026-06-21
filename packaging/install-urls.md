# Vanity install URLs (`https://montanalabs.ai/sentinel/install.sh`)

The README advertises short install URLs on your own domain:

```
https://montanalabs.ai/sentinel/install.sh
https://montanalabs.ai/sentinel/install.ps1
https://montanalabs.ai/sentinel/install.cmd
```

These are **not** served by this repo — you wire them up on the `montanalabs.ai` web property to
point at the scripts in [`scripts/`](../scripts). Both `curl -fsSL` and PowerShell `irm` follow
redirects, so a simple redirect is enough (you don't have to copy the file content).

## Option A — Redirect (simplest)

Point each path at the raw GitHub script (canonical source, always current):

```
/sentinel/install.sh   →  https://raw.githubusercontent.com/montanalabs/sentinel/main/scripts/install.sh
/sentinel/install.ps1  →  https://raw.githubusercontent.com/montanalabs/sentinel/main/scripts/install.ps1
/sentinel/install.cmd  →  https://raw.githubusercontent.com/montanalabs/sentinel/main/scripts/install.cmd
```

How, depending on where `montanalabs.ai` is hosted:

- **Cloudflare** — a [Redirect Rule](https://developers.cloudflare.com/rules/url-forwarding/) (or a tiny
  Worker) mapping `/sentinel/install.*` to the raw URL.
- **Vercel** — in `vercel.json`:
  ```json
  { "redirects": [
    { "source": "/sentinel/install.sh",  "destination": "https://raw.githubusercontent.com/montanalabs/sentinel/main/scripts/install.sh" },
    { "source": "/sentinel/install.ps1", "destination": "https://raw.githubusercontent.com/montanalabs/sentinel/main/scripts/install.ps1" },
    { "source": "/sentinel/install.cmd", "destination": "https://raw.githubusercontent.com/montanalabs/sentinel/main/scripts/install.cmd" }
  ] }
  ```
- **Netlify** — in `_redirects`:
  ```
  /sentinel/install.sh   https://raw.githubusercontent.com/montanalabs/sentinel/main/scripts/install.sh   200
  /sentinel/install.ps1  https://raw.githubusercontent.com/montanalabs/sentinel/main/scripts/install.ps1  200
  /sentinel/install.cmd  https://raw.githubusercontent.com/montanalabs/sentinel/main/scripts/install.cmd  200
  ```
  (`200` proxies the content; use `302` for a redirect.)
- **Nginx** — `location = /sentinel/install.sh { return 302 https://raw.githubusercontent.com/...; }`

## Option B — Host the files directly

Copy `scripts/install.{sh,ps1,cmd}` to `/sentinel/` on the site at release time (e.g. a CI step that
publishes them). More control (you can serve a pinned version), but you must keep them in sync.

## Notes

- Serve over **HTTPS** only — users are piping it to a shell.
- The install scripts themselves download the **binary** from GitHub Releases; only the entry script
  URL is vanity, so releases keep working regardless of how the vanity URL is wired.
- Until the redirect exists, the raw GitHub URLs work as a drop-in (`https://raw.githubusercontent.com/montanalabs/sentinel/main/scripts/install.sh`).
