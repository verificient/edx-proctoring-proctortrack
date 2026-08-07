# edx-proctoring-proctortrack-v2

Proctortrack proctoring backend for [Open edX](https://openedx.org/), built on
[`edx-proctoring`](https://github.com/openedx/edx-proctoring).

This repository ships two packages:

| Package | Registry | Purpose |
|---------|----------|---------|
| `edx-proctoring-proctortrack-v2` | PyPI | Registers the `proctortrack` Django backend (`openedx.proctoring` entry point) |
| `edx-proctoring-proctortrack-v2` | npm | Provides `proctortrack_custom.js` — the browser Web Worker used during exams |

> **Note:** This is the v2 distribution of the original `edx-proctoring-proctortrack`
> package. The Python import path (`edx_proctoring_proctortrack`) and Studio
> proctoring provider name (`proctortrack`) are unchanged.

## Requirements

- Python 3.11+
- Open edX with `edx-proctoring` installed
- Node.js (for npm package / webpack worker bundling at image build time)

## Install (packages only)

These packages are published to PyPI and npm. In a typical Open edX deployment,
the Tutor plugin installs them for you at image build time — you do not need to
run these commands manually.

### PyPI

```bash
pip install edx-proctoring-proctortrack-v2==2.0.0
```

### npm

```bash
npm install edx-proctoring-proctortrack-v2@2.0.0
```

## Open edX integration

From **Sumac** onward, Proctortrack is not bundled in edx-platform. Integration
is done with a **Tutor plugin** (`proctortrack_v2.py`) that installs
`edx-proctoring-proctortrack-v2` from PyPI/npm and applies the required Django
settings during `tutor images build openedx`. No edx-platform fork is required.

**Contact [Verificient](https://www.verificient.com/)** to obtain the Tutor
plugin and Proctortrack credentials for your environment.

### What you need from the Open edX side

| Requirement | Notes |
|-------------|-------|
| [Tutor](https://docs.tutor.edly.io/) | v15+ (Olive) through current; tested on Sumac/Ulmo |
| Docker | Required for Tutor image builds |
| Learning MFE | Proctored exams are served via the Learning MFE |
| Studio course setup | Set **Proctoring Provider** to `proctortrack` and configure proctored subsections |

The plugin configures `PROCTORING_BACKENDS`, feature flags, CORS, and webpack
worker settings automatically.

### What you need from the Proctortrack side

| Requirement | Notes |
|-------------|-------|
| Proctortrack server | Running instance with OAuth credentials |
| `client_id` / `client_secret` | Issued by Verificient for your LMS |
| `base_url` | Your Proctortrack server URL |
| Proctortrack desktop app | Installed on the learner's machine during exams |
| JS routing config (if applicable) | required public key, or CDN/config — provided by Verificient |

### Once you have the plugin

1. Edit the configuration constants at the top of `proctortrack_v2.py` (credentials
   and JS routing keys supplied by Verificient).

2. Install and enable the plugin:

   ```bash
   cp proctortrack_v2.py "$(tutor plugins printroot)/"
   tutor plugins enable proctortrack_v2
   ```

3. Build and launch:

   ```bash
   tutor images build openedx
   tutor local launch
   ```

4. In Studio, set **Proctoring Provider** to `proctortrack` for the course and
   mark subsections as **Proctored Exam**.

After any plugin configuration change, rebuild the image:

```bash
tutor images build openedx
```

## Development

```bash
pip install -e .
pip install -r requirements/base.txt
make extract_translations
```

## License

Apache-2.0 — see [LICENSE.md](LICENSE.md).

## Links

- Repository: https://github.com/verificient/edx-proctoring-proctortrack
- Issues: https://github.com/verificient/edx-proctoring-proctortrack/issues
