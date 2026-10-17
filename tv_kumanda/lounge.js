'use strict';

// YouTube Lounge API: telefondaki YouTube uygulamasının "TV'de oynat" için kullandığı yol.
// TV'nin screenId'si DIAL üzerinden alınır, ondan lounge token, ondan da oturum açılır.

const crypto = require('crypto');

const BIND = 'https://www.youtube.com/api/lounge/bc/bind';
const deviceId = crypto.randomUUID();

let session = null; // { token, sid, gsessionid, rid, aid }

async function getScreenId(tvHost) {
    const r = await fetch(`http://${tvHost}:36866/apps/YouTube`, {
        headers: { Origin: 'package:com.google.android.youtube' },
    });
    const m = (await r.text()).match(/<screenId>([^<]+)<\/screenId>/);
    if (!m) throw new Error('TV screenId vermedi (YouTube açık mı?)');
    return m[1];
}

async function getLoungeToken(screenId) {
    const r = await fetch('https://www.youtube.com/api/lounge/pairing/get_lounge_token_batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ screen_ids: screenId }),
    });
    const j = await r.json();
    return j.screens[0].loungeToken;
}

function bindParams(extra) {
    return new URLSearchParams({
        device: 'REMOTE_CONTROL',
        id: deviceId,
        name: 'TV Klavye',
        app: 'youtube-desktop',
        mdx_version: '3',
        loungeIdToken: session.token,
        VER: '8',
        v: '2',
        CVER: '1',
        RID: String(session.rid++),
        ...extra,
    });
}

async function connect(tvHost) {
    const token = await getLoungeToken(await getScreenId(tvHost));
    session = { token, rid: 1, aid: 0 };
    const r = await fetch(`${BIND}?${bindParams({ zx: crypto.randomBytes(6).toString('hex') })}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'count=0',
    });
    const text = await r.text();
    const sid = text.match(/\["c","([^"]+)"/);
    const gs = text.match(/\["S","([^"]+)"/);
    if (!sid || !gs) throw new Error('Lounge oturumu açılamadı: ' + text.slice(0, 200));
    session.sid = sid[1];
    session.gsessionid = gs[1];
}

async function command(tvHost, sc, args) {
    for (let attempt = 0; attempt < 2; attempt++) {
        if (!session || !session.sid) await connect(tvHost);
        const body = new URLSearchParams({ count: '1', ofs: String(session.aid++), req0__sc: sc });
        for (const [k, v] of Object.entries(args)) body.set(`req0_${k}`, v);
        const r = await fetch(`${BIND}?${bindParams({ SID: session.sid, gsessionid: session.gsessionid, AID: '5' })}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body,
        });
        if (r.ok) return;
        session = null; // oturum düşmüş, bir kez yeniden bağlan
    }
    throw new Error('YouTube komutu gönderilemedi');
}

function play(tvHost, videoId) {
    return command(tvHost, 'setPlaylist', {
        videoId,
        videoIds: videoId,
        currentTime: '0',
        currentIndex: '0',
    });
}

module.exports = { play };
