'use strict';

// Bridge server that lets a phone browser control an LG webOS TV.
// Usage: node server.js [tv-ip]   (without an IP the TV is discovered on the network)

const http = require('http');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const dgram = require('dgram');
const { WebSocketServer } = require('ws');
const LGTV = require('lgtv2');
const lounge = require('./lounge');
const multicastDns = require('multicast-dns');

// When running as a Home Assistant add-on, options come from /data/options.json.
let options = {};
try {
    options = JSON.parse(fs.readFileSync('/data/options.json', 'utf8'));
} catch {}

let TV_HOST = process.argv[2] || process.env.TV_HOST || options.tv_host || '';
// Used to wake the TV over the network; if empty it is discovered automatically.
let TV_MAC = process.env.TV_MAC || options.tv_mac || '';
const PORT = Number(process.env.PORT || options.port) || 80;
const HOSTNAME = process.env.MDNS_NAME || options.hostname || 'kumanda.local';
const SEARCH_ENGINES = {
    yandex: { name: 'Yandex', url: 'https://yandex.com.tr/search/?text=' },
    google: { name: 'Google', url: 'https://www.google.com/search?q=' },
    duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=' },
    bing: { name: 'Bing', url: 'https://www.bing.com/search?q=' },
};
const SEARCH = SEARCH_ENGINES[process.env.SEARCH_ENGINE || options.search_engine] || SEARCH_ENGINES.yandex;

let tv = null;

let tvReady = false;
let pointer = null;
let volume = null; // { level, muted }
let apps = [];     // { id, title, kind: 'app' | 'input' } — icon URLs live in iconUrls
let channels = []; // { id, number, name, radio }
let currentChannel = null;
const epgCache = new Map(); // channelId -> { at, programs: [{ title, start, end }] }
const iconUrls = new Map();
const iconCache = new Map();

function broadcast(msg) {
    const data = JSON.stringify(msg);
    for (const c of wss.clients) if (c.readyState === 1) c.send(data);
}

function startTv() {
    tv = new LGTV({
        url: `wss://${TV_HOST}:3001`,
        keyFile: process.env.KEY_FILE || path.join(__dirname, 'tv-key'),
        reconnect: 3000,
    });
    tv.on('connecting', () => console.log(`Connecting to TV: ${TV_HOST}`));
    tv.on('prompt', () => {
        console.log('ACCEPT the connection request on the TV screen with your remote.');
        broadcast({ status: 'prompt' });
    });
    tv.on('connect', async () => {
        tvReady = true;
        console.log('TV connected.');
        broadcast({ status: 'connected' });
        tv.subscribe('ssap://audio/getVolume', (err, res) => {
            if (err || !res) return;
            const st = res.volumeStatus || res;
            volume = { level: st.volume, muted: st.muteStatus ?? st.muted };
            broadcast({ volume });
        });
        loadApps().catch((err) => console.log('Could not load app list:', err.message));
        loadChannels().catch((err) => console.log('Could not load channel list:', err.message));
        // Only answers while Live TV is in the foreground; errors otherwise are expected.
        tv.subscribe('ssap://tv/getCurrentChannel', (err, res) => {
            if (err || !res || !res.channelId) return;
            currentChannel = res.channelId;
            broadcast({ currentChannel });
        });
        try {
            pointer = await tv.getSocket('ssap://com.webos.service.networkinput/getPointerInputSocket');
        } catch (err) {
            console.log('Could not open input socket:', err.message);
        }
    });
    tv.on('close', () => {
        tvReady = false;
        pointer = null;
        broadcast({ status: 'disconnected' });
    });
    tv.on('error', (err) => console.log('TV error:', err.message));
}

