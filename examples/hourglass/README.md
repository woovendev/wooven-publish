# Hourglass

A sand clock in the browser. Grains are a cellular sand simulation on the GPU: a WebGL fragment shader updates a ping-pong texture, so grains fall, slide into a pile, and thread through the neck. Tap, click, or press Space to flip the glass; the sand in the lower bulb comes back down. 1, 3, and 5 minutes set how long the sand now in the upper bulb takes to run through — the neck lets grains through at that rate, and a flip starts the timer over for whatever just became the top.

Static files only (`index.html`, `style.css`, `main.js`). No build step and no server. If WebGL is missing, the page says so instead of showing a blank glass.

Open `index.html` directly, or from the repo root:

```bash
python3 -m http.server 4173
# http://localhost:4173/examples/hourglass/
```

Publish this folder:

```bash
./bin/wooven-publish ./examples/hourglass --client cursor
```
