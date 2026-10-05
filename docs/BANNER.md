# Profile banner

A 3D mechanical keyboard drawn with Three.js. Each key is one day of the owner's GitHub contributions. A workflow redraws it every hour (only when the numbers change) and publishes two looping GIFs for the README, plus a live version on GitHub Pages.

- README banner: `https://raw.githubusercontent.com/woraphatman/Woraphatman/output/banner-day.gif` and `banner-night.gif`
- Live page: <https://woraphatman.github.io/Woraphatman/> (drag to spin, double-click to reset; follows the visitor's light or dark setting; `?theme=day|night` forces one)

## What the picture shows

- 83 keys are the 83 most recent days: the oldest day is Esc, today is the right arrow key. Height and colour follow the day's count (cream, Duck Yellow, Deep Amber, Beak Orange on a square-root scale); empty days are flat grey keys.
- One loop is 6.42 s: keys with contributions press down from the lightest day to the darkest, stay down, spring back together, today's key flashes once, the board rests, and it starts again. The GIFs play it at 60 ms per frame.
- The OLED shows `@login`, TODAY, WEEK (last 7 days), STREAK, the year total, a 7-day sparkline and `updated HH:MM`, the time the data was fetched in Asia/Bangkok (the colon blinks with the status dot). There is no pull request row: the workflow's token cannot see private pull requests, so none are shown.

## Files

| Path | Role |
| --- | --- |
| `index.html`, `main.js`, `src/` | the scene and the live page; `?still=1` switches to progressive-accumulation stills |
| `fetch_data.mjs` | GraphQL query for the calendar, writes `data.json` |
| `capture.mjs`, `capture-anim.mjs`, `capture-lib.mjs` | headless Chrome captures: stills and the animation (PNG frames, then GIF and WebP through sharp) |
| `parity.mjs` | compares a software-GL frame with a hardware frame |
| `scripts/should-render.mjs` | the skip decision; `scripts/build-dist.mjs` assembles the `output` branch |
| `.github/workflows/render.yml` | the pipeline below |
| `tests/` | `npm test` (node only, no browser) |

## Data and privacy

`fetch_data.mjs` asks GraphQL for `user(login: $OWNER)` and nothing else: the login, the yearly total and the per-day counts. It never selects repository names, pull requests, organisations or e-mail addresses, and `summarize()` copies a fixed list of fields, so `data.json` holds only `login, yearTotal, todayCount, weekTotal, currentStreak, asOf, generatedAt, days[{date, count}]`. `tests/data.check.mjs` fails if anything else shows up, including when the API response itself carries more.

The token is `GITHUB_TOKEN` or `GH_TOKEN`; without either, the script uses `gh auth token`. In Actions the built-in token is enough because the calendar is public, and private work only adds to its counts (the profile page shows the same total to anyone).

