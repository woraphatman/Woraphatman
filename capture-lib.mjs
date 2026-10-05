// Shared plumbing for capture.mjs (stills) and capture-anim.mjs (animation):
// a static file server, browser discovery and launch (hardware or software GL), and a helper that renders one frame.
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

export const ROOT = dirname(fileURLToPath(import.meta.url));

export function parseArgs(argv) {
  return Object.fromEntries(
    argv.map((a) => {
      const [k, ...rest] = a.replace(/^--/, '').split('=');
      return [k, rest.length ? rest.join('=') : true];
    }),
  );
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.css': 'text/css; charset=utf-8',
};

const BROWSERS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

export function findBrowser() {
  const hit = process.env.CHROME_PATH ?? BROWSERS.find((p) => existsSync(p));
  if (!hit) throw new Error('No Chrome/Edge found. Set CHROME_PATH.');
  return hit;
}

/** Serve the project folder on a free local port. */
export function startServer() {
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let rel = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
    if (rel === '') rel = 'index.html';
    const file = join(ROOT, rel);
    if (!file.startsWith(ROOT) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(readFileSync(file));
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ server, port: server.address().port })));
}

/** Serve the CDN copy of three from node_modules when the version matches, so captures are offline and repeatable. */
async function interceptThree(page) {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'node_modules/three/package.json'), 'utf8'));
  const re = /^https:\/\/cdn\.jsdelivr\.net\/npm\/three@([\d.]+)\/(.*)$/;
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const m = re.exec(req.url());
    if (!m || m[1] !== pkg.version) return req.continue();
    const file = join(ROOT, 'node_modules/three', m[2].split('?')[0]);
    if (!existsSync(file)) return req.continue();
    return req.respond({ status: 200, contentType: MIME[extname(file)] ?? 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: readFileSync(file) });
  });
}

const COMMON_FLAGS = [
  '--hide-scrollbars',
  '--force-color-profile=srgb',
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
  '--ignore-gpu-blocklist',
];

/**
 * Chrome flags per GL backend. `swiftshader` is the CPU rasteriser a GPU-less CI runner falls back to.
 * `mesa` (llvmpipe through desktop GL, needs a display such as xvfb) and `lavapipe` (llvmpipe through Vulkan) are the other CPU
 * rasterisers a Linux runner can offer; they are only worth using if they beat SwiftShader there.
 */
export function glFlags(gl) {
  if (gl === 'swiftshader') return ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
  if (gl === 'mesa') return ['--use-gl=angle', '--use-angle=gl'];
  if (gl === 'lavapipe') return ['--use-angle=vulkan', '--use-vulkan=native', '--enable-features=Vulkan,DefaultANGLEVulkan,VulkanFromANGLE', '--disable-vulkan-surface'];
  const hardware = process.platform === 'win32' ? ['--use-angle=d3d11'] : [];
  return ['--enable-gpu-rasterization', ...hardware, '--enable-unsafe-swiftshader'];
}

export const GL_BACKENDS = ['gpu', 'swiftshader', 'mesa', 'lavapipe'];

export async function launchBrowser({ gl = 'gpu' } = {}) {
  const executablePath = findBrowser();
  const sandbox = process.env.CI ? ['--no-sandbox'] : [];
  const extra = (process.env.CHROME_FLAGS ?? '').split(/\s+/).filter(Boolean); // e.g. CHROME_FLAGS="--use-angle=gl-egl" to try another software GL
  const browser = await puppeteer.launch({
    executablePath,
    headless: gl !== 'mesa', // desktop GL needs a window system: run headful on a virtual display
    protocolTimeout: 4 * 60 * 60 * 1000, // a software-GL frame can take minutes
    args: [...COMMON_FLAGS, ...glFlags(gl), ...sandbox, ...extra],
  });
  return { browser, executablePath };
}

const sessions = new WeakMap();

/** CPU seconds used so far by every browser process (browser, GPU and renderer): software GL cost that wall time hides on a shared machine. */
export async function cpuSeconds(browser) {
  if (!sessions.has(browser)) sessions.set(browser, await browser.target().createCDPSession());
  const { processInfo } = await sessions.get(browser).send('SystemInfo.getProcessInfo');
  return processInfo.reduce((sum, p) => sum + p.cpuTime, 0);
}

/** Which frames of a loop need rendering: the first frame of every distinct pose key, and for every frame the one it copies. */
export function planFrames(poseKeys, dedupe = true) {
  const firstOf = new Map();
  const source = poseKeys.map((key, i) => {
    if (!dedupe) return i;
    if (!firstOf.has(key)) firstOf.set(key, i);
    return firstOf.get(key);
  });
  return { source, unique: [...new Set(source)] };
}

/**
 * Open index.html in still mode and wait for the first frame.
 * @returns {{page, stats, renderer: string, loadMs: number, timeline: object}}
 */
export async function openStill(browser, port, { query, size, scale, samples, cdn = false, label = '' }) {
  const page = await browser.newPage();
  page.on('console', (m) => {
    if (['error', 'warning'].includes(m.type())) log(`  [page ${m.type()}] ${m.text().slice(0, 300)}`);
  });
  page.on('pageerror', (e) => log(`  [pageerror] ${String(e).slice(0, 400)}`));
  if (!cdn) await interceptThree(page);
  await page.setViewport({ ...size, deviceScaleFactor: scale });
  if (process.env.TZ) await page.emulateTimezone(process.env.TZ); // the OLED clock shows the viewer's local time; pin it to the owner's zone
  const t0 = Date.now();
  const sampling = samples === undefined ? '' : `&samples=${samples}`;
  await page.goto(`http://127.0.0.1:${port}/index.html?still=1${sampling}&${query}`, { waitUntil: 'load' });
  await page.waitForFunction('window.__ready === true || typeof window.__error === "string"', { timeout: 4 * 60 * 60 * 1000, polling: 500 });
  const err = await page.evaluate('window.__error');
  if (err) throw new Error(`page error${label ? ` (${label})` : ''}:\n${err}`);
  const stats = await page.evaluate('window.__stats');
  const timeline = await page.evaluate('window.__timeline');
  const renderer = await page.evaluate(() => {
    const gl = window.__scene.renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
  });
  return { page, stats, renderer, loadMs: Date.now() - t0, timeline };
}

export const seconds = (ms) => (ms / 1000).toFixed(1);

/** CLI output: stdout line (these scripts report to the terminal on purpose). */
export const log = (msg = '') => process.stdout.write(`${msg}\n`);
