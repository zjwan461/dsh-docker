# @local/dsh-login-gate

A DSH bundle that puts a sign-in gate in front of the Harness Web UI: account,
password, and a graphic digit captcha. The page behind it is neither visible nor
clickable until the check passes.

## Files

| File | Role |
|---|---|
| `cordis.patch.yml` | The one Host row; `config` holds what the form checks. |
| `index.js` | Host half: publishes the options as the boot global `__DSH_LOGIN_GATE__`. |
| `client.js` | Client half: renders the gate into `shell.overlay` and the sign-out action into `sidebar.footer.action`. |

## Options (`cordis.patch.yml` → `config`)

| Key | Default | Meaning |
|---|---|---|
| `username` | `admin` | Account the form accepts. |
| `password` | `dsh-admin` | Password the form accepts. |
| `captchaLength` | `4` | Digits in the captcha (3–6). |
| `title` | `DeepSeek Harness` | Heading above the form. |
| `rememberDays` | `7` | Days a "remember me" lasts; `0` hides that option. |

Change them on the bundle's page under Settings → Plugins, or in the installed
profile's patch file, then reload the page.

## Behaviour

- A successful check marks the tab (`sessionStorage`), so a reload keeps the tab
  open while a new tab asks again. "Remember me" writes an expiry to
  `localStorage` instead.
- **Sign out** sits beside Settings at the sidebar foot (icon-only in the collapsed
  rail). It renders only while the tab is unlocked; clicking it deletes both
  markers, so the gate returns — measured from the same one unlock state, and with
  empty fields and a freshly drawn captcha, because the form mounts again.
- A wrong captcha or a wrong credential replaces the captcha and clears the code.
- The panel is a modal dialog: focus starts in the account field, Tab stays on its
  own controls, and window-level key events aimed at the app behind it are dropped.

## Scope — read this before relying on it

Verification runs in the browser and both values ship to it in the page. This gates
the UI; it is not authentication for the Harness HTTP API, the CLI, or any profile
on disk, and a client that skips the page can still reach all of them. Use it to
keep a casually opened Harness window behind a sign-in, not as a security boundary.
