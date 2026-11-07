// ==UserScript==
// @name         크랙 TTS
// @namespace    crack-tts
// @version      0.2.0
// @description  크랙 답변을 Gemini 3.8 TTS로 읽습니다. 나레이션과 등장인물 음성을 나누고 목소리를 직접 꾸밀 수 있습니다.
// @license      GPL-3.0
// @homepageURL  https://github.com/OrangeIsOrang/crack-tts
// @supportURL   https://github.com/OrangeIsOrang/crack-tts/issues
// @updateURL    https://raw.githubusercontent.com/OrangeIsOrang/crack-tts/main/crack-tts.user.js
// @downloadURL  https://raw.githubusercontent.com/OrangeIsOrang/crack-tts/main/crack-tts.user.js
// @match        https://crack.wrtn.ai/*
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      generativelanguage.googleapis.com
// ==/UserScript==
// 대사 나누기·요청 묶기·「내 목소리」 방식은 이매진(github.com/daelar99-rgb/imagine, GPL-3.0)을 옮겨 줄였다.

(function () {
    'use strict';

    const API_URL = 'https://generativelanguage.googleapis.com/v1beta';
    const LABEL_MODEL = 'gemini-3.8-flash';
    const MODELS = [['gemini-3.8-flash-tts', '3.8 Flash · 품질 우선'], ['gemini-3.8-flash-lite-tts', '3.8 Flash Lite · 저렴하고 빠름']];
    const RATE = 24000;
    const GAP = 0.25;
    const MAX_BYTES = 1500; // 요청을 짧게 끊어 첫 소리가 빨리 나오게 한다. API 상한은 필드당 4,000바이트.
    const WAITS = [5000, 15000, 30000];
    const NARR = '__narrator';
    const FALLBACK = '등장인물';
    const NARR_STYLE = '라디오 아나운서처럼 또렷하고 안정된 목소리로, 알맞은 속도로 읽어 주세요.';
    const TALK_STYLE = '장면의 감정에 맞게, 연기하듯 자연스럽게 말해 주세요.';
    const SAMPLE_NARR = '창밖으로 비가 내리고 있었다. 당신은 천천히 고개를 들었다.';
    const SAMPLE_TALK = '안녕하세요. 이 목소리로 읽어 드릴게요.';
    const STYLE_CHIPS = ['낮고 차분하게', '밝고 빠르게', '속삭이듯 작게', '나른하고 느리게', '단호하고 또렷하게', '부끄러운 듯 조심스럽게', '비꼬듯 건조하게'];
    const VOICES = {
        female: {
            Achernar: '부드럽고 여린 고음 · 수줍은 소녀', Aoede: '산뜻한 중음 · 밝고 편한 여성', Autonoe: '또렷하고 활기찬 중음 · 자신감 있는 여성',
            Callirrhoe: '느긋하고 차분한 중음 · 친근한 여성', Despina: '매끄럽고 우아한 중음 · 기품 있는 여성', Erinome: '맑고 또렷한 중음 · 지적인 여성',
            Gacrux: '성숙하고 안정된 중음 · 연상·어머니', Kore: '단단하고 힘 있는 중음 · 강단 있는 여성', Laomedeia: '발랄하고 경쾌한 고음 · 명랑한 소녀',
            Leda: '앳되고 가벼운 고음 · 10대 소녀', Pulcherrima: '직선적이고 중성적인 중음 · 보이시한 인물', Sulafat: '따뜻하고 포근한 중음 · 다정한 여성',
            Vindemiatrix: '온화하고 잔잔한 중음 · 조용한 여성', Zephyr: '밝고 힘찬 고음 · 쾌활한 여성',
        },
        male: {
            Achird: '친근하고 따뜻한 중저음 · 다정한 청년', Algenib: '거칠고 낮은 저음 · 노련한 남성', Algieba: '매끄럽고 여유로운 저음 · 매력적인 남성',
            Alnilam: '단단하고 권위 있는 중저음 · 지휘관', Charon: '차분한 저음 · 해설자·학자·집사', Enceladus: '숨 섞인 부드러운 저음 · 신비로운 남성',
            Fenrir: '들뜨고 빠른 중저음 · 열혈 청년', Iapetus: '맑고 깨끗한 중저음 · 믿음직한 남성', Orus: '단호한 중저음 · 군인·보호자',
            Puck: '경쾌하고 장난기 있는 중음 · 장난꾸러기 소년', Rasalgethi: '또박또박한 중음 · 교사·안내자', Sadachbia: '활기찬 저음 · 호탕한 남성',
            Sadaltager: '지적이고 확신 있는 중음 · 전문가·참모', Schedar: '고르고 차분한 중저음 · 침착한 남성', Umbriel: '느긋하고 편안한 중저음 · 온화한 남성',
            Zubenelgenubi: '수수하고 자연스러운 중저음 · 평범한 청년',
        },
    };
    const LABEL_SYSTEM = `You label who speaks each numbered quote in a Korean roleplay reply, for a text-to-speech reader.
Each quote in TEXT is preceded by a tag like [Q3]. Reply with JSON only:
{"quotes":[{"n":1,"speaker":"Name","gender":"female"}]}
- One entry per quote number, every number included.
- speaker is the character who says or thinks the quote, written as the story names them. Use the same name every time for the same person. If the person is in KNOWN SPEAKERS, copy that name exactly.
- If a quote is not spoken by anyone (a quoted word, a title, a sign, a sound effect, emphasis), use "narrator".
- gender is "female", "male" or "unknown".`;

    const QUOTE_RE = /“[^”]{1,2000}”|"[^"\n]{1,2000}"|「[^」]{1,2000}」|『[^』]{1,2000}』|‘[^’]{1,1000}’/g;
    const SENTENCE_END = /[.!?…。！？~♡♥]["”」』’)\]]*$/;
    const enc = new TextEncoder();
    const bytesOf = s => enc.encode(s).length;
    const spoken = s => /[\p{L}\p{N}]/u.test(s);

    // HUD·상태 줄. 작품마다 다른 줄은 설정의 「읽지 않을 줄」로 거른다.
    function isHud(line) {
        if (!/[가-힣]/.test(line)) return true;
        if (/^[\p{Extended_Pictographic}@#]/u.test(line)) return true;
        if (/^[[(]/.test(line) && !SENTENCE_END.test(line)) return true;
        if (line.length < 60 && /[|｜]/.test(line)) return true;
        return line.length < 40 && /^\S{1,8}\s*[:：]/.test(line) && !SENTENCE_END.test(line);
    }

    // 줄 → [{q:0, text} 나레이션 | {q:n, text, speaker?} 대사]
    function parseLines(lines, skip) {
        const parts = [];
        let n = 0;
        const narr = text => { text = text.trim(); if (spoken(text)) parts.push({ q: 0, text }); };
        for (const raw of lines) {
            const line = raw.trim();
            const vn = /^([가-힣A-Za-z]{1,10})[\p{Extended_Pictographic}️]*\s*[|｜]\s*([^|｜]+)$/u.exec(line);
            if (vn && spoken(vn[2])) { parts.push({ q: ++n, text: vn[2].trim(), speaker: vn[1] }); continue; }
            if (!line || isHud(line) || skip?.test(line)) continue;
            let last = 0;
            for (const m of line.matchAll(QUOTE_RE)) {
                narr(line.slice(last, m.index));
                if (spoken(m[0])) parts.push({ q: ++n, text: m[0] });
                else narr(m[0]);
                last = m.index + m[0].length;
            }
            narr(line.slice(last));
        }
        return parts;
    }

    function parseLabels(json) {
        const out = new Map();
        for (const x of json?.quotes ?? []) {
            const name = String(x?.speaker ?? '').replace(/["“”「」『』]/g, '').trim().slice(0, 40);
            if (!Number.isInteger(x?.n) || !name) continue;
            out.set(x.n, {
                speaker: /^(narrator|나레이션|내레이션)$/i.test(name) ? NARR : name,
                gender: /^(fe)?male$/i.test(x.gender) ? x.gender.toLowerCase() : 'unknown',
            });
        }
        return out;
    }

    function splitLong(text, limit) {
        if (bytesOf(text) <= limit) return [text];
        const out = [];
        let cur = '';
        for (const sent of text.split(/(?<=[.!?。！？…\n])\s*/)) {
            if (bytesOf(cur + ' ' + sent) <= limit) { cur += (cur ? ' ' : '') + sent; continue; }
            if (cur) out.push(cur);
            cur = sent;
            while (bytesOf(cur) > limit) {
                const n = Math.floor(limit / 3); // 한글 3바이트
                out.push(cur.slice(0, n));
                cur = cur.slice(n);
            }
        }
        if (cur) out.push(cur);
        return out;
    }

    function turnsOf(parts, labels, limit = MAX_BYTES) {
        const turns = [];
        for (const p of parts) {
            const who = !p.q ? NARR : p.speaker ?? labels.get(p.q)?.speaker ?? FALLBACK;
            const last = turns[turns.length - 1];
            if (last?.speaker === who) last.text += ' ' + p.text;
            else turns.push({ speaker: who, text: p.text });
        }
        return turns.flatMap(t => splitLong(t.text, limit).map(text => ({ speaker: t.speaker, text })));
    }

    function assignVoice(cast, name, gender, narrator) {
        if (cast[name]) return cast[name].voice;
        const used = new Set([narrator, ...Object.values(cast).map(c => c.voice)]);
        const pool = Object.keys(gender === 'male' ? VOICES.male : gender === 'female' ? VOICES.female : { ...VOICES.female, ...VOICES.male });
        const voice = pool.find(v => !used.has(v)) ?? pool[Object.keys(cast).length % pool.length];
        cast[name] = { voice, gender };
        return voice;
    }

    // 내 목소리 = 바탕 목소리 + 말투 지시문. 지워진 내 목소리는 기본 목소리로 읽는다.
    function resolveVoice(id, styles, mine) {
        const my = mine.find(m => m.id === id);
        return { voice: my?.base ?? (/^my_/.test(id) ? 'Aoede' : id), style: [...styles, my?.style].map(s => s?.trim()).filter(Boolean).join(' ') };
    }

    // 구글 제한: 요청 한 건에 목소리 2개
    function batch(turns, speak, limit = MAX_BYTES) {
        const reqs = [];
        let cur = null;
        for (const t of turns) {
            const { voice, style } = speak(t.speaker), size = bytesOf(t.text);
            const fits = cur && (cur.voices.includes(voice) || cur.voices.length < 2) && cur.bytes + size <= limit;
            if (!fits) reqs.push(cur = { voices: [], turns: [], bytes: 0 });
            if (!cur.voices.includes(voice)) cur.voices.push(voice);
            cur.turns.push({ voice, text: t.text, style });
            cur.bytes += size;
        }
        return reqs;
    }

    function ttsBody(r, model) {
        const multi = r.voices.length > 1;
        const alias = new Map(r.voices.map((v, i) => [v, 'Speaker' + (i + 1)]));
        const content = r.turns.map(t => ({ type: 'text', text: t.text, annotations: [{ type: 'speech_metadata', ...(multi ? { speaker: alias.get(t.voice) } : {}), style: t.style }] }));
        return {
            model,
            store: false, // 기본값은 구글 서버에 대화를 1~55일 보관한다.
            input: [{ type: 'user_input', content }],
            response_format: { type: 'audio' },
            generation_config: { speech_config: multi ? { speakers: r.voices.map(v => ({ speaker: alias.get(v), voice: v })) } : [{ voice: r.voices[0] }] },
        };
    }

    const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

    // WAV 머리가 붙어 와도, 맨 PCM으로 와도 읽는다.
    function pcmOf(bytes, mime) {
        const tag = (p) => String.fromCharCode(...bytes.subarray(p, p + 4));
        const rate = Number(/rate=(\d+)/.exec(mime ?? '')?.[1]) || RATE;
        if (bytes.length < 12 || tag(0) !== 'RIFF') return { pcm: bytes, rate };
        const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        for (let p = 12; p + 8 <= bytes.length;) {
            const size = dv.getUint32(p + 4, true);
            if (tag(p) === 'data') return { pcm: bytes.subarray(p + 8, p + 8 + size), rate: dv.getUint32(24, true) || rate };
            p += 8 + size + (size & 1);
        }
        return { pcm: bytes.subarray(44), rate };
    }

    function audioOf(j) {
        const audio = (j?.steps ?? []).filter(x => x.type === 'model_output').flatMap(x => x.content ?? []).filter(c => c.type === 'audio' && c.data).pop();
        if (audio) return [pcmOf(unb64(audio.data), audio.mime_type)];
        throw new Error('소리가 오지 않았습니다: ' + JSON.stringify(j).slice(0, 200));
    }

    function parseReply(text) {
        let json = null;
        try { json = JSON.parse(text); } catch {}
        return Array.isArray(json) ? json[0] : json; // /interactions는 오류를 배열로 감싸 보낸다.
    }

    if (typeof document === 'undefined') {
        module.exports = { parseLines, parseLabels, isHud, turnsOf, splitLong, assignVoice, resolveVoice, batch, ttsBody, pcmOf, audioOf, parseReply, NARR, FALLBACK, MAX_BYTES, VOICES };
        return;
    }

    // ── 여기부터 브라우저 ──

    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const settings = () => ({ model: MODELS[0][0], narrator: 'Aoede', narrStyle: NARR_STYLE, skip: '', ...GM_getValue('set', {}) });
    const saveSettings = patch => GM_setValue('set', { ...settings(), ...patch });
    const storyKey = () => 'cast:' + (/\/(?:stories|characters)\/([a-f0-9]+)/.exec(location.pathname)?.[1] ?? 'etc');
    const loadCast = () => GM_getValue(storyKey(), {});
    const saveCast = cast => GM_setValue(storyKey(), cast);
    const loadMine = () => GM_getValue('myVoices', []);
    const saveMine = mine => GM_setValue('myVoices', mine);
    const narrVoice = (set = settings()) => resolveVoice(set.narrator, [set.narrStyle], loadMine());
    const castVoice = (c, mine = loadMine()) => resolveVoice(c.voice, [TALK_STYLE, c.style], mine);

    function skipRe() {
        const src = settings().skip.trim();
        if (!src) return null;
        try { return new RegExp(src); } catch { toast('「읽지 않을 줄」 정규식이 잘못됐습니다', true); return null; }
    }

    // 키가 페이지 스크립트 쪽 fetch 감시를 지나지 않게 GM 요청만 쓴다.
    const send = (path, body, key) => new Promise((ok, fail) => GM_xmlhttpRequest({
        method: body ? 'POST' : 'GET', url: API_URL + path, timeout: 180000,
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        data: body ? JSON.stringify(body) : undefined,
        onload: r => {
            const json = parseReply(r.responseText);
            if (r.status === 200) return ok(json);
            fail(Object.assign(new Error(`구글 오류 ${r.status}: ${String(json?.error?.message ?? r.responseText).slice(0, 200)}`), { status: r.status }));
        },
        onerror: () => fail(new Error('구글에 연결하지 못했습니다')),
        ontimeout: () => fail(new Error('구글 응답이 3분 안에 오지 않았습니다')),
    }));

    async function api(path, body) {
        const key = GM_getValue('apiKey', '');
        if (!key) { openPanel('set'); throw Object.assign(new Error('Gemini API 키를 먼저 넣어 주세요'), { status: 401 }); }
        for (let i = 0; ; i++) {
            try { return await send(path, body, key); }
            catch (error) {
                if (!(error.status === 429 || error.status >= 500) || i >= WAITS.length) throw error;
                await sleep(WAITS[i]);
            }
        }
    }

    // 모델 조회(무료)로 키를 보고, 짧은 합성 1건으로 실제 소리까지 확인한다.
    async function checkKey(value, say) {
        const model = settings().model;
        if (!value) return say('API 키를 넣어 주세요.', true);
        say('키 확인 중…');
        try { await send(`/models/${model}`, null, value); }
        catch (error) { return say('키를 저장하지 않았습니다. ' + error.message, true); }
        GM_setValue('apiKey', value);
        say('키는 맞습니다. 음성 합성 시험 중…');
        try {
            const { voice, style } = narrVoice();
            audioOf(await send('/interactions', ttsBody({ voices: [voice], turns: [{ voice, text: '네.', style }] }, model), value));
            say('정상입니다. 소리까지 받았습니다.');
        } catch (error) {
            say('키는 저장했지만 음성 합성이 실패했습니다. ' + error.message, true);
        }
    }

    async function askLabels(parts, cast) {
        const text = parts.map(p => (p.q ? `[Q${p.q}]` : '') + p.text).join('\n');
        const known = Object.entries(cast).map(([n, c]) => `${n} (${c.gender})`).join(', ') || '(none)';
        const j = await api(`/models/${LABEL_MODEL}:generateContent`, {
            systemInstruction: { parts: [{ text: LABEL_SYSTEM }] },
            contents: [{ role: 'user', parts: [{ text: `KNOWN SPEAKERS: ${known}\n\nTEXT:\n${text}` }] }],
            generationConfig: { temperature: 0, responseMimeType: 'application/json' },
            safetySettings: ['HATE_SPEECH', 'DANGEROUS_CONTENT', 'SEXUALLY_EXPLICIT', 'HARASSMENT'].map(c => ({ category: 'HARM_CATEGORY_' + c, threshold: 'OFF' })),
        });
        const out = (j?.candidates?.[0]?.content?.parts ?? []).map(p => p.text ?? '').join('');
        if (!out) throw new Error(j?.promptFeedback?.blockReason || j?.candidates?.[0]?.finishReason || '응답 없음');
        return parseLabels(JSON.parse(out));
    }

    // ponytail: 메모리 캐시라 새로고침하면 다시 과금된다. 다시 듣기가 잦으면 IndexedDB로.
    const labelCache = new Map();
    const pcmCache = new Map();
    function remember(map, key, value) {
        map.set(key, value);
        if (map.size > 60) map.delete(map.keys().next().value);
        return value;
    }

    async function synth(r, model) {
        const body = ttsBody(r, model);
        const key = JSON.stringify(body);
        if (pcmCache.has(key)) return pcmCache.get(key);
        try {
            return remember(pcmCache, key, audioOf(await api('/interactions', body)));
        } catch (error) {
            if (r.voices.length < 2 || error.status !== 400) throw error;
            const out = []; // 다중 화자 400이면 목소리별로 나눠 다시 보낸다.
            for (const t of r.turns) out.push(...await synth({ voices: [t.voice], turns: [t] }, model));
            return out;
        }
    }

    const play = { ctx: null, at: 0, srcs: [], btn: null, run: 0 };
    function stop() {
        play.run++;
        for (const s of play.srcs) try { s.stop(); } catch {}
        play.srcs = [];
        play.at = 0;
        if (play.btn) setBtn(play.btn, 'play');
        play.btn = null;
    }
    function schedule({ pcm, rate }) {
        const n = pcm.length >> 1, buf = play.ctx.createBuffer(1, n, rate), ch = buf.getChannelData(0);
        const dv = new DataView(pcm.buffer, pcm.byteOffset, pcm.length);
        for (let i = 0; i < n; i++) ch[i] = dv.getInt16(i * 2, true) / 32768;
        const src = play.ctx.createBufferSource();
        src.buffer = buf;
        src.connect(play.ctx.destination);
        const at = Math.max(play.at, play.ctx.currentTime + 0.05);
        src.start(at);
        play.at = at + buf.duration + GAP;
        play.srcs.push(src);
        return src;
    }

    function linesOf(md) {
        const clone = md.cloneNode(true);
        clone.querySelectorAll('.wrtn-codeblock,.wrtn-markdown-blocked-link,img,hr,table').forEach(e => e.remove());
        return [...clone.children].flatMap(c => c.textContent.split('\n')).map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
    }

    async function requestsFor(id, lines) {
        const set = settings();
        const parts = parseLines(lines, skipRe());
        if (!parts.length) throw new Error('읽을 글이 없습니다');
        const cast = loadCast();
        const labelKey = id + lines.join('\n');
        let labels = labelCache.get(labelKey);
        if (!labels) {
            labels = new Map();
            if (parts.some(p => p.q && !cast[p.speaker])) {
                try { labels = remember(labelCache, labelKey, await askLabels(parts, cast)); }
                catch (error) {
                    if (error.status) throw error; // 키·한도 문제면 등장인물 목록을 더럽히지 않고 멈춘다.
                    toast('화자 구분 실패, 대사를 한 음성으로 읽습니다: ' + error.message, true);
                }
            }
        }
        const genderOf = new Map([...labels.values()].map(l => [l.speaker, l.gender]));
        for (const p of parts) if (p.speaker && labels.has(p.q)) genderOf.set(p.speaker, labels.get(p.q).gender); // 「이름 | 대사」 줄도 성별은 라벨에서
        const mine = loadMine();
        const speak = s => {
            if (s === NARR) return narrVoice(set);
            assignVoice(cast, s, genderOf.get(s) ?? 'unknown', set.narrator);
            return castVoice(cast[s], mine);
        };
        const reqs = batch(turnsOf(parts, labels), speak);
        saveCast(cast);
        return { reqs, model: set.model };
    }

    async function read(md, btn) {
        if (play.btn === btn) return stop();
        stop();
        const run = play.run;
        play.ctx ??= new AudioContext();
        play.btn = btn;
        setBtn(btn, 'load', '준비');
        try {
            await play.ctx.resume();
            const id = md.closest('[data-message-group-id]').getAttribute('data-message-group-id');
            const { reqs, model } = await requestsFor(id, linesOf(md));
            let last = null;
            // ponytail: 요청 단위 재생이라 첫 소리까지 한 묶음 합성 시간이 걸린다. 길면 스트리밍 합성으로.
            for (const [i, r] of reqs.entries()) {
                if (run !== play.run) return;
                setBtn(btn, 'load', `${i + 1}/${reqs.length}`);
                const clips = await synth(r, model);
                if (run !== play.run) return;
                for (const c of clips) last = schedule(c);
            }
            setBtn(btn, 'stop');
            last.onended = () => { if (run === play.run) stop(); };
        } catch (error) {
            if (run !== play.run) return;
            stop();
            toast(error.message, true);
        }
    }

    async function preview({ voice, style }, text, btn) {
        btn.disabled = true;
        try {
            stop();
            play.ctx ??= new AudioContext();
            await play.ctx.resume();
            (await synth({ voices: [voice], turns: [{ voice, text, style }] }, settings().model)).forEach(schedule);
        } catch (error) {
            toast(error.message, true);
        }
        btn.disabled = false;
    }

    // ── 화면 ──

    function el(tag, props = {}, ...kids) {
        const { attrs, ...rest } = props;
        const e = Object.assign(document.createElement(tag), rest);
        for (const [k, v] of Object.entries(attrs ?? {})) e.setAttribute(k, v);
        e.append(...kids.filter(k => k != null));
        return e;
    }

    const ICON = {
        play: '<path fill="currentColor" stroke="none" d="M7 4.8v14.4a.8.8 0 0 0 1.2.7l12-7.2a.8.8 0 0 0 0-1.4l-12-7.2A.8.8 0 0 0 7 4.8z"/>',
        stop: '<rect fill="currentColor" stroke="none" x="6" y="6" width="12" height="12" rx="2"/>',
        load: '<path d="M21 12a9 9 0 1 1-6.2-8.6"/>',
        sliders: '<path d="M4 6h9M19 6h1M4 12h1M11 12h9M4 18h7M17 18h3"/><circle cx="16" cy="6" r="2.5"/><circle cx="8" cy="12" r="2.5"/><circle cx="14" cy="18" r="2.5"/>',
        users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
        mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 11a7 7 0 0 1-14 0M12 18v4"/>',
        close: '<path d="M18 6 6 18M6 6l12 12"/>',
        trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v5M14 11v5"/>',
        plus: '<path d="M12 5v14M5 12h14"/>',
    };
    function icon(name) {
        const s = el('span', { className: 'ctts-ico', attrs: { 'aria-hidden': 'true' } });
        s.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON[name]}</svg>`;
        return s;
    }
    const BTN_TEXT = { play: '읽기', stop: '멈춤' };
    function setBtn(btn, state, text) {
        const label = text ?? BTN_TEXT[state];
        btn.dataset.state = state;
        btn.replaceChildren(icon(state), el('span', { textContent: label }));
        btn.setAttribute('aria-label', state === 'load' ? `합성 중 ${label}, 누르면 멈춤` : `답변 ${label}`);
    }
    const iconBtn = (name, label, onclick, cls = '') => el('button', { type: 'button', className: 'ctts-icon-btn ' + cls, title: label, onclick, attrs: { 'aria-label': label } }, icon(name));

    let toastTimer = 0;
    function toast(text, bad = false) {
        document.getElementById('ctts-toast')?.remove();
        clearTimeout(toastTimer);
        const t = el('div', { id: 'ctts-toast', textContent: text, attrs: { role: 'status' } });
        t.dataset.bad = bad ? '1' : '';
        document.body.append(t);
        toastTimer = setTimeout(() => t.remove(), bad ? 12000 : 5000);
    }

    const voiceLine = (id, desc) => [id, `${id} · ${desc}`];
    function voiceSelect(value, onchange, label, withMine = true) {
        const group = (name, items) => el('optgroup', { label: name }, ...items.map(([v, textContent]) => el('option', { value: v, textContent })));
        const mine = withMine ? loadMine() : [];
        const s = el('select', { onchange: () => onchange(s.value), attrs: { 'aria-label': label } },
            mine.length ? group('내 목소리', mine.map(m => [m.id, `${m.name} · 바탕 ${m.base}`])) : null,
            group('여성', Object.entries(VOICES.female).map(e => voiceLine(...e))),
            group('남성', Object.entries(VOICES.male).map(e => voiceLine(...e))));
        s.value = value;
        return s;
    }
    const field = (label, control, hint) => el('label', { className: 'ctts-field' }, el('span', { className: 'ctts-label', textContent: label }), control, hint ? el('small', { textContent: hint }) : null);

    function styleBox(value, onchange, placeholder) {
        const box = el('textarea', { value, placeholder, rows: 2, maxLength: 300, onchange: () => onchange(box.value.trim()) });
        const chips = STYLE_CHIPS.map(text => el('button', { type: 'button', className: 'ctts-chip', textContent: text, onclick: () => {
            box.value = [box.value.trim(), text].filter(Boolean).join(', ');
            onchange(box.value);
        } }));
        return el('div', { className: 'ctts-style' }, box, el('div', { className: 'ctts-chips' }, ...chips));
    }

    function avatar(name) {
        const hue = [...name].reduce((n, c) => (n * 31 + c.codePointAt(0)) % 360, 7);
        const a = el('span', { className: 'ctts-avatar', textContent: [...name][0], attrs: { 'aria-hidden': 'true' } });
        a.style.background = `hsl(${hue} 42% 36%)`;
        return a;
    }
    const card = (head, ...body) => el('section', { className: 'ctts-card' }, el('div', { className: 'ctts-card-head' }, ...head), ...body);

    function narratorCard() {
        const set = settings();
        const s = voiceSelect(set.narrator, narrator => saveSettings({ narrator }), '나레이션 목소리');
        const say = iconBtn('play', '나레이션 들어 보기', () => preview(narrVoice(), SAMPLE_NARR, say));
        return card([avatar('나'), el('strong', { textContent: '나레이션' }), el('span', { className: 'ctts-tag', textContent: '따옴표 밖 글' }), say],
            field('목소리', s), field('말투', styleBox(set.narrStyle, narrStyle => saveSettings({ narrStyle }), '예: 낮고 차분하게, 소설을 낭독하듯')));
    }

    function castCard(name, c) {
        const patch = p => { const all = loadCast(); Object.assign(all[name], p); saveCast(all); };
        const s = voiceSelect(c.voice, voice => patch({ voice }), name + ' 목소리');
        const say = iconBtn('play', name + ' 들어 보기', () => preview(castVoice(loadCast()[name]), SAMPLE_TALK, say));
        const del = iconBtn('trash', name + ' 삭제', () => { const all = loadCast(); delete all[name]; saveCast(all); panel.show('cast'); }, 'ctts-danger');
        return card([avatar(name), el('strong', { textContent: name }), el('span', { className: 'ctts-tag', textContent: { female: '여성', male: '남성' }[c.gender] ?? '성별 모름' }), say, del],
            field('목소리', s), field('이 인물만의 말투', styleBox(c.style ?? '', style => patch({ style }), '예: 20대 초반, 말끝을 살짝 끄는 버릇')));
    }

    function castTab() {
        const cast = Object.entries(loadCast());
        return [
            el('h3', { textContent: '등장인물 목소리' }),
            el('p', { className: 'ctts-desc', textContent: '답변을 읽으면 인물이 자동으로 추가됩니다. 인물마다 목소리와 말투를 바꿀 수 있고, 작품별로 저장됩니다.' }),
            narratorCard(),
            ...cast.map(([name, c]) => castCard(name, c)),
            cast.length ? null : el('p', { className: 'ctts-empty', textContent: '아직 등장인물이 없습니다. 답변 아래 읽기를 눌러 보세요.' }),
        ];
    }

    function mineCard(m) {
        const patch = p => { const all = loadMine(), one = all.find(x => x.id === m.id); Object.assign(one, p); saveMine(all); };
        const name = el('input', { value: m.name, maxLength: 24, onchange: () => patch({ name: name.value.trim() || '이름 없음' }), attrs: { 'aria-label': '목소리 이름' } });
        const say = iconBtn('play', m.name + ' 들어 보기', () => { const now = loadMine().find(x => x.id === m.id); preview(resolveVoice(now.id, [TALK_STYLE], [now]), SAMPLE_TALK, say); });
        const del = iconBtn('trash', m.name + ' 삭제', () => { saveMine(loadMine().filter(x => x.id !== m.id)); panel.show('mine'); }, 'ctts-danger');
        return card([avatar(m.name), name, say, del],
            field('바탕 목소리', voiceSelect(m.base, base => patch({ base }), '바탕 목소리', false)),
            field('말투 지시', styleBox(m.style, style => patch({ style }), '예: 30대 여성, 낮고 느리게, 문장 끝을 살짝 내림')));
    }

    function mineTab() {
        const add = el('button', { type: 'button', className: 'ctts-primary', onclick: () => {
            saveMine([...loadMine(), { id: 'my_' + Date.now().toString(36), name: '새 목소리', base: 'Aoede', style: '' }]);
            panel.show('mine');
        } }, icon('plus'), '새 목소리');
        const mine = loadMine();
        return [
            el('div', { className: 'ctts-head-row' }, el('h3', { textContent: '내 목소리' }), add),
            el('p', { className: 'ctts-desc', textContent: '구글 목소리 하나에 말투 지시를 더해 나만의 목소리를 만듭니다. 만든 목소리는 등장인물과 나레이션에서 고를 수 있습니다.' }),
            ...mine.map(mineCard),
            mine.length ? null : el('p', { className: 'ctts-empty', textContent: '만든 목소리가 없습니다.' }),
        ];
    }

    function setTab() {
        const set = settings();
        const holder = () => GM_getValue('apiKey', '') ? '저장됨, 바꾸려면 새 키 입력' : 'Gemini API 키';
        const key = el('input', { type: 'password', autocomplete: 'off', placeholder: holder(), attrs: { 'aria-label': 'Gemini API 키' } });
        const note = el('p', { className: 'ctts-note', attrs: { role: 'status' } });
        const say = (text, bad = false) => { note.textContent = text; note.dataset.bad = bad ? '1' : ''; };
        const check = el('button', { type: 'button', className: 'ctts-primary', textContent: '확인', onclick: async () => {
            check.disabled = true;
            await checkKey(key.value.trim() || GM_getValue('apiKey', ''), say);
            check.disabled = false;
            key.value = '';
            key.placeholder = holder();
        } });
        const model = el('select', { onchange: () => saveSettings({ model: model.value }), attrs: { 'aria-label': '모델' } }, ...MODELS.map(([value, textContent]) => el('option', { value, textContent })));
        model.value = set.model;
        const skip = el('input', { value: set.skip, placeholder: '예: ^T\\d+', onchange: () => saveSettings({ skip: skip.value }), attrs: { 'aria-label': '읽지 않을 줄' } });
        return [
            el('h3', { textContent: '설정' }),
            el('section', { className: 'ctts-card' },
                el('div', { className: 'ctts-field' }, el('span', { className: 'ctts-label', textContent: 'API 키' }), el('div', { className: 'ctts-inline' }, key, check), note, el('small', { textContent: '확인을 누르면 짧은 음성 합성을 한 번 보냅니다. 키는 이 브라우저의 Tampermonkey 저장소에만 둡니다.' })),
                field('모델', model),
                field('읽지 않을 줄', skip, '상태창처럼 읽지 말아야 할 줄이 들리면 정규식으로 적어 주세요.')),
        ];
    }

    const NAV = [['cast', '등장인물', 'users', castTab], ['mine', '내 목소리', 'mic', mineTab], ['set', '설정', 'sliders', setTab]];
    let panel = null;
    function closePanel() {
        if (!panel) return;
        panel.overlay.remove();
        panel.opener?.focus?.();
        panel = null;
    }
    function openPanel(tab = 'cast') {
        const opener = panel?.opener ?? document.activeElement;
        panel?.overlay.remove();
        const main = el('main', { className: 'ctts-main' });
        const tabs = NAV.map(([id, label, name]) => el('button', { type: 'button', className: 'ctts-tab', onclick: () => show(id) }, icon(name), el('span', { textContent: label })));
        function show(id) {
            NAV.forEach(([n], i) => (n === id ? tabs[i].setAttribute('aria-current', 'page') : tabs[i].removeAttribute('aria-current')));
            main.replaceChildren(...NAV.find(([n]) => n === id)[3]().filter(Boolean));
            main.scrollTop = 0;
        }
        const close = iconBtn('close', '닫기', closePanel);
        const title = document.title.split('|')[0].trim();
        const shell = el('div', { className: 'ctts-shell', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': '크랙 TTS 설정' } },
            el('header', { className: 'ctts-header' }, el('div', {}, el('h2', { textContent: '크랙 TTS' }), el('p', { textContent: title })), close),
            el('div', { className: 'ctts-layout' }, el('nav', { className: 'ctts-rail', attrs: { 'aria-label': '설정 메뉴' } }, ...tabs), main));
        const overlay = el('div', { id: 'ctts-panel', onmousedown: e => { if (e.target === overlay) closePanel(); } }, shell);
        overlay.addEventListener('keydown', e => {
            e.stopPropagation(); // 크랙 단축키가 입력을 가로채지 않게
            if (e.key === 'Escape') return closePanel();
            if (e.key !== 'Tab') return;
            const list = [...shell.querySelectorAll('button:not(:disabled),input,select,textarea')].filter(x => x.offsetParent);
            const first = list[0], last = list[list.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        });
        document.body.append(overlay);
        panel = { overlay, opener, show };
        show(tab);
        close.focus();
    }

    let lastPath = location.pathname;
    function scan() {
        if (location.pathname !== lastPath) { lastPath = location.pathname; stop(); closePanel(); }
        for (const md of document.querySelectorAll('[data-message-group-id] .wrtn-markdown')) {
            const slot = md.nextElementSibling?.firstElementChild; // 답변에만 있는 아래쪽 버튼 줄의 왼쪽 칸
            if (!slot || slot.querySelector('.ctts-btn')) continue;
            const btn = el('button', { type: 'button', className: 'ctts-btn', onclick: () => read(md, btn) });
            setBtn(btn, 'play');
            slot.append(btn, iconBtn('sliders', 'TTS 설정', () => openPanel(), 'ctts-gear'));
        }
    }

    document.head.append(el('style', { textContent: `
        .ctts-ico { display: inline-flex; width: 16px; height: 16px; flex: none; }
        .ctts-ico svg { width: 100%; height: 100%; }
        .ctts-btn { display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 11px 0 9px; border: 1px solid var(--outline_secondary, rgba(128,128,128,.35)); border-radius: 999px; background: transparent; color: var(--text_secondary, #888); font-size: 13px; font-weight: 600; font-variant-numeric: tabular-nums; cursor: pointer; transition: background .15s, color .15s; }
        .ctts-btn .ctts-ico { width: 14px; height: 14px; }
        .ctts-btn:hover, .ctts-icon-btn:hover { background: var(--bg_elevated_secondary, rgba(128,128,128,.15)); color: var(--text_primary, #eee); }
        .ctts-btn[data-state="stop"], .ctts-btn[data-state="load"] { color: var(--text_brand, #ff6352); border-color: var(--text_brand, #ff6352); }
        .ctts-btn[data-state="load"] .ctts-ico { animation: ctts-spin 1s linear infinite; }
        @keyframes ctts-spin { to { transform: rotate(360deg); } }
        .ctts-icon-btn { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 34px; height: 34px; padding: 0; border: 0; border-radius: 8px; background: transparent; color: var(--text_secondary, #888); cursor: pointer; transition: background .15s, color .15s; }
        .ctts-icon-btn:disabled { opacity: .5; cursor: progress; }
        .ctts-gear { width: 30px; height: 30px; }
        .ctts-danger:hover { color: var(--text_brand, #ff6352); }
        #ctts-panel { position: fixed; inset: 0; z-index: 99999; display: flex; align-items: center; justify-content: center; padding: 24px; background: var(--bg_dimmed, rgba(26,25,24,.6)); }
        #ctts-panel *, #ctts-panel *::before { box-sizing: border-box; }
        .ctts-shell { display: flex; flex-direction: column; width: 720px; max-width: 100%; height: 680px; max-height: 100%; overflow: hidden; border: 1px solid var(--outline_secondary, rgba(128,128,128,.25)); border-radius: 16px; background: var(--bg_elevated_primary, #242321); color: var(--text_primary, #f0efeb); font-size: 15px; line-height: 1.5; box-shadow: 0 28px 64px -24px rgba(0,0,0,.7); }
        body[data-theme="dark"] .ctts-shell { color-scheme: dark; }
        .ctts-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 16px 14px 20px; border-bottom: 1px solid var(--outline_secondary, rgba(128,128,128,.25)); }
        .ctts-header h2 { margin: 0; font-size: 17px; font-weight: 700; }
        .ctts-header p { margin: 0; color: var(--text_secondary, #a8a69d); font-size: 13px; }
        .ctts-layout { display: flex; flex: 1; min-height: 0; }
        .ctts-rail { display: flex; flex: none; flex-direction: column; gap: 4px; width: 92px; padding: 12px 8px; border-right: 1px solid var(--outline_secondary, rgba(128,128,128,.25)); }
        .ctts-tab { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 10px 2px; border: 0; border-radius: 10px; background: transparent; color: var(--text_secondary, #a8a69d); font-size: 12.5px; font-weight: 600; cursor: pointer; transition: background .15s, color .15s; }
        .ctts-tab .ctts-ico { width: 20px; height: 20px; }
        .ctts-tab:hover { background: var(--bg_elevated_secondary, rgba(128,128,128,.15)); }
        .ctts-tab[aria-current] { background: var(--surface_brand_tertiary, #311816); color: var(--text_brand, #ff6352); }
        .ctts-main { flex: 1; min-width: 0; overflow-y: auto; padding: 18px 20px 24px; }
        .ctts-main h3 { margin: 0; font-size: 16px; font-weight: 700; }
        .ctts-desc { margin: 4px 0 14px; color: var(--text_secondary, #a8a69d); font-size: 13.5px; }
        .ctts-head-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
        .ctts-empty { padding: 28px 12px; color: var(--text_tertiary, #85837d); font-size: 14px; text-align: center; }
        .ctts-card { display: flex; flex-direction: column; gap: 12px; margin-bottom: 12px; padding: 14px; border: 1px solid var(--outline_secondary, rgba(128,128,128,.25)); border-radius: 12px; background: var(--bg_elevated_secondary, #2e2d2b); }
        .ctts-main > h3 + .ctts-card { margin-top: 14px; }
        .ctts-card-head { display: flex; align-items: center; gap: 8px; min-height: 34px; }
        .ctts-card-head strong { overflow: hidden; font-size: 15px; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
        .ctts-card-head input { flex: 1; min-width: 0; font-weight: 700; }
        .ctts-card-head .ctts-icon-btn:first-of-type { margin-left: auto; }
        .ctts-avatar { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 32px; height: 32px; border-radius: 50%; color: #fff; font-size: 14px; font-weight: 700; }
        .ctts-tag { flex: none; padding: 1px 8px; border-radius: 999px; background: var(--bg_elevated_primary, #242321); color: var(--text_secondary, #a8a69d); font-size: 12px; }
        .ctts-field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
        .ctts-label { color: var(--text_secondary, #a8a69d); font-size: 13px; font-weight: 600; }
        .ctts-field small { color: var(--text_tertiary, #85837d); font-size: 12.5px; }
        #ctts-panel select, #ctts-panel input:not([type="file"]), #ctts-panel textarea { width: 100%; min-height: 38px; padding: 7px 10px; border: 1px solid var(--outline_secondary, rgba(128,128,128,.4)); border-radius: 8px; background: var(--bg_elevated_primary, #242321); color: var(--text_primary, #f0efeb); font: inherit; font-size: 14px; }
        #ctts-panel textarea { display: block; resize: vertical; }
        #ctts-panel ::placeholder { color: var(--text_tertiary, #85837d); }
        .ctts-inline { display: flex; gap: 8px; }
        .ctts-primary { display: inline-flex; align-items: center; justify-content: center; flex: none; gap: 4px; min-height: 38px; padding: 0 14px; border: 0; border-radius: 8px; background: var(--surface_primary, #fcfcfa); color: var(--bg_screen, #141413); font-size: 14px; font-weight: 700; cursor: pointer; }
        .ctts-primary:disabled { opacity: .6; cursor: progress; }
        .ctts-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
        .ctts-chip { min-height: 30px; padding: 0 10px; border: 1px solid var(--outline_secondary, rgba(128,128,128,.35)); border-radius: 999px; background: transparent; color: var(--text_secondary, #a8a69d); font-size: 12.5px; cursor: pointer; transition: background .15s, color .15s; }
        .ctts-chip:hover { background: var(--bg_elevated_primary, #242321); color: var(--text_primary, #f0efeb); }
        .ctts-note { margin: 2px 0 0; color: var(--text_action_blue_primary, #94c9f9); font-size: 13.5px; overflow-wrap: anywhere; }
        .ctts-note:empty { display: none; }
        .ctts-note[data-bad="1"] { color: var(--text_brand, #ff6352); }
        .ctts-btn:focus-visible, .ctts-icon-btn:focus-visible, .ctts-tab:focus-visible, .ctts-chip:focus-visible, .ctts-primary:focus-visible, #ctts-panel select:focus-visible, #ctts-panel input:focus-visible, #ctts-panel textarea:focus-visible { outline: 2px solid var(--surface_action_blue_primary, #1a88ff); outline-offset: 1px; }
        #ctts-toast { position: fixed; left: 50%; bottom: 24px; z-index: 100000; transform: translateX(-50%); width: max-content; max-width: min(560px, calc(100vw - 32px)); padding: 11px 16px; border-radius: 10px; background: var(--bg_elevated_secondary, #2e2d2b); color: var(--text_primary, #f0efeb); font-size: 14px; box-shadow: 0 8px 24px rgba(0,0,0,.4); }
        #ctts-toast[data-bad="1"] { background: #8c1d18; color: #fff; }
        @media (max-width: 600px) {
            #ctts-panel { padding: 0; }
            .ctts-shell { height: 100%; border: 0; border-radius: 0; }
            .ctts-layout { flex-direction: column; }
            .ctts-rail { flex-direction: row; width: 100%; padding: 6px 8px; border-right: 0; border-bottom: 1px solid var(--outline_secondary, rgba(128,128,128,.25)); }
            .ctts-tab { flex: 1; min-height: 44px; flex-direction: row; justify-content: center; gap: 6px; padding: 6px 2px; }
            .ctts-main { padding: 14px 16px 24px; }
        }
        @media (pointer: coarse) {
            .ctts-btn, .ctts-gear, .ctts-icon-btn { min-width: 44px; min-height: 44px; }
            .ctts-chip { min-height: 38px; }
        }
        @media (prefers-reduced-motion: reduce) {
            .ctts-btn[data-state="load"] .ctts-ico { animation-duration: 3s; }
            .ctts-btn, .ctts-icon-btn, .ctts-tab, .ctts-chip { transition: none; }
        }
    ` }));
    let timer = 0;
    new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(scan, 300); }).observe(document.body, { childList: true, subtree: true });
    scan();
})();
