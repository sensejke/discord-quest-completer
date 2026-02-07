// Telegram форкера: https://t.me/sensejke
// Основа скрипта: https://gist.github.com/aamiaa

(function () {
    'use strict';

    // Удаляем старый интерфейс, если есть
    const old = document.getElementById('quest-completer-gui');
    if (old) old.remove();

    // --- ПОДКЛЮЧЕНИЕ К WEBPACK (Безопасный метод) ---
    let wpRequire;
    try {
        // Создаем фиктивный модуль для перехвата require
        wpRequire = window.webpackChunkdiscord_app.push([
            [Symbol()],
            {},
            (r) => r
        ]);
        window.webpackChunkdiscord_app.pop(); // Очищаем стек
    } catch (e) {
        console.error("Ошибка подключения к Webpack. Перезагрузи Discord (Ctrl+R) и попробуй снова.");
        return;
    }

    // --- ПОИСК МОДУЛЕЙ (С проверкой разных версий обфускации) ---
    const getModule = (filter) => {
        if (!wpRequire || !wpRequire.c) return null;
        return Object.values(wpRequire.c).find(filter);
    };

    // Функция для безопасного извлечения exports
    const getExports = (m) => m && m.exports ? m.exports : null;

    // Ищем модули по сигнатурам (методам, которые в них есть)
    let ApplicationStreamingStoreModule = getModule(x => x?.exports?.Z?.__proto__?.getStreamerActiveStreamMetadata || x?.exports?.A?.__proto__?.getStreamerActiveStreamMetadata);
    let ApplicationStreamingStore = ApplicationStreamingStoreModule?.exports?.Z || ApplicationStreamingStoreModule?.exports?.A;

    let RunningGameStoreModule = getModule(x => x?.exports?.ZP?.getRunningGames || x?.exports?.Ay?.getRunningGames);
    let RunningGameStore = RunningGameStoreModule?.exports?.ZP || RunningGameStoreModule?.exports?.Ay;

    let QuestsStoreModule = getModule(x => x?.exports?.Z?.__proto__?.getQuest || x?.exports?.A?.__proto__?.getQuest);
    let QuestsStore = QuestsStoreModule?.exports?.Z || QuestsStoreModule?.exports?.A;

    let ChannelStoreModule = getModule(x => x?.exports?.Z?.__proto__?.getAllThreadsForParent || x?.exports?.A?.__proto__?.getAllThreadsForParent);
    let ChannelStore = ChannelStoreModule?.exports?.Z || ChannelStoreModule?.exports?.A;

    let GuildChannelStoreModule = getModule(x => x?.exports?.ZP?.getSFWDefaultChannel || x?.exports?.Ay?.getSFWDefaultChannel);
    let GuildChannelStore = GuildChannelStoreModule?.exports?.ZP || GuildChannelStoreModule?.exports?.Ay;

    let GuildStoreModule = getModule(x => x?.exports?.Z?.__proto__?.getGuild || x?.exports?.A?.__proto__?.getGuild);
    let GuildStore = GuildStoreModule?.exports?.Z || GuildStoreModule?.exports?.A;

    let FluxDispatcherModule = getModule(x => x?.exports?.Z?.__proto__?.flushWaitQueue || x?.exports?.h?.__proto__?.flushWaitQueue);
    let FluxDispatcher = FluxDispatcherModule?.exports?.Z || FluxDispatcherModule?.exports?.h;

    let apiModule = getModule(x => x?.exports?.tn?.get || x?.exports?.Bo?.get);
    let api = apiModule?.exports?.tn || apiModule?.exports?.Bo;

    // Проверка критических модулей
    if (!QuestsStore || !api || !RunningGameStore || !GuildStore || !ChannelStore) {
        console.error("Не удалось найти модули Discord. Попробуй перезагрузить Discord (Ctrl+R).");
        console.log("Debug:", { QuestsStore, api, RunningGameStore });
        alert("Ошибка: Скрипт не может найти модули Дискорда. Возможно вышло обновление. Проверь консоль (Ctrl+Shift+I).");
        return;
    }

    // --- ОСНОВНАЯ ЛОГИКА ---
    let isApp = typeof DiscordNative !== "undefined";
    let running = false;
    let stopFlag = false;
    let statsInterval = null;
    let selected = null;
    let autoQueue = false;

    const sense = { name: "sensejke", tg: "https://t.me/sensejke", ver: "2.2-fix" };
    const aamiaa = "https://gist.github.com/aamiaa/204cd9d42013ded9faf646fae7f89fbb";

    let cfg = { autoPause: true, pauseAfter: 3, pauseTime: 300, smartSort: true };
    try { Object.assign(cfg, JSON.parse(localStorage.getItem('qc_cfg') || '{}')); } catch (e) { }
    let saveCfg = () => { try { localStorage.setItem('qc_cfg', JSON.stringify(cfg)); } catch (e) { } };

    const msg = {
        zapusk: ["делай - делай", "ща всё сделаем", "запускаю, сек..."],
        rabota: ["идёт процесс...", "всё норм, ждём", "пам пам пам.. быстрее!!"],
        done: ["готово!", "квест завершён!"],
        pizda: ["упали в ошибки", "что за ??", "это че нахуй"],
        wait: ["дискорд начал банить флуд. паузим...", "надо подождать, лимит", "паузим) f9"]
    };
    let rnd = arr => arr[Math.floor(Math.random() * arr.length)];

    let banWatch = { score: 0, warns: [], bad: ['banned', 'suspended', 'unauthorized', 'forbidden', 'disabled'] };
    banWatch.check = function (err) {
        let status = err?.status;
        let text = (err?.body?.message || '').toLowerCase();
        if (status === 401 || status === 403) {
            this.score += 3;
            this.warns.unshift({ time: new Date().toLocaleTimeString(), lvl: 'high', txt: `Код ${status} - проверь акк!` });
            if (this.warns.length > 10) this.warns.pop();
            return { bad: true, stop: this.score >= 10 };
        }
        for (let w of this.bad) {
            if (text.includes(w)) {
                this.score += 5;
                this.warns.unshift({ time: new Date().toLocaleTimeString(), lvl: 'crit', txt: `Нашёл "${w}" в ответе!` });
                if (this.warns.length > 10) this.warns.pop();
                return { bad: true, stop: true };
            }
        }
        return { bad: false, stop: false };
    };
    banWatch.getStatus = function () {
        if (this.score >= 10) return { txt: '🚨 ПЛОХО', clr: '#f04747' };
        if (this.score >= 5) return { txt: '[!!] хмм', clr: '#faa61a' };
        return { txt: '✅ ок', clr: '#43b581' };
    };
    banWatch.reset = function () { this.score = 0; this.warns = []; };

    let rateLimit = { streak: 0, total: 0, paused: false, pauseEnd: 0 };
    rateLimit.hit = function () {
        this.streak++;
        this.total++;
        if (cfg.autoPause && this.streak >= cfg.pauseAfter) {
            this.paused = true;
            this.pauseEnd = Date.now() + cfg.pauseTime * 1000;
            log(`🛑 Пауза ${formatSec(cfg.pauseTime)}`, 'warn');
            return true;
        }
        return false;
    };
    rateLimit.ok = function () { this.streak = 0; };
    rateLimit.wait = async function () {
        if (!this.paused) return false;
        let left = this.pauseEnd - Date.now();
        if (left <= 0) { this.paused = false; this.streak = 0; log('✅ Пауза кончилась', 'ok'); return false; }
        showPauseTimer(left);
        await sleep(1000);
        return true;
    };
    rateLimit.stop = function () { this.paused = false; this.streak = 0; };

    let stats = { done: 0, skip: 0, startedAt: Date.now() };

    let sleep = ms => new Promise(r => setTimeout(r, ms));
    let zxcDelay = base => Math.floor(Math.random() * (base * 0.6) + base * 0.7);
    let zxcSleep = async base => await sleep(zxcDelay(base));
    let zxcPause = async () => { if (Math.random() < 0.15) await sleep(Math.floor(Math.random() * 3000) + 500); };

    function formatSec(s) {
        let m = Math.floor(s / 60),
            sec = Math.floor(s % 60);
        return m > 0 ? `${m}м ${sec}с` : `${sec}с`;
    }
    let formatMs = ms => formatSec(Math.floor(ms / 1000));

    function getDeadline(q) {
        let exp = new Date(q.config.expiresAt).getTime(),
            left = exp - Date.now();
        if (left < 0) return 'истёк';
        let days = Math.floor(left / 86400000),
            hrs = Math.floor((left % 86400000) / 3600000);
        if (days > 0) return `${days}д`;
        if (hrs > 0) return `${hrs}ч`;
        return 'скоро';
    }

    function getTaskType(q) {
        let c = q.config?.taskConfig ?? q.config?.taskConfigV2;
        let tasks = c?.tasks ? Object.keys(c.tasks) : [];
        if (tasks.some(t => t.includes('VIDEO'))) return 'video';
        if (tasks.includes('PLAY_ON_DESKTOP')) return 'play';
        if (tasks.includes('STREAM_ON_DESKTOP')) return 'stream';
        if (tasks.includes('PLAY_ACTIVITY')) return 'activity';
        return '???';
    }

    function getTaskKey(q) {
        let c = q.config?.taskConfig ?? q.config?.taskConfigV2;
        return ['WATCH_VIDEO', 'PLAY_ON_DESKTOP', 'STREAM_ON_DESKTOP', 'PLAY_ACTIVITY', 'WATCH_VIDEO_ON_MOBILE'].find(k => c.tasks[k]);
    }

    function canRun(q) {
        let task = getTaskKey(q);
        if (!isApp && (task === 'PLAY_ON_DESKTOP' || task === 'STREAM_ON_DESKTOP')) return false;
        return true;
    }

    let isComplete = qid => {
        let q = [...QuestsStore.quests.values()].find(x => x.id === qid);
        return q?.userStatus?.completedAt != null;
    };

    const css = document.createElement('style');
    css.id = 'qc-css';
    css.textContent = `#quest-completer-gui{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:460px;min-height:400px;max-height:85vh;background:#2b2d31;border-radius:14px;box-shadow:0 10px 40px rgba(0,0,0,.5);font-family:'gg sans',sans-serif;color:#dbdee1;z-index:999999;overflow:hidden;animation:qcPop .3s ease}@keyframes qcPop{from{opacity:0;transform:translate(-50%,-50%) scale(.9)}}.qc-head{background:linear-gradient(135deg,#5865f2,#4752c4);padding:16px 20px;cursor:move;display:flex;justify-content:space-between;align-items:center;user-select:none}.qc-head h3{margin:0;font-size:18px;color:#fff;display:flex;align-items:center;gap:10px}.qc-head small{opacity:.7;font-weight:400;font-size:12px}.qc-head-btns button{background:rgba(255,255,255,.15);border:0;color:#fff;width:28px;height:28px;border-radius:6px;cursor:pointer;font-size:14px;margin-left:6px;transition:all .2s}.qc-head-btns button:hover{background:rgba(255,255,255,.25);transform:scale(1.1)}.qc-tabs{display:flex;background:#1e1f22;border-bottom:1px solid #3f4147}.qc-tabs div{flex:1;padding:12px;text-align:center;cursor:pointer;font-size:13px;font-weight:600;color:#888;border-bottom:2px solid transparent;transition:all .2s}.qc-tabs div:hover{color:#ddd;background:#2b2d31}.qc-tabs div.on{color:#5865f2;border-color:#5865f2}.qc-body{padding:16px;max-height:55vh;overflow-y:auto;display:none}.qc-body.on{display:block}.qc-body::-webkit-scrollbar{width:6px}.qc-body::-webkit-scrollbar-track{background:#2b2d31;border-radius:3px}.qc-body::-webkit-scrollbar-thumb{background:#5865f2;border-radius:3px}.qc-body::-webkit-scrollbar-thumb:hover{background:#7289da}.qc-status{background:#1e1f22;border-radius:10px;padding:14px;display:flex;align-items:center;gap:14px;margin-bottom:16px;border:1px solid #3f4147}.qc-dot{width:12px;height:12px;border-radius:50%;background:#43b581;animation:qcGlow 2s infinite}.qc-dot.rabota{background:#faa61a}.qc-dot.err{background:#f04747;animation:none}.qc-dot.pause{background:#9b59b6}@keyframes qcGlow{50%{opacity:.5}}.qc-status-info{flex:1}.qc-status-info b{font-size:15px;display:block}.qc-status-info small{color:#888;font-size:12px}.qc-mode{background:${isApp ? '#43b581' : '#faa61a'};color:#fff;padding:4px 10px;border-radius:12px;font-size:11px;font-weight:700}.qc-label{font-size:12px;font-weight:700;text-transform:uppercase;color:#72767d;margin-bottom:12px;letter-spacing:.5px}.qc-quests{display:flex;flex-direction:column;gap:6px;margin-bottom:16px;min-height:80px}.qc-quest{background:#1e1f22;border-radius:10px;padding:12px 14px;cursor:pointer;border:2px solid transparent;transition:all .15s}.qc-quest:hover{border-color:#5865f244;transform:translateX(3px)}.qc-quest.on{border-color:#5865f2;background:#5865f215}.qc-quest.off{opacity:.5;cursor:not-allowed}.qc-quest.off:hover{transform:none}.qc-quest-name{font-size:14px;font-weight:600;margin-bottom:6px}.qc-quest-meta{display:flex;flex-wrap:wrap;gap:5px;font-size:10px}.qc-tag{padding:3px 8px;border-radius:4px;font-weight:600}.qc-tag.video{background:#e91e63;color:#fff}.qc-tag.play{background:#43b581;color:#fff}.qc-tag.stream{background:#9b59b6;color:#fff}.qc-tag.activity{background:#e67e22;color:#fff}.qc-tag.grey{background:#3f4147;color:#aaa}.qc-tag.red{background:#f04747;color:#fff}.qc-tag.blue{background:#5865f233;color:#8ea1e1}.qc-empty{text-align:center;padding:40px 20px;color:#666}.qc-empty-icon{font-size:48px;margin-bottom:12px}.qc-empty-text{font-size:16px}.qc-progress{background:#1e1f22;border-radius:10px;padding:14px;margin-bottom:16px;display:none}.qc-progress.on{display:block}.qc-progress-top{display:flex;justify-content:space-between;font-size:13px;margin-bottom:10px}.qc-progress-top span:last-child{font-weight:700}.qc-bar{height:8px;background:#3f4147;border-radius:4px;overflow:hidden}.qc-bar-fill{height:100%;background:linear-gradient(90deg,#5865f2,#7289da);border-radius:4px;width:0;transition:width .3s}.qc-pause{background:linear-gradient(135deg,#9b59b6,#8e44ad);border-radius:10px;padding:14px;margin-bottom:16px;color:#fff;display:none}.qc-pause.on{display:block}.qc-pause-time{font-size:24px;font-weight:700;text-align:center;margin:10px 0}.qc-pause button{background:rgba(255,255,255,.2);border:0;color:#fff;padding:8px 14px;border-radius:6px;cursor:pointer;font-size:12px;width:100%;transition:all .2s}.qc-pause button:hover{background:rgba(255,255,255,.3)}.qc-btns{display:flex;gap:8px}.qc-btn{flex:1;padding:12px;border:0;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;transition:all .15s}.qc-btn-zapusk{background:#5865f2;color:#fff}.qc-btn-go:hover:not(:disabled){transform:translateY(-2px);box-shadow:0 4px 15px #5865f255}.qc-btn-go:disabled{opacity:.4;cursor:not-allowed}.qc-btn-stop{background:#f04747;color:#fff}.qc-btn-stop:hover{background:#d63d3d}.qc-btn-queue{background:#43b581;color:#fff;width:44px;flex:none}.qc-btn-queue:hover{background:#3ca374}.qc-btn-queue.on{background:#faa61a}.qc-btn-icon{background:#3f4147;color:#ddd;width:44px;flex:none}.qc-btn-icon:hover{background:#4f545c}.qc-logs{margin-top:14px}.qc-logs-box{background:#1e1f22;border-radius:8px;padding:10px 12px;max-height:120px;overflow-y:auto;font-family:monospace;font-size:11px}.qc-logs-box::-webkit-scrollbar{width:6px}.qc-logs-box::-webkit-scrollbar-track{background:#1e1f22;border-radius:3px}.qc-logs-box::-webkit-scrollbar-thumb{background:#5865f2;border-radius:3px}.qc-logs-box::-webkit-scrollbar-thumb:hover{background:#7289da}.qc-log{padding:4px 0;display:flex;gap:8px;border-bottom:1px solid #ffffff08}.qc-log:last-child{border:0}.qc-log-t{color:#555;flex-shrink:0}.qc-log-m{color:#999}.qc-log-m.ok{color:#43b581}.qc-log-m.bad{color:#f04747}.qc-log-m.warn{color:#faa61a}.qc-log-m.info{color:#5865f2}.qc-stats{display:grid;grid-template-columns:1fr 1fr;gap:10px}.qc-stat{background:#1e1f22;border-radius:30px;padding:15px;text-align:center}.qc-stat b{font-size:22px;color:#5865f2;display:block}.qc-stat small{font-size:10px;color:#666;text-transform:uppercase}.qc-security{background:#1e1f22;border-radius:10px;padding:14px;margin-top:12px}.qc-security-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}.qc-security-status{padding:4px 10px;border-radius:10px;font-size:11px;font-weight:700;color:#fff}.qc-security-row{display:flex;justify-content:space-between;font-size:12px;padding:4px 0;color:#888}.qc-security button{background:#3f4147;border:0;color:#ddd;padding:6px 12px;border-radius:6px;cursor:pointer;font-size:11px;margin-top:8px;transition:all .2s}.qc-security button:hover{background:#4f545c}.qc-warns{margin-top:12px}.qc-warn{background:#f0474722;border-left:3px solid #f04747;padding:8px 12px;margin-bottom:5px;border-radius:0 6px 6px 0;font-size:11px}.qc-setting{display:flex;justify-content:space-between;align-items:center;padding:18px 12px;background:#1e1f22;border-radius:25px;margin-bottom:10px}.qc-setting-info{flex:1}.qc-setting-info b{font-size:13px;display:block}.qc-setting-info small{font-size:12px;color:#666}.qc-toggle{width:44px;height:24px;background:#3f4147;border-radius:12px;cursor:pointer;position:relative;transition:all .2s}.qc-toggle.on{background:#5865f2}.qc-toggle::after{content:'';position:absolute;width:18px;height:18px;background:#fff;border-radius:50%;top:3px;left:3px;transition:left .2s}.qc-toggle.on::after{left:23px}.qc-input{background:#1e1f22;border:1px solid #3f4147;border-radius:6px;padding:6px 10px;color:#ddd;font-size:12px;width:55px;text-align:center}.qc-input:focus{outline:none;border-color:#5865f2}.qc-foot{padding:12px 20px;background:#1e1f22;border-top:1px solid #3f4147;display:flex;justify-content:space-between;align-items:center}.qc-foot-links{display:flex;gap:8px;align-items:center}.qc-foot a{color:#00aced;text-decoration:none;display:flex;align-items:center;gap:5px;padding:6px 12px;background:#00aced15;border-radius:12px;font-size:12px;font-weight:600;transition:all .2s}.qc-foot a:hover{background:#00aced25;transform:scale(1.05)}.qc-foot a.tg-link{animation:tgPulse 2s infinite}@keyframes tgPulse{0%,100%{box-shadow:0 0 0 0 rgba(0,172,237,0.4)}50%{box-shadow:0 0 0 6px rgba(0,172,237,0)}}.qc-foot a.orig-link{background:#57F28715;color:#57F287;font-size:12px;padding:5px 10px}.qc-foot a.orig-link:hover{background:#57F28725}.qc-foot svg{width:14px;height:14px;fill:currentColor}.qc-foot-ver{font-size:10px;color:#555;background:#2b2d31;padding:4px 10px;border-radius:10px}`;
    document.head.appendChild(css);

    const gui = document.createElement('div');
    gui.id = 'quest-completer-gui';
    gui.innerHTML = `<div class="qc-head" id="drag"><h3>🎮 Quest Completer<small>v${sense.ver}</small></h3><div class="qc-head-btns"><button id="close" title="Закрыть">✕</button></div></div><div class="qc-tabs"><div class="on" data-t="main">🎯 Квесты</div><div data-t="stats">📊 Стата</div><div data-t="cfg">⚙️</div></div><div class="qc-body on" id="t-main"><div class="qc-status"><div class="qc-dot" id="dot"></div><div class="qc-status-info"><b id="status">Готов</b><small id="status2">выбери квест</small></div><span class="qc-mode">${isApp ? '🖥️ Desktop' : '🌐 Web'}</span></div><div class="qc-pause" id="pauseCard"><div style="display:flex;justify-content:space-between;align-items:center"><b>🛑 Пауза</b><small>много 429</small></div><div class="qc-pause-time" id="pauseTime">00:00</div><button id="pauseCancel">Отменить</button></div><div class="qc-label">Квесты</div><div class="qc-quests" id="list"></div><div class="qc-progress" id="prog"><div class="qc-progress-top"><span id="progLabel">0 / 0</span><span id="progPct">0%</span></div><div class="qc-bar"><div class="qc-bar-fill" id="progBar"></div></div></div><div class="qc-btns"><button class="qc-btn qc-btn-zapusk" id="start" disabled>▶️ Старт</button><button class="qc-btn qc-btn-stop" id="stop" style="display:none">⏹️ Стоп</button><button class="qc-btn qc-btn-queue" id="queue" title="Авто-очередь">🔄</button><button class="qc-btn qc-btn-icon" id="refresh" title="Обновить">↻</button></div><div class="qc-logs"><div class="qc-label">Логи</div><div class="qc-logs-box" id="logs"></div></div></div><div class="qc-body" id="t-stats"><div class="qc-stats"><div class="qc-stat"><b id="sDone">0</b><small>Сделано</small></div><div class="qc-stat"><b id="sTime">0м</b><small>Время</small></div><div class="qc-stat"><b id="s429">0</b><small>429 ошибок</small></div><div class="qc-stat"><b id="sSkip">0</b><small>Пропущено</small></div></div><div class="qc-security"><div class="qc-security-head"><span class="qc-label" style="margin:0">🛡️ Детектор</span><span class="qc-security-status" id="secStatus">✅ ок</span></div><div class="qc-security-row"><span>Подозрительных:</span><span id="secScore">0</span></div><div class="qc-security-row"><span>429 подряд:</span><span id="sec429">0</span></div><button id="secReset">Сбросить</button></div><div class="qc-warns" id="warns"></div></div><div class="qc-body" id="t-cfg"><div class="qc-label">Авто-пауза</div><div class="qc-setting"><div class="qc-setting-info"><b>Включить</b><small>пауза при частых 429</small></div><div class="qc-toggle ${cfg.autoPause ? 'on' : ''}" id="cfgPause"></div></div><div class="qc-setting"><div class="qc-setting-info"><b>После ошибок</b><small>сколько 429 подряд</small></div><input class="qc-input" type="number" id="cfgAfter" value="${cfg.pauseAfter}" min="1" max="10"></div><div class="qc-setting"><div class="qc-setting-info"><b>Ждать (сек)</b></div><input class="qc-input" type="number" id="cfgTime" value="${cfg.pauseTime}" min="60" max="600" step="30"></div><div class="qc-label" style="margin-top:14px">Сортировка</div><div class="qc-setting"><div class="qc-setting-info"><b>Умная сортировка</b><small>сначала короткие квесты</small></div><div class="qc-toggle ${cfg.smartSort ? 'on' : ''}" id="cfgSort"></div></div></div><div class="qc-foot"><span class="qc-foot-ver">v${sense.ver}</span><div class="qc-foot-links"><a href="${aamiaa}" target="_blank" class="orig-link" title="Оригинальный скрипт">📜 aamiaa</a><a href="${sense.tg}" target="_blank" class="tg-link" title="Телега"><svg viewBox="0 0 24 24"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>@${sense.name}</a></div></div>`;
    document.body.appendChild(gui);

    const $ = s => document.querySelector(s),
        $$ = s => document.querySelectorAll(s);
    const list = $('#list'),
        logs = $('#logs'),
        startBtn = $('#start'),
        stopBtn = $('#stop');
    const queueBtn = $('#queue'),
        dot = $('#dot'),
        statusEl = $('#status'),
        status2El = $('#status2');
    const progCard = $('#prog'),
        progBar = $('#progBar'),
        progLabel = $('#progLabel'),
        progPct = $('#progPct');
    const pauseCard = $('#pauseCard'),
        pauseTime = $('#pauseTime');

    $$('.qc-tabs div').forEach(tab => {
        tab.onclick = () => {
            $$('.qc-tabs div').forEach(t => t.classList.remove('on'));
            $$('.qc-body').forEach(b => b.classList.remove('on'));
            tab.classList.add('on');
            $(`#t-${tab.dataset.t}`).classList.add('on');
        };
    });

    $('#cfgPause').onclick = function () { this.classList.toggle('on'); cfg.autoPause = this.classList.contains('on'); saveCfg(); };
    $('#cfgSort').onclick = function () { this.classList.toggle('on'); cfg.smartSort = this.classList.contains('on'); saveCfg(); loadQuests(); };
    $('#cfgAfter').onchange = function () { cfg.pauseAfter = +this.value || 3; saveCfg(); };
    $('#cfgTime').onchange = function () { cfg.pauseTime = +this.value || 300; saveCfg(); };
    $('#secReset').onclick = () => { banWatch.reset(); rateLimit.streak = 0; rateLimit.total = 0; updateStats(); log('Сброшено', 'info'); };
    $('#pauseCancel').onclick = () => { rateLimit.stop(); pauseCard.classList.remove('on'); };

    function log(txt, type = '') {
        let t = new Date().toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        let el = document.createElement('div');
        el.className = 'qc-log';
        el.innerHTML = `<span class="qc-log-t">${t}</span><span class="qc-log-m ${type}">${txt}</span>`;
        logs.appendChild(el);
        logs.scrollTop = logs.scrollHeight;
        while (logs.children.length > 50) logs.firstChild.remove();
    }

    function setStatus(txt, sub = '', state = '') {
        statusEl.textContent = txt;
        status2El.textContent = sub;
        dot.className = 'qc-dot';
        if (state === 'rabota') dot.classList.add('rabota');
        if (state === 'err') dot.classList.add('err');
        if (state === 'pause') dot.classList.add('pause');
    }

    let showProg = show => progCard.classList.toggle('on', show);
    function updateProg(cur, total) {
        let pct = Math.min(100, Math.floor(cur / total * 100));
        progBar.style.width = pct + '%';
        progLabel.textContent = `${formatSec(cur)} / ${formatSec(total)}`;
        progPct.textContent = pct + '%';
    }

    function showPauseTimer(ms) {
        let sec = Math.ceil(ms / 1000),
            m = Math.floor(sec / 60),
            s = sec % 60;
        pauseTime.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        pauseCard.classList.add('on');
        setStatus('Пауза', `${m}м ${s}с`, 'pause');
    }

    function updateStats() {
        if (!document.getElementById('quest-completer-gui')) { if (statsInterval) clearInterval(statsInterval); return; }
        let sDone = $('#sDone');
        if (!sDone) return;
        sDone.textContent = stats.done;
        $('#sTime').textContent = formatMs(Date.now() - stats.startedAt);
        $('#s429').textContent = rateLimit.total;
        $('#sSkip').textContent = stats.skip;
        let st = banWatch.getStatus();
        $('#secStatus').textContent = st.txt;
        $('#secStatus').style.background = st.clr;
        $('#secScore').textContent = banWatch.score;
        $('#sec429').textContent = rateLimit.streak;
        $('#warns').innerHTML = banWatch.warns.slice(0, 5).map(w => `<div class="qc-warn"><b>${w.time}</b> — ${w.txt}</div>`).join('');
    }
    statsInterval = setInterval(updateStats, 1000);

    function loadQuests() {
        if (!QuestsStore || !QuestsStore.quests) {
            log('Ошибка: QuestsStore недоступен', 'bad');
            return [];
        }
        list.innerHTML = '';
        selected = null;
        startBtn.disabled = true;
        let quests = [...QuestsStore.quests.values()].filter(q => q.id !== "1412491570820812933" && !q.userStatus?.completedAt && new Date(q.config.expiresAt).getTime() > Date.now());
        if (quests.length === 0) {
            list.innerHTML = '<div class="qc-empty"><div class="qc-empty-icon">🎉</div><div class="qc-empty-text">Всё сделано!</div></div>';
            log('Квестов нет', 'ok');
            return [];
        }
        if (cfg.smartSort) {
            quests.sort((a, b) => {
                let cA = a.config?.taskConfig ?? a.config?.taskConfigV2,
                    cB = b.config?.taskConfig ?? b.config?.taskConfigV2;
                let kA = getTaskKey(a),
                    kB = getTaskKey(b);
                let tA = cA.tasks[kA]?.target || 999999,
                    tB = cB.tasks[kB]?.target || 999999;
                return tA - tB;
            });
        }
        let runnable = [];
        quests.forEach(q => {
            let type = getTaskType(q),
                key = getTaskKey(q);
            let qcfg = q.config?.taskConfig ?? q.config?.taskConfigV2;
            let total = qcfg.tasks[key]?.target || 0,
                done = q.userStatus?.progress?.[key]?.value || 0;
            let pct = Math.floor(done / total * 100),
                ok = canRun(q),
                deadline = getDeadline(q);
            if (ok) runnable.push(q);
            let el = document.createElement('div');
            el.className = `qc-quest${ok ? '' : ' off'}`;
            el.innerHTML = `<div class="qc-quest-name">${q.config.messages.questName}</div><div class="qc-quest-meta"><span class="qc-tag ${type}">${type}</span><span class="qc-tag grey">⏱️ ${formatSec(total)}</span><span class="qc-tag grey">⏰ ${deadline}</span>${q.userStatus?.enrolledAt ? `<span class="qc-tag blue">${pct}%</span>` : ''}${!ok ? '<span class="qc-tag red">🖥️ Desktop</span>' : ''}</div>`;
            if (ok) {
                el.onclick = () => {
                    $$('.qc-quest').forEach(e => e.classList.remove('on'));
                    el.classList.add('on');
                    selected = q;
                    startBtn.disabled = false;
                };
            }
            list.appendChild(el);
        });
        log(`Квестов: ${quests.length} (доступно ${runnable.length})`, 'info');
        return runnable;
    }

    let drag = false,
        dx = 0,
        dy = 0;
    $('#drag').onmousedown = e => {
        if (e.target.tagName === 'BUTTON') return;
        drag = true;
        let r = gui.getBoundingClientRect();
        dx = e.clientX - r.left;
        dy = e.clientY - r.top;
    };
    document.onmousemove = e => {
        if (!drag) return;
        gui.style.left = (e.clientX - dx) + 'px';
        gui.style.top = (e.clientY - dy) + 'px';
        gui.style.transform = 'none';
    };
    document.onmouseup = () => drag = false;

    $('#close').onclick = () => { stopFlag = true; if (statsInterval) clearInterval(statsInterval); gui.remove(); };
    $('#refresh').onclick = loadQuests;
    stopBtn.onclick = () => { stopFlag = true; autoQueue = false; queueBtn.classList.remove('on'); rateLimit.stop(); pauseCard.classList.remove('on'); log('Стоп', 'warn'); };
    queueBtn.onclick = () => { autoQueue = !autoQueue; queueBtn.classList.toggle('on', autoQueue); log(autoQueue ? 'Авто-очередь ВКЛ' : 'Авто-очередь выкл', 'info'); };

    startBtn.onclick = async () => {
        if (!selected || running) return;
        running = true;
        stopFlag = false;
        startBtn.style.display = 'none';
        stopBtn.style.display = '';
        showProg(true);
        try { await runQuest(selected); } catch (e) { log(`${rnd(msg.pizda)}: ${e.message}`, 'bad'); banWatch.check(e); }
        running = false;
        startBtn.style.display = '';
        stopBtn.style.display = 'none';
        pauseCard.classList.remove('on');
        setStatus('Готов', '');
        let left = loadQuests();
        if (autoQueue && left.length > 0 && !stopFlag) {
            log('Следующий через 3 сек...', 'info');
            await sleep(3000);
            if (autoQueue && !stopFlag && left.length > 0) {
                selected = left[0];
                $$('.qc-quest:not(.off)')[0]?.classList.add('on');
                startBtn.disabled = false;
                startBtn.click();
            }
        } else if (autoQueue && left.length === 0) {
            log('Всё сделано! 🎉', 'ok');
            autoQueue = false;
            queueBtn.classList.remove('on');
        }
    };

    async function handleErr(e) {
        let check = banWatch.check(e);
        updateStats();
        if (check.stop) { log('🚨 Критичная ошибка!', 'bad'); stopFlag = true; return { ok: false }; }
        if (e?.status === 429) {
            let wait = e?.body?.retry_after || 60;
            let needPause = rateLimit.hit();
            updateStats();
            if (needPause && cfg.autoPause) {
                while (await rateLimit.wait()) { if (stopFlag) break; }
                pauseCard.classList.remove('on');
                return { ok: !stopFlag };
            }
            log(`${rnd(msg.wait)} (${formatSec(wait)})`, 'warn');
            return { ok: true, wait: wait * 1000 };
        }
        return { ok: true, wait: 5000 };
    }

    async function enroll(q) {
        log('Записываюсь...', 'info');
        await zxcSleep(800);
        try {
            await api.post({ url: `/quests/${q.id}/enroll`, body: { location: 1 } });
            log('Записался ✓', 'ok');
            rateLimit.ok();
            return true;
        } catch (e) {
            if (e.status === 400) { log('Уже записан', 'info'); return true; }
            let res = await handleErr(e);
            if (!res.ok) return false;
            if (res.wait) { await sleep(res.wait); return enroll(q); }
            return false;
        }
    }

    async function claim(q) {
        log('Лутаю награду...', 'info');
        await zxcSleep(1000);
        try {
            await api.post({ url: `/quests/${q.id}/claim`, body: { platform: 0 } });
            log('Награда получена! 🎁', 'ok');
            return true;
        } catch (e) {
            log(`Не забрал: ${e.body?.message || e.status}`, 'warn');
            return false;
        }
    }

    async function runQuest(q) {
        let name = q.config.messages.questName,
            task = getTaskKey(q);
        if (!canRun(q)) { log(`[!!] ${name} — нужен Desktop`, 'warn'); stats.skip++; return; }
        setStatus(rnd(msg.zapusk), name, 'rabota');
        log(rnd(msg.zapusk), 'info');
        await zxcSleep(1000);
        let qcfg = q.config?.taskConfig ?? q.config?.taskConfigV2;
        let total = qcfg.tasks[task].target,
            done = q.userStatus?.progress?.[task]?.value || 0;
        log(`Тип: ${task}`, 'info');
        if (!q.userStatus?.enrolledAt) {
            if (!await enroll(q)) return;
            await zxcSleep(2000);
            q = [...QuestsStore.quests.values()].find(x => x.id === q.id);
        }
        updateProg(done, total);
        let ok = false;
        if (task.includes('VIDEO')) ok = await doVideo(q, total, done);
        else if (task === 'PLAY_ON_DESKTOP') ok = await doPlay(q, total, done);
        else if (task === 'STREAM_ON_DESKTOP') ok = await doStream(q, total, done);
        else if (task === 'PLAY_ACTIVITY') ok = await doActivity(q, total);
        if (ok) {
            stats.done++;
            log(`${rnd(msg.done)} — ${name}`, 'ok');
            setStatus('Готово!', '🎉');
            await claim(q);
        }
    }

    async function doVideo(q, total, done) {
        let start = new Date(q.userStatus.enrolledAt).getTime(),
            cur = done,
            errs = 0;
        log('Смотрю видео...', 'info');
        setStatus('Видео', rnd(msg.rabota), 'rabota');
        while (cur < total && errs < 5 && !stopFlag) {
            while (await rateLimit.wait())
                if (stopFlag) break;
            pauseCard.classList.remove('on');
            if (stopFlag) break;
            await zxcPause();
            let max = Math.floor((Date.now() - start) / 1000) + 10,
                diff = max - cur;
            if (diff >= 5) {
                let step = 5 + Math.random() * 4,
                    ts = Math.min(total, cur + step);
                try {
                    let res = await api.post({ url: `/quests/${q.id}/video-progress`, body: { timestamp: ts } });
                    cur = ts;
                    updateProg(cur, total);
                    errs = 0;
                    rateLimit.ok();
                    let pct = Math.floor(cur / total * 100);
                    if (pct % 25 === 0 && pct > 0) log(`${pct}%`, 'info');
                    if (res.body.completed_at) break;
                } catch (e) {
                    errs++;
                    let res = await handleErr(e);
                    if (!res.ok) return false;
                    if (res.wait) await sleep(res.wait);
                }
            }
            await zxcSleep(1200);
        }
        return !stopFlag && errs < 5;
    }

    async function doPlay(q, total, done) {
        let qid = q.id,
            appId = q.config.application.id;
        let pid = Math.floor(Math.random() * 30000) + 1000;
        try {
            let res = await api.get({ url: `/applications/public?application_ids=${appId}` });
            let app = res.body[0],
                exe = app?.executables?.find(x => x.os === 'win32');
            if (!exe) { log('Не нашёл exe', 'bad'); return false; }
            let fakeGame = {
                cmdLine: `C:\\Program Files\\${app.name}\\${exe.name.replace('>', '')}`,
                exeName: exe.name.replace('>', ''),
                exePath: `c:/program files/${app.name.toLowerCase()}/${exe.name.replace('>', '')}`,
                hidden: false,
                isLauncher: false,
                id: appId,
                name: app.name,
                pid: pid,
                pidPath: [pid],
                processName: app.name,
                start: Date.now()
            };
            let realGames = RunningGameStore.getRunningGames();
            let realGet = RunningGameStore.getRunningGames,
                realPid = RunningGameStore.getGameForPID;
            RunningGameStore.getRunningGames = () => [fakeGame];
            RunningGameStore.getGameForPID = p => p === pid ? fakeGame : null;
            FluxDispatcher.dispatch({ type: 'RUNNING_GAMES_CHANGE', removed: realGames, added: [fakeGame], games: [fakeGame] });
            log(`Играю в ${app.name}...`, 'info');
            setStatus('Играю', app.name, 'rabota');
            let ok = false,
                ended = false,
                interval;
            await new Promise(resolve => {
                const finish = reason => {
                    if (ended) return;
                    ended = true;
                    clearInterval(interval);
                    RunningGameStore.getRunningGames = realGet;
                    RunningGameStore.getGameForPID = realPid;
                    FluxDispatcher.dispatch({ type: 'RUNNING_GAMES_CHANGE', removed: [fakeGame], added: [], games: [] });
                    FluxDispatcher.unsubscribe('QUESTS_SEND_HEARTBEAT_SUCCESS', handler);
                    ok = reason === 'done';
                    resolve();
                };
                const handler = data => {
                    if (ended) return;
                    if (stopFlag) { finish('stop'); return; }
                    if (data.userStatus?.completedAt) { finish('done'); return; }
                    let prog = q.config.configVersion === 1 ? data.userStatus.streamProgressSeconds : Math.floor(data.userStatus.progress?.PLAY_ON_DESKTOP?.value || 0);
                    updateProg(prog, total);
                    rateLimit.ok();
                    if (prog >= total) finish('done');
                };
                FluxDispatcher.subscribe('QUESTS_SEND_HEARTBEAT_SUCCESS', handler);
                interval = setInterval(() => {
                    if (ended) return;
                    if (stopFlag) { finish('stop'); return; }
                    if (isComplete(qid)) { finish('done'); return; }
                    let qq = [...QuestsStore.quests.values()].find(x => x.id === qid);
                    if (qq) {
                        let p = qq.userStatus?.progress?.PLAY_ON_DESKTOP?.value || 0;
                        updateProg(p, total);
                        if (p >= total) finish('done');
                    }
                }, 5000);
            });
            return ok;
        } catch (e) { await handleErr(e); return false; }
    }

    async function doStream(q, total, done) {
        let qid = q.id,
            appId = q.config.application.id;
        let pid = Math.floor(Math.random() * 30000) + 1000;
        let realFn = ApplicationStreamingStore.getStreamerActiveStreamMetadata;
        ApplicationStreamingStore.getStreamerActiveStreamMetadata = () => ({ id: appId, pid, sourceName: null });
        log('Стрим...', 'info');
        log('[!!] Зайди в войс и начни стрим!', 'warn');
        setStatus('Стрим', q.config.application.name, 'rabota');
        let ok = false,
            ended = false,
            interval;
        await new Promise(resolve => {
            const finish = reason => {
                if (ended) return;
                ended = true;
                clearInterval(interval);
                ApplicationStreamingStore.getStreamerActiveStreamMetadata = realFn;
                FluxDispatcher.unsubscribe('QUESTS_SEND_HEARTBEAT_SUCCESS', handler);
                ok = reason === 'done';
                resolve();
            };
            const handler = data => {
                if (ended) return;
                if (stopFlag) { finish('stop'); return; }
                if (data.userStatus?.completedAt) { finish('done'); return; }
                let prog = q.config.configVersion === 1 ? data.userStatus.streamProgressSeconds : Math.floor(data.userStatus.progress?.STREAM_ON_DESKTOP?.value || 0);
                updateProg(prog, total);
                rateLimit.ok();
                if (prog >= total) finish('done');
            };
            FluxDispatcher.subscribe('QUESTS_SEND_HEARTBEAT_SUCCESS', handler);
            interval = setInterval(() => {
                if (ended) return;
                if (stopFlag) { finish('stop'); return; }
                if (isComplete(qid)) { finish('done'); return; }
            }, 5000);
        });
        return ok;
    }

    async function doActivity(q, total) {
        let cid = ChannelStore?.getSortedPrivateChannels?.()?.[0]?.id;

        if (!cid && GuildStore && GuildChannelStore) {
            let guilds = Object.values(GuildStore.getGuilds() || {});
            for (let g of guilds) {
                // Пытаемся найти голосовой канал
                let channels = GuildChannelStore.getChannels(g.id);
                // Структура channels может отличаться (массив или объект {VOCAL: [], ...})
                if (channels && channels.VOCAL && channels.VOCAL.length > 0) {
                    cid = channels.VOCAL[0].channel.id;
                    break;
                }
                // Фолбек если возвращает массив каналов (старые/новые версии)
                if (Array.isArray(channels)) {
                    let v = channels.find(c => c.type === 2); // 2 = Voice
                    if (v) { cid = v.id; break; }
                }
            }
        }

        if (!cid) { log('Не нашёл канал (ЛС или сервер)', 'bad'); return false; }
        let key = `call:${cid}:1`,
            errs = 0;
        log('Активность...', 'info');
        setStatus('Активность', rnd(msg.rabota), 'rabota');
        while (errs < 5 && !stopFlag) {
            while (await rateLimit.wait())
                if (stopFlag) break;
            pauseCard.classList.remove('on');
            if (stopFlag) break;
            await zxcPause();
            if (isComplete(q.id)) return true;
            try {
                let res = await api.post({ url: `/quests/${q.id}/heartbeat`, body: { stream_key: key, terminal: false } });
                let prog = res.body.progress.PLAY_ACTIVITY.value;
                updateProg(prog, total);
                errs = 0;
                rateLimit.ok();
                if (prog >= total) {
                    await api.post({ url: `/quests/${q.id}/heartbeat`, body: { stream_key: key, terminal: true } });
                    return true;
                }
            } catch (e) {
                errs++;
                let res = await handleErr(e);
                if (!res.ok) return false;
                if (res.wait) await sleep(res.wait);
            }
            await sleep(zxcDelay(20000));
        }
        return false;
    }

    loadQuests();
    log(`Скрипт запущен`, 'ok');
    log(isApp ? 'Desktop app' : 'Web (desktop квесты недоступны)', 'info');
    console.log('%c QUEST COMPLETER v' + sense.ver, 'font-size:20px;font-weight:bold;color:#5865f2');
    console.log('%c   by @sensejke (syntax fix)', 'font-size:14px;color:#00aced');

})();