// Find LG webOS TVs via SSDP: returns the IP and the MAC address used for wake-on-LAN.
// Some TVs don't always answer SSDP, so mDNS (their AirPlay advertisement) is tried as well.
function discoverSsdp(timeout = 3000) {
    return new Promise((resolve) => {
        const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
        const found = [];
        sock.on('message', (data, rinfo) => {
            const text = data.toString();
            if (!/webos/i.test(text) || found.some((t) => t.host === rinfo.address)) return;
            const mac = text.match(/WAKEUP:\s*MAC=([0-9a-f:]{17})/i);
            found.push({ host: rinfo.address, mac: mac && mac[1] });
        });
        sock.on('error', () => resolve(found));
        sock.bind(() => {
            for (const st of ['urn:dial-multiscreen-org:service:dial:1', 'urn:lge-com:service:webos-second-screen:1']) {
                const msg = `M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ${st}\r\n\r\n`;
                sock.send(msg, 1900, '239.255.255.250');
            }
        });
        setTimeout(() => { sock.close(); resolve(found); }, timeout);
    });
}

function discoverMdns(timeout = 3000) {
    return new Promise((resolve) => {
        const mdns = multicastDns();
        const records = [];
        mdns.on('response', (res) => records.push(...res.answers, ...res.additionals));
        mdns.on('error', () => {});
        mdns.query({ questions: [{ name: '_airplay._tcp.local', type: 'PTR' }] });
        const lgTargets = () => {
            const txtLg = new Set(records.filter((r) => r.type === 'TXT' &&
                [].concat(r.data).some((b) => /manufacturer=LG/i.test(b.toString()))).map((r) => r.name));
            return records.filter((r) => r.type === 'SRV' && (txtLg.has(r.name) || /webos/i.test(r.name)))
                .map((r) => r.data.target);
        };
        // If we got an SRV record but no A record, ask for it explicitly.
        setTimeout(() => {
            for (const t of lgTargets()) mdns.query({ questions: [{ name: t, type: 'A' }] });
        }, timeout / 2);
        setTimeout(() => {
            const targets = lgTargets();
            const hosts = [...new Set(records.filter((r) => r.type === 'A' && targets.includes(r.name)).map((r) => r.data))];
            mdns.destroy();
            resolve(hosts.map((host) => ({ host, mac: null })));
        }, timeout);
    });
}

// On the same network, the TV's MAC address is in the OS ARP table.
function macFromArp(host) {
    try {
        if (fs.existsSync('/proc/net/arp')) {
            const line = fs.readFileSync('/proc/net/arp', 'utf8').split('\n').find((l) => l.split(/\s+/)[0] === host);
            const mac = line && line.split(/\s+/)[3];
            return mac && mac !== '00:00:00:00:00:00' ? mac : null;
        }
        const out = require('child_process').execFileSync('arp', ['-n', host], { encoding: 'utf8' });
        const m = out.match(/ at ([0-9a-f:]+)/i);
        // macOS drops leading zeros (b → 0b).
        return m ? m[1].split(':').map((p) => p.padStart(2, '0')).join(':') : null;
    } catch {
        return null;
    }
}

async function discoverTv() {
    const ssdp = await discoverSsdp();
    if (ssdp.length) return ssdp;
    return discoverMdns();
}

async function resolveTv() {
    while (!TV_HOST || !TV_MAC) {
        const tvs = await discoverTv();
        const match = TV_HOST ? tvs.find((t) => t.host === TV_HOST) : tvs[0];
        if (match) {
            TV_HOST = TV_HOST || match.host;
            TV_MAC = TV_MAC || match.mac || '';
            if (tvs.length > 1 && !process.env.TV_HOST && !options.tv_host) {
                console.log('Found multiple TVs:', tvs.map((t) => t.host).join(', '), '- using the first one.');
            }
            break;
        }
        if (TV_HOST) break; // IP was given but not seen in discovery; try ARP for the MAC
        console.log('TV not found on the network, retrying in 10 s (is the TV on?)');
        await new Promise((r) => setTimeout(r, 10000));
    }
    if (!TV_MAC) {
        await fetch(`http://${TV_HOST}:3000`).catch(() => {}); // touch the TV once so it lands in the ARP table
        TV_MAC = macFromArp(TV_HOST) || '';
    }
    console.log(`TV: ${TV_HOST}${TV_MAC ? ` (MAC ${TV_MAC})` : ' (MAC unknown, power-on will not work)'}`);
}


