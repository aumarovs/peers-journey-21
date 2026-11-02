// Peers Journey 21 — игра поверх прогулки по кампусу School 21 Tashkent.
// Путь участника: абитуриент → бассейн → основа → стажировка → выпускник.
// Опыт и уровни — за проекты; пир-поинты — за проверку чужого кода, тратятся на сдачу своих
// проектов; коины — за помощь новичкам, волонтёрство и ивенты, тратятся на мерч.
import * as THREE from 'three';
import * as B from '../data/building.js';
import { P } from '../lib/geom.js';
import * as D from './data.js';

const SAVE_KEY = 'pj21-save-v1';
const LEVEL_ORDER = ['B1', 'L1', 'M', 'L2', 'L3'];
const LEVEL_NAME = { B1: 'уровень −1', L1: '1 этаж', M: 'парящая площадка', L2: '2 этаж', L3: '3 этаж' };
const LEVEL_HOW = { B1: 'клавиша B или лестница', L1: 'клавиша 1 или лестница', M: 'кнопка 1½ вверху или лестница', L2: 'клавиша 2 или лестница', L3: 'клавиша 3 или лестница' };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const shuffle = (a) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const plural = (n, one, few, many) => { const m10 = n % 10, m100 = n % 100; return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many; };

function fresh() {
  return {
    v: 1, stage: 'applicant', xp: 0, prp: 0, coins: 0,
    projects: {}, examPassed: false, company: null,
    reviews: 0, goodReviews: 0, helped: 0, volunteered: 0, events: 0, eventsDone: [],
    items: [], badges: [], task: null, startedAt: Date.now(), finishedAt: null,
  };
}
function load() {
  try { const s = JSON.parse(localStorage.getItem(SAVE_KEY)); return s && s.v === 1 ? { ...fresh(), ...s } : null; } catch { return null; }
}

