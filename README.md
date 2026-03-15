# Crystal Tetrahedron

Standalone WebGL2 port of the Shadertoy effect [Crystal Tetrahedron](https://www.shadertoy.com/view/WsBfWt).

This version keeps the original two-pass structure of the shader, adds a small browser-based control panel, and exposes the effect as a single static page with no build step.

## Features

- WebGL2 port of the original raymarched crystal / dispersion effect
- Two-pass render pipeline with an offscreen scene buffer and post-process depth of field
- Live admin panel for dispersion, bounce count, focus, exposure, and playback speed
- Spacebar pause/resume support
- Drag-to-orbit camera input
- Static-file friendly setup

## Controls

- Drag on the canvas to orbit the camera
- Press `Space` to pause or resume the animation
- Use the admin panel to adjust:
  - Dispersion sample count
  - Bounce count
  - Focus point
  - Focus scale
  - Exposure
  - Time scale

## Getting Started

No build tooling is required.

Open `index.html` directly in a WebGL2-capable browser, or serve the folder locally:

```bash
python3 -m http.server 4173
```

Then open `http://127.0.0.1:4173`.

## Notes

- Performance depends heavily on GPU/browser WebGL2 support.
- If the effect runs slowly, reduce the dispersion and bounce settings from the admin panel.
- The page includes an 8-bit framebuffer fallback if HDR color attachments are unavailable.

## Project Files

- `index.html` mounts the canvas, info card, and admin panel
- `styles.css` contains the standalone page styling
- `app.js` contains the WebGL2 setup, shaders, controls, and render loop

## Credits

- Original shader: [Crystal Tetrahedron on Shadertoy](https://www.shadertoy.com/view/WsBfWt)
- Original author notes and inspiration remain reflected in the ported shader logic
