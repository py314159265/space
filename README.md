# space.example.com

Static site for [space.example.com](https://space.example.com), published with GitHub Pages from the `main` branch at the repository root.

## Explorers of the Solar System

The 3D atlas is at [`/probes/`](probes/). Planets are drawn from orbital elements. Spacecraft tracks come from JPL Horizons and are stored in `data/probes.json`. three.js r170 is vendored in `probes/vendor/`.

The phone planetarium is at [`/sky/`](sky/).

| Path | Purpose |
| --- | --- |
| `index.html` | Landing page |
| `probes/` | Atlas |
| `sky/` | Phone planetarium |
| `data/probes.json` | Bundled Horizons tracks |
| `scripts/fetch_probes.py` | Refresh those tracks |
| `.github/workflows/update-probes.yml` | Daily update, committed back to this repo |
| `CNAME` | Custom domain |
| `.nojekyll` | Skip Jekyll |

## Pages

In **Settings → Pages**, deploy from branch `main`, folder `/ (root)`. The `CNAME` file is `space.example.com`.

## Data

`.github/workflows/update-probes.yml` runs `scripts/fetch_probes.py` once a day, and can be started by hand from the Actions tab. It commits `data/probes.json` in this repository only when the file changed. The workflow sets `permissions: contents: write`. If a push is still rejected, set **Settings → Actions → General → Workflow permissions** to **Read and write permissions**.

A target keeps its previous samples when Horizons fails, so one bad response does not wipe a track.

## Run locally

```sh
python3 -m http.server 8000
```

Open <http://localhost:8000/> and <http://localhost:8000/probes/>. The atlas requests `data/probes.json` over HTTP, so use a static server rather than a `file://` URL.
