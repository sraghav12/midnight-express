# Pitch-video tooling (archive)

The pipeline that produced the 2-minute HackCMU pitch video: `record.mjs` drives a real
run in headless Chromium (board + one real phone + bot phones) and logs an event timeline,
`compose.mjs` cuts it with ffmpeg, `hf-build.mjs` builds a HyperFrames composition with
Gemini / ElevenLabs / `say` narration placed at the real event times, and `howto-shots.mjs`
captured the screenshots in `public/img/`.

It lives in its own package so the game's `npm install` stays at four runtime dependencies;
Playwright and HyperFrames are several hundred megabytes. To use it:

```bash
cd tools/pitch && npm install
npx playwright install chromium
node record.mjs            # against a server on :8080
```

The two `*-chain.sh` scripts contain absolute paths from the hackathon laptop and are kept
only as a record of how the build was sequenced.