export function createGame(ctx) {
  const { scene, walk, isTouch } = ctx;
  const W = walk.api;
  let S = load() || fresh();
  const save = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch { /* приватный режим — играем без сохранения */ } };

  let people = null, npcsAdded = false, givers = [], started = false, spawned = false;
  let here = null, near = null, tick = 0, eventRun = null, lastRefresh = 0;
  const stations = Object.fromEntries(D.STATIONS.map((s) => [s.id, { ...s, p: null }]));

  // ── Уровни и опыт ──────────────────────────────────────────────────────────
  const levelOf = (xp) => { let l = 0; for (let i = 0; i < D.LEVEL_XP.length; i++) if (xp >= D.LEVEL_XP[i]) l = i; return l; };
  const stageIdx = (id = S.stage) => D.STAGES.findIndex((s) => s.id === id);
  const stage = () => D.STAGES[stageIdx()];
  const has = (item) => S.items.includes(item);
  const projCost = (p) => Math.max(1, p.cost - (has('backpack') ? 1 : 0));
  const stageProjects = (st = S.stage) => D.PROJECTS.filter((p) => p.stage === st);
  const doneCount = (st) => stageProjects(st).filter((p) => S.projects[p.id]).length;
  const nextProject = () => stageProjects().find((p) => !S.projects[p.id]) || null;
  const helps = () => S.helped + S.reviews;

  // ── 3D: маркеры над NPC, подписи станций, маяк цели ─────────────────────────
  function spriteTex(draw, w = 256, h = 256) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    return t;
  }
  function makeSprite(tex, sx, sy) {
    const m = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
    const s = new THREE.Sprite(m); s.scale.set(sx, sy, 1); s.userData.noCollide = true; s.renderOrder = 5;
    scene.add(s); return s;
  }
  const glyphTex = {};
  function glyph(ch, bg, fg) {
    const k = ch + bg;
    return (glyphTex[k] ??= spriteTex((g, w, h) => {
      g.fillStyle = 'rgba(0,0,0,0.28)'; g.beginPath(); g.arc(w / 2, h / 2 + 8, 96, 0, 7); g.fill();
      g.fillStyle = bg; g.beginPath(); g.arc(w / 2, h / 2, 96, 0, 7); g.fill();
      g.lineWidth = 10; g.strokeStyle = 'rgba(255,255,255,0.9)'; g.stroke();
      g.fillStyle = fg; g.font = '700 132px Unbounded, Onest, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(ch, w / 2, h / 2 + 8);
    }));
  }
  function labelSprite(text) {
    const font = '600 44px Onest, system-ui, sans-serif';
    const meas = document.createElement('canvas').getContext('2d'); meas.font = font;
    const tw = Math.ceil(meas.measureText(text).width) + 64, th = 88;
    const tex = spriteTex((g, w, h) => {
      g.fillStyle = 'rgba(10,18,20,0.82)';
      g.beginPath(); g.roundRect(2, 2, w - 4, h - 4, 22); g.fill();
      g.strokeStyle = '#37d3b6'; g.lineWidth = 4; g.stroke();
      g.fillStyle = '#eef4f2'; g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, w / 2, h / 2 + 2);
    }, tw, th);
    return makeSprite(tex, tw / 420, th / 420);
  }
  for (const st of Object.values(stations)) {
    st.label = labelSprite(st.label);
    st.label.position.copy(P(st.u, st.v, st.z + 2.55));
  }
  // маяк цели: светящаяся колонна и кольцо на полу
  const beacon = new THREE.Group(); beacon.userData.noCollide = true; beacon.visible = false;
  {
    const colMat = new THREE.MeshBasicMaterial({ color: 0x37d3b6, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 3.4, 32, 1, true), colMat); col.position.y = 1.7;
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.72, 48), new THREE.MeshBasicMaterial({ color: 0x37d3b6, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03;
    for (const m of [col, ring]) { m.userData.noCollide = true; m.renderOrder = 4; beacon.add(m); }
    beacon.userData.col = col; beacon.userData.ring = ring;
  }
  scene.add(beacon);

  // ── Люди: станции и пиры с просьбами ───────────────────────────────────────
  function onPeople(pp) {
    people = pp;
    if (!npcsAdded && people?.addNpc) {
      npcsAdded = true;
      for (const st of D.STATIONS) people.addNpc({ id: st.id, level: st.level, u: st.u, v: st.v, z: st.z, face: st.face, role: st.role, pose: st.pose });
    }
    for (const g of givers) g.sprite.removeFromParent();
    givers = [];
    lastRefresh = 0;
  }
  const nameFor = (p) => pick(String(p.type || '').startsWith('w_') ? D.NAMES_W : D.NAMES_M);
  function refreshGivers(force = false) {
    if (!people || eventRun) return;
    const now = performance.now();
    if (!force && now - lastRefresh < 4000) return;
    lastRefresh = now;
    const all = people.people();
    for (const st of Object.values(stations)) st.p = all.find((p) => p.npc === st.id) || null;
    givers = givers.filter((g) => { const ok = all.includes(g.p); if (!ok) g.sprite.removeFromParent(); return ok; });
    if (stageIdx() < 1) return;
    const want = { review: 6, help: S.task ? 0 : 3 };
    const count = (k) => givers.filter((g) => g.kind === k).length;
    const free = shuffle(all.filter((p) => !p.npc && p.role !== 'adm' && !givers.some((g) => g.p === p)));
    for (const p of free) {
      const sit = String(p.pose?.kind || '').startsWith('sit');
      const kind = sit ? 'review' : 'help';
      if (count(kind) >= want[kind]) continue;
      const g = { p, kind, name: nameFor(p), sit };
      if (kind === 'review') g.review = pick(D.REVIEWS);
      else g.place = pick(D.HELP_TARGETS.filter((id) => !here || D.PLACES[id].level !== here.level || Math.hypot(D.PLACES[id].u - here.u, D.PLACES[id].v - here.v) > 10));
      g.sprite = makeSprite(kind === 'review' ? glyph('!', '#37d3b6', '#062320') : glyph('?', '#f2ae45', '#2a1800'), 0.42, 0.42);
      givers.push(g);
    }
  }
  function dropGiver(g) { g.sprite.removeFromParent(); givers = givers.filter((x) => x !== g); lastRefresh = performance.now() - 2500; }

  // ── DOM ─────────────────────────────────────────────────────────────────────
  const root = document.getElementById('game-root');
  root.innerHTML = `
  <div class="g-hud" hidden>
    <section class="g-stats" aria-label="Профиль">
      <div class="g-stage"><span id="g-stage"></span><span class="g-lvl" id="g-lvl"></span></div>
      <div class="g-xp" aria-hidden="true"><i id="g-xpbar"></i></div>
      <div class="g-res">
        <span title="Пир-поинты: за проверку чужих проектов, тратятся на сдачу своих"><b id="g-prp"></b> пир-поинты</span>
        <span title="Коины: за помощь, волонтёрство и ивенты, тратятся на мерч"><b id="g-coins"></b> коины</span>
      </div>
      <button class="g-menu-btn" id="g-menu-btn" type="button">Профиль<kbd>Tab</kbd></button>
    </section>
    <section class="g-obj" id="g-obj" aria-live="polite">
      <div class="g-obj-head"><svg class="g-arrow" id="g-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 20 20 12 15.5 4 20Z"/></svg>
        <div class="g-obj-txt"><b id="g-obj-title"></b><span id="g-obj-sub"></span></div></div>
      <ul class="g-checks" id="g-checks"></ul>
    </section>
    <div class="g-prompt" id="g-prompt" hidden></div>
    <button class="g-act" id="g-act" type="button" hidden>Действие</button>
    <div class="g-banner" id="g-banner" hidden></div>
  </div>
  <div class="g-toasts" id="g-toasts" aria-live="polite"></div>
  <div class="g-modal" id="g-modal" hidden><div class="g-card" role="dialog" aria-modal="true" id="g-card"></div></div>`;
  const $ = (id) => document.getElementById(id);
  const hud = root.querySelector('.g-hud');
  root.classList.toggle('touch', isTouch);

  function toast(text, kind = '') {
    const t = document.createElement('div');
    t.className = `g-toast ${kind}`; t.textContent = text;
    $('g-toasts').appendChild(t);
    setTimeout(() => t.classList.add('out'), 2300);
    setTimeout(() => t.remove(), 2800);
  }

  function renderHud() {
    const lvl = levelOf(S.xp), a = D.LEVEL_XP[lvl], b = D.LEVEL_XP[lvl + 1];
    $('g-stage').textContent = stage().short;
    $('g-lvl').textContent = `Уровень ${lvl}`;
    $('g-xpbar').style.width = b ? `${Math.round(((S.xp - a) / (b - a)) * 100)}%` : '100%';
    $('g-xpbar').parentElement.title = b ? `${S.xp} / ${b} XP` : `${S.xp} XP`;
    $('g-prp').textContent = S.prp;
    $('g-coins').textContent = S.coins;
  }

  // ── Награды ────────────────────────────────────────────────────────────────
  function gain({ xp = 0, prp = 0, coins = 0 }) {
    const before = levelOf(S.xp);
    if (xp) { S.xp += xp; toast(`+${xp} XP`, 'xp'); }
    if (prp) { S.prp += prp; toast(`${prp > 0 ? '+' : ''}${prp} ${plural(Math.abs(prp), 'пир-поинт', 'пир-поинта', 'пир-поинтов')}`, 'prp'); }
    if (coins) { const c = Math.round(coins * (has('tee') ? 1.1 : 1)); S.coins += c; toast(`+${c} ${plural(c, 'коин', 'коина', 'коинов')}`, 'coin'); }
    const after = levelOf(S.xp);
    if (after > before) setTimeout(() => toast(`Новый уровень: ${after}`, 'big'), 350);
    save(); renderHud();
  }
  function badge(id) {
    if (S.badges.includes(id)) return;
    S.badges.push(id); save();
    setTimeout(() => toast(`Достижение: ${D.BADGES[id].name}`, 'big'), 700);
  }

  // ── Диалоги ────────────────────────────────────────────────────────────────
  // opts: { who, title, html, options: [{ label, sub, disabled, primary, run }], closable }
  let dlg = null;
  function modal(opts) {
    const card = $('g-card');
    dlg = { ...opts, closable: opts.closable !== false };
    const opt = (opts.options || []).map((o, i) => `<button type="button" class="g-opt${o.primary ? ' primary' : ''}" data-i="${i}" ${o.disabled ? 'disabled' : ''}>
      <span class="g-key">${i + 1}</span><span class="g-opt-txt"><b>${esc(o.label)}</b>${o.sub ? `<small>${esc(o.sub)}</small>` : ''}</span></button>`).join('');
    card.className = `g-card ${opts.cls || ''}`;
    card.innerHTML = `${opts.who ? `<div class="g-who">${esc(opts.who)}</div>` : ''}${opts.title ? `<h2>${esc(opts.title)}</h2>` : ''}
      <div class="g-body">${opts.html || ''}</div><div class="g-opts">${opt}</div>`;
    card.querySelectorAll('.g-opt').forEach((b) => b.addEventListener('click', () => choose(+b.dataset.i)));
    $('g-modal').hidden = false;
    W.freeze(true);
    requestAnimationFrame(() => card.querySelector('.g-opt:not([disabled])')?.focus({ preventScroll: true }));
  }
  function choose(i) {
    if (!dlg) return;
    const o = dlg.options?.[i];
    if (!o || o.disabled) return;
    const was = dlg;
    if (o.run) o.run();
    if (dlg === was) closeModal();      // обработчик не открыл новый диалог — закрываем
  }
  function closeModal() {
    if (!dlg) return;
    dlg = null;
    $('g-modal').hidden = true;
    W.freeze(false);                    // из клика или клавиши — браузер разрешит снова захватить мышь
  }
  const ok = (label = 'Понятно', run) => ({ label, primary: true, run });
  const say = (who, html, label, run) => modal({ who, html: `<p>${html}</p>`, options: [ok(label, run)] });

  // ── Квиз: проекты и экзамен ────────────────────────────────────────────────
  function quiz({ who, title, questions, onDone }) {
    let i = 0, right = 0;
    const step = () => {
      const q = questions[i];
      const order = shuffle(q.o.map((t, k) => ({ t, k })));
      modal({
        who, title, cls: 'quiz', closable: false,
        html: `<div class="g-qnum">Вопрос ${i + 1} из ${questions.length}</div><p class="g-q">${fmtCode(q.q)}</p>`,
        options: order.map(({ t, k }) => ({ label: t, run: () => { if (k === q.a) right++; i++; if (i < questions.length) step(); else onDone(right, questions.length); } })),
      });
    };
    step();
  }
  const fmtCode = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>');
  const draw = (topic, n) => shuffle(D.QUESTIONS[topic]).slice(0, n);

  // ── Станции ────────────────────────────────────────────────────────────────
  function talkStation(id) {
    const st = stations[id];
    if (id === 'adm') return talkAdm(st);
    if (id === 'merch') return shop(st);
    if (id === 'exam') return talkExam(st);
    if (id === 'career') return talkCareer(st);
  }

  function talkAdm(st) {
    if (S.stage === 'applicant') {
      return modal({
        who: st.name, title: 'Регистрация на бассейн',
        html: `<p>Ассалому алайкум! Ты прошёл отбор онлайн, добро пожаловать в School 21.</p>
          <p>Дальше бассейн — интенсив, на котором решается, попадёшь ли ты на основное обучение. Преподавателей здесь нет: <b>проекты проверяют другие участники</b>, пиры.</p>
          <p>Чтобы отправить свой проект на проверку, нужны <b>пир-поинты</b>. Их дают за проверку чужих проектов: подходи к пирам с <span class="g-mk rv">!</span> над головой. Пиры с <span class="g-mk hp">?</span> заблудились, проводи их и получи коины.</p>`,
        options: [ok('Зарегистрироваться', () => {
          S.stage = 'pool'; save();
          gain({ prp: 3 });
          say(st.name, 'Твои первые 3 пир-поинта. Сядь за любой iMac в кластерах на 2 или 3 этаже и сдай первый проект бассейна. Удачи!', 'Вперёд');
          refreshGivers(true);
        })],
      });
    }
    const opts = [];
    if (!S.task) {
      opts.push({ label: 'Хочу поволонтёрить', sub: 'Коины и немного опыта', run: volunteerOffer });
      opts.push({ label: 'Хочу организовать ивент', sub: stageIdx() >= 2 ? 'Турнир, мастер-класс или митап' : 'Откроется на основном обучении', disabled: stageIdx() < 2, run: eventOffer });
    } else opts.push({ label: 'Как там моё задание?', sub: taskTitle(), run: () => say(st.name, `Ты занят: ${esc(taskTitle())}. Маяк и стрелка в углу ведут к следующей точке.`) });
    opts.push({ label: 'Напомни правила', run: () => modal({ who: st.name, title: 'Как тут всё устроено', html: rulesHtml(), options: [ok()] }) });
    opts.push({ label: 'Пока!' });
    modal({ who: st.name, html: `<p>${S.stage === 'grad' ? 'О, наш выпускник! Заходи почаще, новичкам нужны менторы.' : 'Чем помочь?'}</p>`, options: opts });
  }
  const rulesHtml = () => `<ul class="g-list">
    <li><b>Проекты</b> сдаются за iMac в любом кластере. Проверяют пиры и автотесты, за оценку начисляется опыт.</li>
    <li><b>Пир-поинты</b> тратятся на сдачу проекта и даются за каждое пир-ревью.</li>
    <li><b>Коины</b> дают за помощь новичкам, волонтёрство и ивенты. Их тратят на мерч у фотозоны.</li>
    <li><b>Код за тебя не пишет никто</b>: сгенерированный без разрешения код — флаг Cheat и исключение.</li>
    <li>Кампус работает <b>24/7</b>, учишься в своём темпе.</li></ul>`;

  function volunteerOffer() {
    const list = D.VOLUNTEER.filter((v) => v.id !== S.lastVolunteer);
    const v = pick(list);
    modal({
      who: stations.adm.name, title: v.name,
      html: `<p>${esc(v.text)}</p><p class="g-meta">${v.steps.length} ${plural(v.steps.length, 'точка', 'точки', 'точек')} · +${v.coins} коинов · +${v.xp} XP</p>`,
      options: [{ label: 'Беру!', primary: true, run: () => { S.task = { type: 'volunteer', id: v.id, step: 0 }; S.lastVolunteer = v.id; save(); toast('Задание принято: ' + v.name); refreshGivers(true); } }, { label: 'В другой раз' }],
    });
  }
  function eventOffer() {
    const lvl = levelOf(S.xp);
    modal({
      who: stations.adm.name, title: 'Какой ивент проведём?',
      html: '<p>Ивенты от участников бывают трёх типов. Чем полезнее для сообщества, тем больше коинов.</p>',
      options: [...D.EVENTS.map((e) => {
        const lock = lvl < e.minLevel ? `нужен уровень ${e.minLevel}` : S.events < e.needEvents ? 'сначала проведи любой другой ивент' : '';
        return {
          label: `${e.kind}: ${e.name}`, sub: lock ? `Закрыто: ${lock}` : `+${e.coins} коинов · +${e.xp} XP`, disabled: !!lock,
          run: () => { S.task = { type: 'event', id: e.id, step: 0 }; save(); toast('Готовим ивент: ' + e.name); say(stations.adm.name, `${esc(e.text)} Потом приходи в ивент-холл, соберём людей.`, 'Погнали'); },
        };
      }), { label: 'Подумаю' }],
    });
  }

  function shop(st) {
    const items = D.MERCH.map((m) => {
      const own = has(m.id), poor = S.coins < m.price;
      return {
        label: `${m.name} · ${m.price} коинов`, sub: own ? 'Уже у тебя' : m.perk, disabled: own || poor,
        run: () => {
          S.coins -= m.price; S.items.push(m.id); save(); renderHud();
          toast(`Куплено: ${m.name}`, 'coin');
          if (D.MERCH.every((x) => has(x.id))) badge('collector');
          shop(st);
        },
      };
    });
    modal({ who: st.name, title: 'Мерч School 21', cls: 'shop', html: `<p>Коины не купишь, их зарабатывают для сообщества. У тебя <b>${S.coins}</b>.</p>`, options: [...items, { label: 'Выйти' }] });
  }

  function talkExam(st) {
    if (S.stage === 'applicant') return say(st.name, 'Экзамены здесь для участников бассейна. Сначала зарегистрируйся у стойки ADM в лобби.');
    if (S.stage !== 'pool') return say(st.name, S.examPassed ? 'Экзамен бассейна сдан. Здесь, в лектории, теперь проходят защиты и хакатоны.' : 'Удачи!');
    const n = doneCount('pool');
    if (n < 3) return say(st.name, `Экзамен бассейна откроется после всех трёх проектов. Сдано: ${n} из 3.`);
    modal({
      who: st.name, title: 'Экзамен бассейна',
      html: '<p>Пять вопросов, без подсказок и без соседей. Нужно ответить верно хотя бы на три. Пересдать можно сколько угодно.</p>',
      options: [ok('Начать экзамен', () => quiz({
        who: st.name, title: 'Экзамен бассейна',
        questions: [...draw('school', 3), ...draw(pick(['shell', 'python', 'git']), 2)],
        onDone: (r, t) => {
          if (r >= 3) {
            S.examPassed = true; S.stage = 'core'; save();
            gain({ xp: 80, coins: 20 });
            modal({ who: st.name, title: 'Ты на основе!', cls: 'win', html: `<p>Экзамен: ${r} из ${t}. Бассейн пройден, ты зачислен на основное обучение School 21.</p>
              <p>Теперь цель — стажировка. Для неё нужно: уровень ${D.CORE_GOAL.level}, ${D.CORE_GOAL.projects} проекта основы, свой ивент и помощь пирам. Ивенты организуют у стойки ADM.</p>`, options: [ok('Рахмат!')] });
          } else modal({ who: st.name, title: 'Не сдано', html: `<p>${r} из ${t}. Не страшно, бассейн для того и нужен. Повтори материал и приходи снова.</p>`, options: [ok()] });
        },
      })), { label: 'Позже' }],
    });
  }

  function coreChecks() {
    const g = D.CORE_GOAL;
    return [
      { ok: levelOf(S.xp) >= g.level, t: `Уровень ${g.level} (сейчас ${levelOf(S.xp)})` },
      { ok: doneCount('core') >= g.projects, t: `Проекты основы: ${doneCount('core')} из ${g.projects}` },
      { ok: S.events >= g.events, t: 'Провести свой ивент' },
      { ok: helps() >= g.helps, t: `Помочь пирам: ${Math.min(helps(), g.helps)} из ${g.helps}` },
    ];
  }
  function talkCareer(st) {
    if (S.stage === 'intern') return say(st.name, `Как стажировка в «${esc(S.company)}»? Сдай итоговый проект за любым iMac, и диплом твой.`);
    if (S.stage === 'grad') return say(st.name, 'Поздравляю с выпуском! Партнёры уже спрашивали про тебя.');
    if (S.stage !== 'core') return say(st.name, 'Career Hub 21 помогает участникам основы найти стажировку и работу. Возвращайся, когда пройдёшь бассейн.');
    const checks = coreChecks();
    if (!checks.every((c) => c.ok)) {
      return modal({ who: st.name, title: 'До стажировки осталось', html: `<ul class="g-checklist">${checks.map((c) => `<li class="${c.ok ? 'ok' : ''}">${esc(c.t)}</li>`).join('')}</ul>`, options: [ok('Понял, иду')] });
    }
    const offers = [
      { name: 'Финтех-стартап', sub: 'Бэкенд, Python и SQL' },
      { name: 'Геймдев-студия', sub: 'Игры и инструменты для команды' },
      { name: 'IT-компания для японского рынка', sub: 'Программа Global Hub' },
    ];
    modal({
      who: st.name, title: 'У тебя три предложения',
      html: '<p>Портфолио готово, партнёры посмотрели твои проекты. Стажировка обязательна для выпуска. Куда пойдёшь?</p>',
      options: offers.map((o) => ({ label: o.name, sub: o.sub, run: () => {
        S.stage = 'intern'; S.company = o.name; save(); gain({ xp: 50 });
        modal({ who: st.name, title: 'Ты стажёр!', cls: 'win', html: `<p>Поздравляю, ты стажёр в «${esc(o.name)}». Последний шаг: итоговый проект стажировки. Сдай его за любым iMac в кластере.</p>`, options: [ok('Сделаю')] });
      } })),
    });
  }

  // ── Сдача проекта за iMac ──────────────────────────────────────────────────
  function desk() {
    const list = stageProjects();
    if (!list.length) return say('iMac', S.stage === 'grad' ? 'Все проекты сданы. Можно помогать новичкам и проводить ивенты.' : 'Сначала зарегистрируйся на бассейн у стойки ADM в лобби.');
    const next = nextProject();
    const zone = here?.zone || 'кластер';
    modal({
      who: `iMac · ${zone}`, title: `Проекты: ${stage().short.toLowerCase()}`,
      html: `<p>У тебя <b>${S.prp}</b> ${plural(S.prp, 'пир-поинт', 'пир-поинта', 'пир-поинтов')}. Проект проверят пиры и автотесты.</p>`,
      options: [...list.map((p) => {
        const done = S.projects[p.id], cost = projCost(p);
        const isNext = next && p.id === next.id;
        return {
          label: `${p.code} · ${p.name}`,
          sub: done ? `Сдан на ${done}%` : !isNext ? 'Откроется после предыдущего' : S.prp < cost ? `Нужно ${cost} пир-поинта: проверь проекты пиров с «!»` : `Сдать: ${cost} ${plural(cost, 'пир-поинт', 'пир-поинта', 'пир-поинтов')} · до ${p.xp} XP`,
          disabled: !!done || !isNext || S.prp < cost, primary: isNext && S.prp >= cost,
          run: () => submit(p),
        };
      }), { label: 'Встать из-за iMac' }],
    });
  }
  function submit(p) {
    const cost = projCost(p);
    S.prp -= cost; save(); renderHud();
    const qs = p.topic === 'mix' ? [...draw('sql', 1), ...draw('algo', 1), ...draw('web', 1), ...draw('team', 1)] : draw(p.topic, 3);
    const team = p.team ? `Команда: ты, ${pick(D.NAMES_W)} и ${pick(D.NAMES_M)}. ` : '';
    quiz({
      who: `${p.code} · ${p.name}`, title: p.team ? 'Командный проект' : 'Проект', questions: qs,
      onDone: (r, t) => {
        const pct = Math.round((r / t) * 100);
        if (r / t >= 0.6) {
          S.projects[p.id] = pct; save();
          const xp = Math.round(p.xp * (pct / 100) * (has('hoodie') ? 1.1 : 1));
          gain({ xp });
          const after = afterProject(p);
          modal({ who: `${p.code} · ${p.name}`, title: `Сдано: ${pct}%`, cls: 'win', html: `<p>${team}Проверили три пира и автотесты. ${pct === 100 ? 'Чисто, без замечаний.' : 'Есть замечания, но проект принят.'}</p>${after}`, options: [ok('Дальше', p.stage === 'intern' ? graduate : undefined)] });
        } else {
          modal({ who: `${p.code} · ${p.name}`, title: `Не сдано: ${pct}%`, html: `<p>${team}Пиры нашли ошибки. Пир-поинты потрачены, это часть игры. Заработай новые на пир-ревью и попробуй снова.</p>`, options: [ok()] });
        }
      },
    });
  }
  function afterProject(p) {
    if (p.stage === 'pool') { const n = doneCount('pool'); return n >= 3 ? '<p>Все проекты бассейна сданы. Иди на экзамен в лекторий на уровне −1.</p>' : `<p>Проекты бассейна: ${n} из 3.</p>`; }
    if (p.stage === 'core') return `<p>Проекты основы: ${doneCount('core')} из ${stageProjects('core').length}.</p>`;
    return '';
  }
  function graduate() {
    S.stage = 'grad'; S.finishedAt = Date.now(); save(); badge('graduate'); gain({ coins: 50 });
    const days = Math.max(1, Math.round((S.finishedAt - S.startedAt) / 864e5));
    modal({
      title: 'Диплом School 21', cls: 'diploma',
      html: `<div class="g-diploma"><div class="g-dip-21">21</div><p>Настоящим подтверждается, что участник прошёл путь от абитуриента до выпускника кампуса School 21 Tashkent.</p>
        <dl><dt>Уровень</dt><dd>${levelOf(S.xp)}</dd><dt>Опыт</dt><dd>${S.xp} XP</dd><dt>Пир-ревью</dt><dd>${S.reviews}</dd><dt>Помог новичкам</dt><dd>${S.helped}</dd><dt>Ивенты</dt><dd>${S.events}</dd><dt>Стажировка</dt><dd>${esc(S.company || '—')}</dd></dl>
        <p class="g-meta">Ташкент, ул. Зиёлилар, 13 · ${days} ${plural(days, 'день', 'дня', 'дней')} в игре</p></div>`,
      options: [ok('Остаться в кампусе ментором')],
    });
  }

  // ── Пиры: ревью и помощь ───────────────────────────────────────────────────
  function talkGiver(g) {
    if (g.kind === 'review') {
      const r = g.review;
      return modal({
        who: `${g.name} · пир-ревью`, cls: 'review',
        html: `<p>Привет! Проверишь мой проект? Задание: <b>${esc(r.task)}</b></p><pre class="g-code" data-lang="${r.lang}">${esc(r.code)}</pre><p class="g-meta">Пройди по чек-листу и вынеси вердикт.</p>`,
        options: [...r.o.map((t, i) => ({ label: t, run: () => {
          const right = i === r.a;
          S.reviews++; if (right) S.goodReviews++;
          dropGiver(g);
          gain({ prp: 1, xp: right ? 15 + (has('mug') ? 5 : 0) : 3 });
          if (S.reviews === 1) badge('firstReview');
          if (S.goodReviews >= 10) badge('reviewer');
          modal({ who: g.name, title: right ? 'Точное ревью' : 'Ревью с промахом', html: right ? '<p>Рахмат! Поправлю и пересдам.</p>' : `<p>Хм, автотесты с тобой не согласны. Верный вердикт: <b>${esc(r.o[r.a])}</b></p>`, options: [ok()] });
        } })), { label: 'Не сейчас' }],
      });
    }
    const pl = D.PLACES[g.place];
    if (S.task) return say(g.name, `${esc(pick(D.HELP_LINES).replace('{place}', pl.name))}<br><br><span class="g-meta">У тебя уже есть задание. Закончи его, и сможешь помочь.</span>`, 'Позже');
    modal({
      who: `${g.name} · новичок`,
      html: `<p>${esc(pick(D.HELP_LINES).replace('{place}', pl.name))}</p><p class="g-meta">${esc(pl.name)} · ${LEVEL_NAME[pl.level]}</p>`,
      options: [{ label: 'Пошли, покажу', primary: true, run: () => { S.task = { type: 'help', place: g.place, who: g.name }; save(); dropGiver(g); toast(`Проводи ${g.name}: ${pl.name}`); } }, { label: 'Сейчас не могу' }],
    });
  }

  // ── Задания: точки, ивент ──────────────────────────────────────────────────
  function taskSteps(t = S.task) {
    if (!t) return [];
    if (t.type === 'help') return [t.place];
    if (t.type === 'volunteer') return D.VOLUNTEER.find((v) => v.id === t.id).steps;
    if (t.type === 'event') return [...D.EVENTS.find((e) => e.id === t.id).steps, '@hall'];
    return [];
  }
  const placeOf = (id) => (id === '@hall' ? D.EVENT_HALL : D.PLACES[id]);
  function taskTitle(t = S.task) {
    if (!t) return '';
    if (t.type === 'help') return `Проводить ${t.who}: ${D.PLACES[t.place].name}`;
    if (t.type === 'volunteer') return D.VOLUNTEER.find((v) => v.id === t.id).name;
    if (t.type === 'event') return `Ивент: ${D.EVENTS.find((e) => e.id === t.id).name}`;
    return '';
  }
  function reached(pl) {
    if (!here || !pl) return false;
    const lv = here.level || 'L1';
    return lv === pl.level && Math.hypot(here.u - pl.u, here.v - pl.v) < pl.r;
  }
  function checkTask() {
    const t = S.task;
    if (!t || eventRun) return;
    const steps = taskSteps(t), id = steps[t.step || 0], pl = placeOf(id);
    if (!reached(pl)) return;
    if (t.type === 'help') {
      S.task = null; S.helped++; save();
      toast(`${t.who}: «Рахмат, нашёл!»`);
      gain({ coins: 12, xp: 10 });
      if (S.helped >= 5) badge('guide');
      refreshGivers(true);
      return;
    }
    if (id === '@hall') { startEvent(D.EVENTS.find((e) => e.id === t.id)); return; }
    t.step = (t.step || 0) + 1; save();
    if (t.step < steps.length) { toast(`Точка ${t.step} из ${steps.length}: ${pl.name}`); return; }
    if (t.type === 'volunteer') {
      const v = D.VOLUNTEER.find((x) => x.id === t.id);
      S.task = null; S.volunteered++; save();
      gain({ coins: v.coins, xp: v.xp });
      toast(`Волонтёрство выполнено: ${v.name}`, 'big');
      if (S.volunteered >= 3) badge('volunteer');
      refreshGivers(true);
    }
  }
  function startEvent(e) {
    eventRun = { e, t: 0, dur: 24 };
    for (const g of givers) g.sprite.removeFromParent();
    givers = [];
    ctx.setCrowd?.('party');
    const b = $('g-banner'); b.hidden = false;
    b.innerHTML = `<small>${esc(e.kind)} ивент</small><b>${esc(e.name)}</b><div class="g-xp"><i id="g-evbar"></i></div>`;
    toast('Зал собрался! Ивент начался', 'big');
  }
  function finishEvent() {
    const { e } = eventRun;
    eventRun = null;
    $('g-banner').hidden = true;
    S.task = null; S.events++; if (!S.eventsDone.includes(e.id)) S.eventsDone.push(e.id); save();
    gain({ coins: e.coins, xp: e.xp });
    badge('organizer');
    ctx.setCrowd?.('normal');
    toast(`Ивент «${e.name}» прошёл отлично`, 'big');
  }

  // ── Цель и подсказки ───────────────────────────────────────────────────────
  function nearestGiver(kind) {
    if (!here) return null;
    let best = null, bd = 1e9;
    const cam = ctx.camera.position;
    for (const g of givers) {
      if (g.kind !== kind) continue;
      const p = g.p.root.position, d = Math.hypot(cam.x - p.x, cam.z - p.z) + Math.abs(cam.y - p.y) * 4;
      if (d < bd) { bd = d; best = g; }
    }
    return best;
  }
  function objective() {
    // { title, target: {u,v,level,name} | null, checks: [{ok,t}] }
    if (S.task) {
      const steps = taskSteps(), i = S.task.step || 0, pl = placeOf(steps[i]);
      const checks = steps.length > 1 ? steps.map((id, k) => ({ ok: k < i, t: placeOf(id).name })) : [];
      if (eventRun) return { title: `Идёт ивент: ${eventRun.e.name}`, target: null, checks: [] };
      return { title: taskTitle(), target: pl, checks, sub: steps[i] === '@hall' ? 'Всё готово, иди в ивент-холл' : '' };
    }
    const st = stations;
    const asPlace = (s) => ({ u: s.u, v: s.v, level: s.level, name: s.name });
    switch (S.stage) {
      case 'applicant': return { title: 'Пройди турникеты Face ID и зарегистрируйся у стойки ADM', target: asPlace(st.adm), checks: [] };
      case 'pool': {
        const n = doneCount('pool');
        const checks = [...stageProjects('pool').map((p) => ({ ok: !!S.projects[p.id], t: `${p.code} · ${p.name}` })), { ok: S.examPassed, t: 'Экзамен в лектории (−1)' }];
        if (n >= 3) return { title: 'Сдай экзамен бассейна в лектории', target: asPlace(st.exam), checks };
        const p = nextProject();
        if (S.prp < projCost(p)) { const g = nearestGiver('review'); return { title: 'Заработай пир-поинты: проверь проект пира с «!»', target: g ? giverPlace(g) : null, checks }; }
        return { title: `Сдай ${p.code} за любым iMac в кластере`, target: D.PLACES.tashkent, alt: 'любой кластер 2–3 этажа', checks };
      }
      case 'core': {
        const checks = coreChecks();
        if (checks.every((c) => c.ok)) return { title: 'Иди в Career Hub 21 за стажировкой', target: asPlace(st.career), checks };
        const p = nextProject();
        if (p && levelOf(S.xp) < D.CORE_GOAL.level || (p && doneCount('core') < D.CORE_GOAL.projects)) {
          if (S.prp < projCost(p)) { const g = nearestGiver('review'); return { title: 'Нужны пир-поинты: проверь проект пира с «!»', target: g ? giverPlace(g) : null, checks }; }
          return { title: `Сдай ${p.code} · ${p.name} за iMac`, target: D.PLACES.tashkent, alt: 'любой кластер 2–3 этажа', checks };
        }
        if (S.events < 1) return { title: 'Организуй ивент: подойди к стойке ADM', target: asPlace(st.adm), checks };
        const g = nearestGiver('help') || nearestGiver('review');
        return { title: 'Помоги пирам: «?» — проводить, «!» — проверить код', target: g ? giverPlace(g) : null, checks };
      }
      case 'intern': return { title: `Сдай итоговый проект стажировки за iMac`, target: D.PLACES.tashkent, alt: 'любой кластер', checks: [] };
      default: return { title: 'Ты выпускник. Помогай новичкам, проводи ивенты, собирай мерч', target: null, checks: [] };
    }
  }
  const giverPlace = (g) => { const p = g.p.root.position; return { u: p.x + B.SIZE / 2, v: B.SIZE / 2 - p.z, level: g.p.level, name: g.name }; };

  function renderObjective() {
    const o = objective();
    $('g-obj-title').textContent = o.title;
    const arrow = $('g-arrow');
    let sub = o.sub || '';
    if (o.target && here) {
      const t = o.target;
      const lv = here.level || 'L1';
      const d = Math.round(Math.hypot(t.u - here.u, t.v - here.v));
      if (t.level !== lv) {
        const up = LEVEL_ORDER.indexOf(t.level) > LEVEL_ORDER.indexOf(lv);
        sub = `${up ? '↑' : '↓'} ${LEVEL_NAME[t.level]} · ${isTouch ? 'кнопки этажей вверху' : LEVEL_HOW[t.level]}`;
      } else sub = sub || `${t.name}${o.alt ? ` (${o.alt})` : ''} · ${d} м`;
      const a = Math.atan2(-(t.u - here.u), t.v - here.v) * 180 / Math.PI;
      let rel = a - here.yaw; rel = ((rel + 540) % 360) - 180;
      arrow.style.transform = `rotate(${-rel}deg)`;
      arrow.style.opacity = t.level === lv ? '1' : '0.35';
      // маяк в 3D
      beacon.visible = true;
      beacon.position.copy(P(t.u, t.v, B.LEVELS.find((l) => l.id === t.level)?.z ?? 0));
      if (t.z !== undefined) beacon.position.y = P(0, 0, t.z).y;
      } else { arrow.style.opacity = '0'; beacon.visible = false; }
    $('g-obj-sub').textContent = sub;
    $('g-checks').innerHTML = (o.checks || []).map((c) => `<li class="${c.ok ? 'ok' : ''}">${esc(c.t)}</li>`).join('');
  }

  // ── Что рядом: подсказка «E» ───────────────────────────────────────────────
  function scanNear() {
    const cam = ctx.camera.position;
    let best = null, bd = 9;
    const consider = (pos, maxD, item) => {
      const dy = cam.y - pos.y;
      if (dy < 0.4 || dy > 2.8) return;
      const d = Math.hypot(cam.x - pos.x, cam.z - pos.z);
      if (d < maxD && d < bd) { bd = d; best = item; }
    };
    for (const g of givers) consider(g.p.root.position, 2.1, { kind: 'giver', g });
    for (const st of Object.values(stations)) consider(st.p ? st.p.root.position : P(st.u, st.v, st.z), 2.6, { kind: 'station', st });
    if (!best && here) {
      const z = B.ZONES.find((x) => x.id === here.zoneId);
      if (z?.type === 'cluster') best = { kind: 'desk', zone: z };
    }
    near = best;
    const el = $('g-prompt');
    if (!best || dlg || eventRun && best.kind !== 'station') { el.hidden = true; $('g-act').hidden = true; return; }
    let t;
    if (best.kind === 'giver') t = best.g.kind === 'review' ? `${best.g.name}: «Проверишь мой проект?»` : `${best.g.name} что-то ищет`;
    else if (best.kind === 'station') t = best.st.label.userData?.text || D.STATIONS.find((s) => s.id === best.st.id).label;
    else t = 'Сесть за iMac';
    el.innerHTML = `<kbd>E</kbd>${esc(t)}`;
    el.hidden = false;
    $('g-act').hidden = !isTouch;
    $('g-act').textContent = best.kind === 'desk' ? 'iMac' : 'Говорить';
  }
  function interact() {
    if (dlg) return;
    if (W.state().ready) { here = W.state(); scanNear(); }   // после переноса по карте подсказка могла устареть
    if (!near) return;
    if (near.kind === 'giver') talkGiver(near.g);
    else if (near.kind === 'station') talkStation(near.st.id);
    else desk();
  }

  // ── Меню профиля ───────────────────────────────────────────────────────────
  function openMenu() {
    const lvl = levelOf(S.xp), nxt = D.LEVEL_XP[lvl + 1];
    const items = D.MERCH.filter((m) => has(m.id));
    const badges = S.badges.map((b) => D.BADGES[b]);
    modal({
      title: 'Профиль пира', cls: 'profile',
      html: `<div class="g-prof">
        <div class="g-prof-top"><div class="g-avatar">21</div><div><b>${esc(stage().name)}</b><span>Уровень ${lvl} · ${S.xp} XP${nxt ? ` · до следующего ${nxt - S.xp}` : ''}</span></div></div>
        <dl class="g-grid"><div><dt>Пир-поинты</dt><dd>${S.prp}</dd></div><div><dt>Коины</dt><dd>${S.coins}</dd></div><div><dt>Пир-ревью</dt><dd>${S.reviews}</dd></div>
          <div><dt>Помог новичкам</dt><dd>${S.helped}</dd></div><div><dt>Волонтёрство</dt><dd>${S.volunteered}</dd></div><div><dt>Ивенты</dt><dd>${S.events}</dd></div></dl>
        <h3>Проекты</h3><ul class="g-tags">${D.PROJECTS.map((p) => `<li class="${S.projects[p.id] ? 'ok' : ''}">${p.code}${S.projects[p.id] ? ` · ${S.projects[p.id]}%` : ''}</li>`).join('')}</ul>
        <h3>Мерч</h3>${items.length ? `<ul class="g-tags">${items.map((m) => `<li class="ok">${esc(m.name)}</li>`).join('')}</ul>` : '<p class="g-meta">Пока пусто. Мерч продают у фотозоны в лобби за коины.</p>'}
        <h3>Достижения</h3>${badges.length ? `<ul class="g-tags">${badges.map((b) => `<li class="ok" title="${esc(b.text)}">${esc(b.name)}</li>`).join('')}</ul>` : '<p class="g-meta">Впереди.</p>'}
        </div>`,
      options: [ok('Продолжить'), { label: 'Как играть', run: () => help() }, { label: 'Начать путь заново', run: () => confirmReset() }],
    });
  }
  function help() {
    modal({ title: 'Как играть', html: `${rulesHtml()}<ul class="g-list"><li><kbd>W A S D</kbd> идти, <kbd>Shift</kbd> бег, мышь — смотреть.</li><li><kbd>E</kbd> поговорить, сесть за iMac, открыть стойку.</li><li><kbd>1</kbd>–<kbd>4</kbd> и <kbd>B</kbd> — перейти на этаж, <kbd>M</kbd> — большая карта.</li><li>Стрелка в углу и бирюзовый маяк ведут к цели.</li></ul>`, options: [ok()] });
  }
  function confirmReset() {
    modal({ title: 'Начать путь заново?', html: '<p>Весь прогресс, коины и мерч обнулятся. Это нельзя отменить.</p>', options: [{ label: 'Да, начать заново', run: () => {
      S = fresh(); save(); renderHud(); for (const g of givers) g.sprite.removeFromParent(); givers = [];
      W.respawn(); toast('Новый путь начался');
    } }, ok('Отмена')] });
  }

  // ── Ввод ───────────────────────────────────────────────────────────────────
  const overlayUp = () => !document.getElementById('w-overlay')?.hidden;
  addEventListener('keydown', (e) => {
    if (!started || !walk.active) return;
    if (dlg) {
      const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
      if (m) { e.preventDefault(); choose(+m[1] - 1); }
      else if (e.code === 'Escape' && dlg.closable) { e.preventDefault(); closeModal(); }
      else if (e.code === 'Tab') e.preventDefault();
      return;
    }
    if (overlayUp()) return;
    if (e.code === 'KeyE' && !e.repeat) { e.preventDefault(); interact(); }
    else if (e.code === 'Tab') { e.preventDefault(); openMenu(); }
  }, true);
  $('g-act').addEventListener('click', (e) => { e.preventDefault(); interact(); });
  $('g-menu-btn').addEventListener('click', (e) => { e.preventDefault(); openMenu(); });
  $('g-modal').addEventListener('click', (e) => { if (e.target.id === 'g-modal' && dlg?.closable) closeModal(); });

  // ── Цикл ───────────────────────────────────────────────────────────────────
  function update(dt) {
    if (!started) return;
    const on = walk.active;
    hud.hidden = !on;
    if (!on) return;
    const st = W.state();
    if (!st.ready) return;
    here = st;
    if (!spawned) {
      spawned = true;
      if (S.stage !== 'applicant') W.teleport(43.5, 25.5, 'L1', { yaw: 0 });
      refreshGivers(true);
    }
    // маркеры над пирами и маяк
    const t = performance.now() / 1000;
    for (const g of givers) {
      const p = g.p.root.position;
      g.sprite.position.set(p.x, p.y + (g.sit ? 1.75 : 2.2) + Math.sin(t * 2.4 + g.p.slot) * 0.06, p.z);
      g.sprite.visible = !!g.p.root.parent;
    }
    if (beacon.visible) {
      const k = 0.5 + 0.5 * Math.sin(t * 3);
      beacon.userData.col.material.opacity = 0.14 + 0.14 * k;
      beacon.userData.ring.scale.setScalar(1 + 0.18 * k);
    }
    if (eventRun) {
      eventRun.t += dt;
      const bar = document.getElementById('g-evbar');
      if (bar) bar.style.width = `${Math.min(100, (eventRun.t / eventRun.dur) * 100)}%`;
      if (eventRun.t >= eventRun.dur) finishEvent();
    }
    if ((tick += dt) < 0.1) return;
    tick = 0;
    refreshGivers();
    checkTask();
    scanNear();
    renderObjective();
  }

  function overlayText(mode, resumed) {
    const fresh0 = S.stage === 'applicant' && S.xp === 0;
    if (mode === 'pause') return { title: 'Пауза', lead: `${stage().name} · уровень ${levelOf(S.xp)}. Прогресс сохраняется в этом браузере.`, go: 'Продолжить', back: 'Профиль и прогресс' };
    return {
      title: 'Peers Journey 21',
      lead: fresh0
        ? 'Ты абитуриент School 21 и стоишь у кампуса на Зиёлилар, 13. Пройди турникеты, зарегистрируйся на бассейн и дойди до диплома: сдавай проекты, проверяй код пиров, помогай новичкам, волонтёрь, организуй ивенты и собирай мерч.'
        : `С возвращением! ${stage().name}, уровень ${levelOf(S.xp)}, ${S.coins} ${plural(S.coins, 'коин', 'коина', 'коинов')}. ${resumed ? '' : 'Продолжим с лобби.'}`,
      go: fresh0 ? 'Начать путь' : 'Продолжить', back: 'Профиль и прогресс',
    };
  }

  return {
    start() { started = true; renderHud(); },
    update, onPeople, overlayText, openMenu,
    get save() { return S; },
    // для отладки и тестов
    debug: { state: () => S, set: (patch) => { Object.assign(S, patch); save(); renderHud(); }, givers: () => givers, near: () => near, interact, objective, stations },
  };
}