async function loadChannels() {
    const res = await tv.request('ssap://tv/getChannelList');
    channels = (res.channelList || [])
        .filter((c) => !c.skipped && !c.Invisible)
        .map((c) => ({ id: c.channelId, number: c.channelNumber, name: c.channelName, radio: !!c.Radio }));
    broadcast({ channels });
}

// EPG times come as "YYYY,MM,DD,hh,mm,ss" in UTC.
function epgTime(t) {
    const [y, mo, d, h, mi, se] = String(t).split(',').map(Number);
    return Date.UTC(y, mo - 1, d, h, mi, se);
}

async function channelEpg(id) {
    const cached = epgCache.get(id);
    const now = Date.now();
    // Refetch when the cached "now" program has ended or after 30 minutes.
    if (cached && now - cached.at < 30 * 60 * 1000 && (!cached.programs[0] || cached.programs[0].end > now)) {
        return cached.programs;
    }
    const res = await tv.request('ssap://tv/getChannelProgramInfo', { channelId: id }).catch(() => ({}));
    const programs = (res.programList || [])
        .map((p) => ({ title: p.programName, start: epgTime(p.startTime), end: epgTime(p.endTime) }))
        .filter((p) => p.end > now)
        .sort((a, b) => a.start - b.start)
        .slice(0, 2);
    epgCache.set(id, { at: now, programs });
    return programs;
}

async function loadApps() {
    const list = [];
    iconUrls.clear();
    const lp = await tv.request('ssap://com.webos.applicationManager/listLaunchPoints');
    for (const a of lp.launchPoints || []) {
        list.push({ id: a.id, title: a.title, kind: 'app' });
        if (a.icon) iconUrls.set(`app:${a.id}`, a.icon);
    }
    const inputs = await tv.request('ssap://tv/getExternalInputList').catch(() => ({}));
    for (const d of inputs.devices || []) {
        list.push({ id: d.id, title: d.label || d.id, kind: 'input', connected: d.connected });
        if (d.icon) iconUrls.set(`input:${d.id}`, d.icon);
    }
    apps = list;
    broadcast({ apps });
}

// TV icons are served over self-signed HTTPS, which phones reject, so we proxy them.
function fetchIcon(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { rejectUnauthorized: false }, (res) => {
            if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => resolve({ type: res.headers['content-type'] || 'image/png', body: Buffer.concat(chunks) }));
        }).on('error', reject);
    });
}

function youtubeId(q) {
    const m = q.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/);
    return m && m[1];
}

async function playYoutube(id) {
    try {
        await lounge.play(TV_HOST, id);
        console.log('Play:', id);
    } catch (err) {
        console.log('Could not play:', err.message);
    }
}

function req(uri, payload) {
    return tv.request(uri, payload).catch((err) => console.log(uri, err.message));
}

async function getPointer() {
    if (!pointer) {
        pointer = await tv.getSocket('ssap://com.webos.service.networkinput/getPointerInputSocket');
    }
    return pointer;
}

function wakeOnLan() {
    if (!TV_MAC || !TV_HOST) return console.log('TV MAC address unknown, cannot power on.');
    const mac = Buffer.from(TV_MAC.replace(/[:-]/g, ''), 'hex');
    const packet = Buffer.concat([Buffer.alloc(6, 0xff), ...Array(16).fill(mac)]);
    const sock = dgram.createSocket('udp4');
    sock.bind(() => {
        sock.setBroadcast(true);
        const subnet = TV_HOST.replace(/\.\d+$/, '.255');
        // Send to broadcast addresses and directly to the TV, on ports 9 and 7.
        const targets = ['255.255.255.255', subnet, TV_HOST].flatMap((a) => [[a, 9], [a, 7]]);
        let pending = targets.length;
        for (const [addr, port] of targets) {
            sock.send(packet, port, addr, () => { if (--pending === 0) sock.close(); });
        }
    });
}

