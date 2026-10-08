# OUR-SLAM: anonymous supplementary project page

A self-contained project page and interactive replay of the experiments in the
submitted manuscript. Authors: Anonymous.

The artifact contains explanatory method diagrams, numerical results, and a
3D viewer for 9 NTU VIRAL and 4 in-house stereo sequences. The viewer replays
recorded trajectories and UWB decisions; it does not run the SLAM optimizer.
The manuscript PDF is submitted separately and is not included here.

## Run the already-built page

Install Node.js 22.12 or newer. From this folder run:

```sh
node scripts/serve.mjs
```

Open http://127.0.0.1:4175/. No package installation is needed for previewing
the included static page. Use an HTTP server instead of opening index.html as
a file, because the viewer loads local replay scripts.

## Install and rebuild

With Node.js 22.12+ and npm installed, run from this folder:

```sh
npm ci
npm run build
npm run serve
```

An uncached package installation needs internet access. The build uses only
this folder and its locked npm dependencies. It updates root `index.html`,
`assets/`, and `favicon.svg`, and writes a static copy to `dist/`.
All runtime assets use relative URLs, including under nested hosting paths.
The static build uses classic scripts and a stylesheet without crossorigin.
Sequence data loads through generated local scripts and is decompressed in the
browser. It does not require CORS, module scripts, Web Workers, or runtime fetch.
The original JSON and gzip files are retained for downloading and inspection.

## Repository layout

- `index.html`, `assets/`, `favicon.svg`: prebuilt static page.
- `source/index.html`: editable page text, layout, and method SVGs.
- `source/src/`: TypeScript rendering, interactions, replay transport, plots, and CSS.
- `data/`: manifests, compressed experiment bundles, and generated replay scripts.
- `paper-metrics.json`: manuscript Table III values.
- `scripts/`: build, local preview, and browser verification.
- `package.json`, `package-lock.json`, `tsconfig.json`: reproducible build setup.
- `THIRD_PARTY_NOTICES.md`: notices for dependencies included in the viewer.
- `ANONYMIZATION.md`: preparation scope for this review artifact.
- `submission-check.json`: preparation and verification summary.

Edit the HTML in `source/`, then rebuild. Root `index.html` is generated.
This folder can be copied on its own; it does not need the original viewer,
raw logs, reference video, or any neighboring project.

## Share through Anonymous GitHub

Upload the contents of this folder as the root of a dedicated GitHub repository.
Do not upload the surrounding workspace. The supplied ignore file excludes
installed packages, generated verification images, caches, editor files, and
local logs. Keep the prebuilt root page, `assets/`, and `data/` in the repository.

Open https://anonymous.4open.science/, connect the repository, and use its
anonymous repository link in the submission. Configure any additional owner
or organization terms in the service using complete names or word-boundary
patterns, then verify the generated view before
sharing it. The official usage and limitations are documented at
https://anonymous.4open.science/faq.

The repository can be downloaded for local preview or rebuilding. This artifact
is plain static HTML, CSS, JavaScript, SVG, and data; it needs no site generator.
The service does not anonymize binary files, so compressed data has already
been sanitized before inclusion. Every included file is below its documented
8 MB limit. No PDF is included. Hosting through the service requires configuring
that service separately; preparing this folder does not publish it.

## Data interpretation

Result cards compare VIO, VIO (Loop), Ours (causal), and Ours (opt) for stereo
and monocular Table III values. Replay geometry contains only stereo VIO,
causal, and optimized trajectories. Loop and monocular results are numerical
comparisons. Recorded-run metrics can differ from manuscript table values.

The viewer starts with Camera0 as the range origin and both accepted and rejected
ranges visible. Both use the same line width and opacity. The grid is gray.
The viewer supports play/pause, seeking, sequence buttons, layer controls,
camera presets, and synchronized plots. Range history offers 5 seconds and
Full. Antenna origins include measurement-time body-to-antenna segments;
Camera0 origins hide those connectors. Landmarks use world-z colors and the
grid lies at z=0. Display thresholds are reprojection RMSE <= 1.5 pixels and
at least 20 observations. Only display-ready experiment bundles are included.

## Optional browser verification

Start the preview, then run `npm run check`. Windows uses installed Microsoft
Edge. On other systems, first run `npx playwright install chromium`.
`PLAYWRIGHT_CHANNEL` selects a browser channel, and `PREVIEW_ORIGIN` selects
the preview origin. Reports and screenshots go to the ignored `qa/` folder.
The nested-path check uses http://127.0.0.1:4175/r/review/.

## Verify the anonymous website sandbox

Start the preview with `SANDBOX_PREVIEW=1` and `PREVIEW_PREFIX=/w/review/`.
Use those same environment variables when running `npm run check`. The server
then sends the service sandbox policy without allow-same-origin or CORS headers.
The browser check covers styling, all 13 sequences, desktop/mobile controls,
playback, failed bundle loading, and retry.

After pushing updates, refresh the anonymous mirror in its dashboard if it
still serves an older repository snapshot.