Days are UTC dates: GitHub timestamps contributions in UTC ([Contributions on your profile](https://docs.github.com/en/account-and-profile/concepts/contributions-on-your-profile)). For Asia/Bangkok (UTC+7) the calendar's "today" therefore rolls over at 07:00 local time. Between 00:00 and 07:00 the TODAY row, the flashing key and `asOf` still describe the previous Bangkok date, and a commit made in those hours counts for that previous date. The OLED clock is separate: it is the fetch time, shown in the zone set by `TZ` (the workflow sets `Asia/Bangkok`; the capture also pins the page's time zone to it).

## How a frame is drawn

The banner is a progressive render: each frame accumulates N jittered renders of the same pose. Every sample moves the camera by a sub-pixel offset (anti-aliasing) and across a small lens disc (depth of field), and swings the sun between a tight key light and a wide sky dome (soft shadows with real penumbrae). The result is exact for a given sample count, so the same code gives the same picture on a GPU and on software GL.

Two profiles control the cost (`PROFILES` in `main.js`):

| | default | `?profile=ci` |
| --- | --- | --- |
| samples per frame | 160 (the captures pass 96 for the animation, 192 for stills) | 32 |
| shadow map | 4096 | 1024 |
| light samples per cycle of 8 | 5 key + 3 dome | 3 key + 5 dome |
| desk shadow filter for dome samples | default | widened to 0.16 world units |

Why these values (1600 x 600, compared with the 96-sample GPU render, mean absolute difference in 8-bit levels over nine frames per theme):

- The shadow map size does not matter down to 1024: 1024 differs from 2048 by 0.05 levels, 4096 by 0.03; 512 starts to show (0.11). On SwiftShader it also saves about 11 % of a frame.
- Three key and five dome samples per cycle beat five and three, because the tight key light needs fewer samples than the wide dome. With both changes the mean difference at 24 samples falls from 1.52 to 1.23 (day) and from 0.44 to 0.37 (night). The widened filter (desk only, so the shadows keys cast on the case stay crisp) melts the stepped copies of the soft floor shadow that few samples leave behind.
- Samples must be a multiple of 8, or the key/dome brightness no longer averages out.

| samples (profile `ci`) | 16 | 24 | **32** | 40 | 48 |
| --- | --- | --- | --- | --- | --- |
| day, mean difference | 1.51 | 1.23 | **0.93** | 0.73 | 0.50 |
| night, mean difference | 0.49 | 0.37 | **0.29** | | |

At 32 samples no frame has fireflies or shadow acne; the remaining differences are slightly softer text on the OLED and faint stripes in the far end of the floor shadow, visible only when a crop is enlarged 2x. A frame rendered by llvmpipe on the runner (24 samples) differs from the same frame on the local GPU by 0.09 (day) and 0.05 (night) levels on average and by 1 level at the 99th percentile, and passes `parity.mjs`.

Only distinct poses are rendered: the lead-in, the hold with every key down and the rest at the end repeat, so 94 of the 107 frames are drawn and the repeats are reused (`poseKey` in `src/timeline.js`). The GIFs are 1600 x 600, 256 colours with dithering and 3 levels of fixed-pattern noise to hide banding, about 1 MB each; the build fails rather than publish one above 5 MB. Encoder effort 7 gives the same palette quality as 10 (0.24 levels apart) in 60 % of the time.

## The workflow

`render.yml` runs three jobs:

1. **prepare**: fetch the data, run `npm test`, compare the data (without `generatedAt`) with `data.json` on the `output` branch.
2. **render**: one runner per theme. Chrome runs on Mesa llvmpipe under xvfb, draws the 94 frames and sharp encodes the GIF.
3. **publish**: assemble `dist/` (both GIFs, `data.json`, `index.html`, `main.js`, `src/`) and force-push it as the orphan `output` branch. GitHub Pages serves that branch.

Triggers: every hour at minute 17, a manual run, and a push to `master` that touches the render code or the workflow. Only the hourly run can skip: when the data is the same as the published data, `render` and `publish` are skipped. A push and a manual run always render. `permissions` is `contents: write` only, runs never overlap, every action is pinned to a commit SHA, and the render jobs time out after 45 minutes.

Measured on the runner (AMD EPYC 7763, 4 vCPU, Chrome 154):

| backend | seconds per frame at 24 samples |
| --- | --- |
| Chrome SwiftShader | 22.9 |
| Mesa llvmpipe, GLX under xvfb | 4.3 to 4.8 |
| Mesa lavapipe (Vulkan) | 5.0 |

At 24 samples SwiftShader would need about 72 minutes for the two themes (94 frames each), so the workflow uses llvmpipe (`--gl=mesa`). `capture-anim` checks the renderer name and stops if Chrome silently fell back to another one. The first full run at 32 samples took 13 min 48 s: 6.1 s per frame for the day theme and 7.1 s for the night theme (it has a second area light), 100 s for each GIF encode.

To probe a change without publishing, start the workflow by hand with `probe` set to a number of frames (`from` picks the first one, `samples` overrides the sample count): each theme renders that many frames and uploads them as an artifact.

## Running it locally

```sh
npm ci
npm test                          # unit checks, no browser needed
node fetch_data.mjs --owner=<login>   # needs GITHUB_TOKEN, GH_TOKEN or a logged-in gh
node capture.mjs                  # stills: out/banner-day.png, out/banner-night.png
node capture-anim.mjs             # animation: out/banner-*.webp and .gif (GPU, 96 samples)
node capture-anim.mjs --profile=ci --formats=gif   # what CI renders, on any GL
node parity.mjs out/banner-day.png out/_scratch/swiftshader/banner-day.png
```

`--gl=gpu|swiftshader|mesa|lavapipe` picks the rasteriser, `CHROME_PATH` the browser, `CHROME_FLAGS` extra flags, `TZ` the time zone of the OLED clock. `CI=1` adds `--no-sandbox`. Serving `index.html` from any static server gives the live page; a render needs Chrome or Edge.

## Known limits

- The calendar counts public and private contributions but not their kind, so the OLED has no pull request or repository row.
- GitHub disables scheduled workflows in a public repository after 60 days without repository activity; a manual run or any push enables them again.
- The README GIF is cached by GitHub's image proxy for a few minutes after each publish.
- If a runner image ever loses xvfb or Mesa, the render job installs them; if llvmpipe still does not start, the job fails on the renderer check and the previous banner stays published.