async function togglePower() {
    // Turn off if the screen is on; otherwise (no connection or standby) wake with WoL.
    if (tvReady && tv) {
        const state = await tv.request('ssap://com.webos.service.tvpower/power/getPowerState').catch(() => null);
        if (!state || state.state === 'Active') {
            console.log('Turning TV off');
            await req('ssap://system/turnOff');
            return;
        }
    }
    console.log('Turning TV on (Wake-on-LAN)');
    wakeOnLan();
}

// Commands from the phone are processed in order so typed characters don't get shuffled.
let queue = Promise.resolve();
function handle(msg) {
    queue = queue.then(async () => {
        if (msg.type === 'power') return togglePower();
        if (!tvReady) return;
        switch (msg.type) {
            case 'edit':
                if (msg.del > 0) await req('ssap://com.webos.service.ime/deleteCharacters', { count: msg.del });
                if (msg.ins) await req('ssap://com.webos.service.ime/insertText', { text: msg.ins, replace: 0 });
                break;
            case 'play':
                // YouTube draws its own on-screen keyboard, so search runs on the server and only the video goes to the TV.
                // Uses the phone app's "Play on TV" path (Lounge API); webOS launch ignores the video while YouTube is open.
                await playYoutube(msg.id);
                break;
            case 'open': {
                // Open it directly if it looks like an address, otherwise search with the configured engine.
                const q = msg.q.trim();
                const yt = youtubeId(q);
                if (yt) {
                    await playYoutube(yt); // open YouTube links in the YouTube app instead of the browser
                    break;
                }
                const url = /^https?:\/\//i.test(q) ? q
                    : /^[^\s]+\.[^\s]{2,}$/.test(q) ? `https://${q}`
                    : SEARCH.url + encodeURIComponent(q);
                console.log('Open in browser:', url);
                await req('ssap://system.launcher/open', { target: url });
                break;
            }
            case 'enter':
                await req('ssap://com.webos.service.ime/sendEnterKey');
                break;
            case 'launch':
                await req('ssap://system.launcher/launch', { id: msg.id });
                break;
            case 'channel':
                await req('ssap://tv/openChannel', { channelId: msg.id });
                break;
            case 'input':
                await req('ssap://tv/switchInput', { inputId: msg.id });
                break;
            case 'pointer':
                try {
                    const p = await getPointer();
                    if (msg.kind === 'move') p.send('move', { dx: msg.dx, dy: msg.dy, down: 0 });
                    else if (msg.kind === 'scroll') p.send('scroll', { dx: msg.dx, dy: msg.dy });
                    else if (msg.kind === 'click') p.send('click');
                } catch (err) {
                    pointer = null;
                }
                break;
            case 'button':
                try {
                    (await getPointer()).send('button', { name: msg.name });
                } catch (err) {
                    pointer = null;
                    console.log('Could not send key:', err.message);
                }
                break;
        }
    });
}

const page = fs.readFileSync(path.join(__dirname, 'index.html'));
async function youtubeSearch(q, hl = 'en') {
    const r = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&hl=${encodeURIComponent(hl)}`, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
            'Accept-Language': hl,
            Cookie: 'SOCS=CAI',
        },
    });
    const m = (await r.text()).match(/var ytInitialData = (\{.*?\});<\/script>/s);
    const out = [];
    (function walk(o) {
        if (!o || typeof o !== 'object') return;
        if (o.videoRenderer) {
            const v = o.videoRenderer;
            out.push({
                id: v.videoId,
                title: v.title?.runs?.[0]?.text,
                channel: v.ownerText?.runs?.[0]?.text,
                duration: v.lengthText?.simpleText || null, // null = live stream
                thumb: `https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`,
            });
            return;
        }
        for (const k in o) walk(o[k]);
    })(m && JSON.parse(m[1]));
    return out;
}

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/notify' && req.method === 'POST') {
        // Shows a message on the TV, e.g. from a Home Assistant rest_command.
        // Body: {"message": "...", "title": "...", "seconds": 10} or plain text.
        // A centered alert is used because webOS 24 silently drops toasts in full-screen apps.
        let body = '';
        for await (const chunk of req) body += chunk;
        let opts = { message: body };
        try { opts = { ...opts, ...JSON.parse(body) }; } catch {}
        const message = String(opts.message ?? '').trim().slice(0, 300);
        const seconds = Math.min(Math.max(Number(opts.seconds) || 10, 3), 120);
        if (!message || !tvReady) {
            res.writeHead(!message ? 400 : 503);
            res.end();
            return;
        }
        const result = await tv.request('ssap://system.notifications/createAlert', {
            title: String(opts.title || '').slice(0, 80),
            message,
            buttons: [{ label: 'OK', focus: true, buttonType: 'ok' }],
        }).catch((err) => ({ error: err.message }));
        if (result.alertId) {
            setTimeout(() => tv.request('ssap://system.notifications/closeAlert', { alertId: result.alertId }).catch(() => {}), seconds * 1000);
        }
        console.log('Notify:', message);
        res.writeHead(result.error ? 502 : 200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
        return;
    }
    if (url.pathname === '/epg') {
        // Current and next program for the requested channels (the ones visible on the phone).
        const ids = (url.searchParams.get('ids') || '').split(',').filter(Boolean).slice(0, 40);
        const out = {};
        for (const id of ids) {
            if (!tvReady) break;
            out[id] = await channelEpg(id);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(out));
        return;
    }
    if (url.pathname === '/icon') {
        const key = url.searchParams.get('k');
        try {
            if (!iconCache.has(key)) {
                if (!iconUrls.has(key)) throw new Error('not found');
                iconCache.set(key, await fetchIcon(iconUrls.get(key)));
            }
            const icon = iconCache.get(key);
            res.writeHead(200, { 'Content-Type': icon.type, 'Cache-Control': 'max-age=86400' });
            res.end(icon.body);
        } catch {
            res.writeHead(404);
            res.end();
        }
        return;
    }
    if (url.pathname === '/yt') {
        try {
            const results = await youtubeSearch(url.searchParams.get('q') || '', url.searchParams.get('hl') || 'en');
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(results));
        } catch (err) {
            res.writeHead(500);
            res.end(err.message);
        }
        return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(page);
});

const wss = new WebSocketServer({ server });
wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ status: tvReady ? 'connected' : 'disconnected', volume, apps, channels, currentChannel, searchEngine: SEARCH.name }));
    ws.on('message', (data) => {
        try {
            handle(JSON.parse(data));
        } catch {}
    });
});

server.listen(PORT, () => {
    // Pick the LAN address rather than Docker bridges (172.x).
    const ips = Object.values(os.networkInterfaces()).flat()
        .filter((i) => i.family === 'IPv4' && !i.internal && !i.address.startsWith('172.'))
        .map((i) => i.address);
    const ip = process.env.HOST_IP || ips[0];
    const suffix = PORT === 80 ? '' : `:${PORT}`;
    console.log('Open this address on your phone:');
    console.log(`  http://${HOSTNAME}${suffix}`);
    if (ip) console.log(`  http://${ip}${suffix}`);

    // Announce the hostname via mDNS; works on both macOS and Linux.
    if (ip) {
        const mdns = multicastDns();
        const a = { name: HOSTNAME, type: 'A', ttl: 120, flush: true, data: ip };
        // Tells resolvers there is no IPv6 address, so AAAA lookups don't stall for seconds (RFC 6762 §6.1).
        const nsec = { name: HOSTNAME, type: 'NSEC', ttl: 120, flush: true, data: { nextDomain: HOSTNAME, rrtypes: ['A'] } };
        mdns.on('query', (query) => {
            const types = query.questions.filter((q) => q.name.toLowerCase() === HOSTNAME).map((q) => q.type);
            if (types.includes('A') || types.includes('ANY')) mdns.respond({ answers: [a], additionals: [nsec] });
            else if (types.includes('AAAA')) mdns.respond({ answers: [nsec], additionals: [a] });
        });
        mdns.on('error', (err) => console.log('mDNS error:', err.message));
    }
});

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));

resolveTv().then(startTv);
