(() => {
  'use strict';
  const STORE_KEY = 'lifePlannerData_v1';
  const PREF_KEY = 'lifePlannerPrefs_v1';
  const PALETTES = { sage:['#f7f7f1','#fffefa','#243c32','#dce7d9','#a6bca6'], terracotta:['#faf3e8','#fffaf3','#573e35','#ebd9c7','#d49a7a'], lavender:['#f7f4fa','#fffaff','#514465','#e6ddf0','#c1aed8'], ocean:['#f1f7f8','#fcffff','#244a57','#d8e9ed','#8dbac5'] };
  let prefs = (() => { try { return JSON.parse(localStorage.getItem(PREF_KEY)) || {}; } catch { return {}; } })();
  if (!prefs.palette) { prefs.palette = 'terracotta'; try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch {} }
  function applyPalette(name = 'terracotta') {
    const p = PALETTES[name] || PALETTES.terracotta;
    const root = document.documentElement;
    root.style.setProperty('--paper', p[0]);
    root.style.setProperty('--surface', p[1]);
    root.style.setProperty('--ink', p[2]);
    root.style.setProperty('--sage', p[3]);
    root.style.setProperty('--sage-dark', p[4]);
    root.style.setProperty('--line', name === 'terracotta' ? '#eadfd2' : '#e7e9df');
    root.style.setProperty('--accent', p[4]);
    root.style.setProperty('--accent-pale', p[3]);
    document.body.dataset.palette = name;
  }
  applyPalette(prefs.palette);
  let firebaseReady = false, remoteApplying = false, syncDebounce = null;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
  const prettyDate = (date = new Date(), options = { weekday: 'long', month: 'long', day: 'numeric' }) => new Intl.DateTimeFormat('tr-TR', options).format(date);
  const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const safeDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value : today();
  const CATEGORY_MAP = { Personal: 'Kişisel', Career: 'Kariyer', Wellbeing: 'İyi oluş', Home: 'Ev', Fitness: 'Hareket', Travel: 'Seyahat' };
  const normCategory = value => CATEGORY_MAP[value] || value || 'Kişisel';
  const defaultState = () => ({
    tasks: [],
    recurringTasks: [],
    habits: [
      { id: uid(), name: 'Bir bardak su iç', icon: '💧', active: true },
      { id: uid(), name: 'Hareket et', icon: '🌿', active: true },
      { id: uid(), name: '10 dakika oku', icon: '📖', active: true },
      { id: uid(), name: 'Bilinçli bir mola ver', icon: '☁️', active: true }
    ],
    habitChecks: {},
    routines: {
      morning: ['Su iç', '5 dakika esne', 'Bir niyet belirle'],
      evening: ['Telefonu bir kenara bırak', 'Günü değerlendir', 'Birkaç sayfa oku']
    },
    routineChecks: {},
    journal: {},
    mood: {},
    careerNotes: '',
    fitnessNotes: '',
    goals: [
      { id: uid(), title: 'Öğrenmeye alan aç', detail: 'Küçük ve düzenli adımlar da sayılır.', progress: 0 },
      { id: uid(), title: 'İyi oluşuma özen göster', detail: 'Bana iyi gelen rutinler oluştur.', progress: 0 }
    ],
    homeItems: [],
    travelIdeas: [],
    breathingCount: 0
  });
  function normalizeState(parsed, fromRemote = false) {
    const defaults = defaultState();
    const arr = (value, fallback) => Array.isArray(value) ? value : (fromRemote ? [] : fallback);
    const obj = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const r = parsed.routines;
    const next = { ...defaults, ...parsed,
      tasks: arr(parsed.tasks, []),
      recurringTasks: arr(parsed.recurringTasks, []),
      habits: arr(parsed.habits, defaults.habits),
      goals: arr(parsed.goals, defaults.goals),
      homeItems: arr(parsed.homeItems, []),
      travelIdeas: arr(parsed.travelIdeas, []),
      routines: r && typeof r === 'object' ? { morning: Array.isArray(r.morning) ? r.morning : [], evening: Array.isArray(r.evening) ? r.evening : [] } : defaults.routines,
      routineChecks: obj(parsed.routineChecks), habitChecks: obj(parsed.habitChecks),
      journal: obj(parsed.journal), mood: obj(parsed.mood)
    };
    next.tasks.forEach(task => { task.category = normCategory(task.category); });
    next.recurringTasks.forEach(item => { item.category = normCategory(item.category); if (!Array.isArray(item.completedDates)) item.completedDates = []; });
    return next;
  }
  function loadState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORE_KEY));
      if (!parsed || typeof parsed !== 'object') return defaultState();
      return normalizeState(parsed);
    } catch (error) { console.warn('Yerel veriler okunamadı; varsayılanlarla başlanıyor.', error); return defaultState(); }
  }
  function habitStreak(id) {
    const d = new Date();
    if (!(state.habitChecks[isoLocal(d)] || []).includes(id)) d.setDate(d.getDate() - 1);
    let count = 0;
    while ((state.habitChecks[isoLocal(d)] || []).includes(id) && count < 3650) { count++; d.setDate(d.getDate() - 1); }
    return count;
  }
  function loadScript(src) { return new Promise((resolve, reject) => { const el = document.createElement('script'); el.src = src; el.onload = resolve; el.onerror = () => reject(new Error('Betik yüklenemedi: ' + src)); document.head.appendChild(el); }); }
  async function loadFirebase() {
    if (window.firebase?.database) return;
    const base = 'https://www.gstatic.com/firebasejs/10.14.1/';
    await loadScript(base + 'firebase-app-compat.js');
    await loadScript(base + 'firebase-auth-compat.js');
    await loadScript(base + 'firebase-database-compat.js');
  }
  let state = loadState();
  let currentView = 'today';
  let taskFilter = 'all';
  let taskSearch = '';
  let recurringMode = 'list';
  let recurringMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  let journalDate = today();
  let moodChoice = state.mood[today()] || '';
  let toastTimer;
  const view = $('#view');
  const dialog = $('#task-dialog');

  function saveState() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); localStorage.setItem(STORE_KEY+'_updated',String(Date.now())); }
    catch (error) { showToast('Kaydedilemedi. Lütfen yedek alıp cihaz depolamasını kontrol et.'); console.error(error); }
    if (!remoteApplying) scheduleCloudSave();
  }
  function showToast(message) {
    const toast = $('#toast'); toast.textContent = message; toast.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
  }
  function setHeader() {
    $('#today-date').textContent = prettyDate(new Date()).toLocaleUpperCase('tr-TR');
    const titles = { today: 'Kendine ayırdığın alan.', tasks: 'Bir seferde bir adım.', habits: 'Küçük adımlar birikir.', wellbeing: 'Kendine dönüp bak.', journal: 'Düşüncelerin için bir sayfa.', career: 'Öğrenmeye devam et.', goals: 'Kendi hızında geliş.', home: 'Evinde alan aç.', fitness: 'Enerjine özen göster.', travel: 'Heyecanla bekleyeceğin yerler.', settings: 'Senin alanın, senin verilerin.', recurring: 'Haftalık ve aylık planların.' };
    $('#page-title').textContent = titles[currentView] || titles.today;
    $$('.nav-item[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === currentView));
  }
  const getTasksForDate = date => state.tasks.filter(task => task.date === date);
  const activeTasks = () => state.tasks.filter(task => !task.done);
  function taskRow(task, compact = false) {
    const cat = normCategory(task.category);
    const categoryClass = cat === 'İyi oluş' ? 'warm' : cat === 'Kariyer' ? 'blue' : '';
    return `<div class="task-row ${task.done ? 'completed' : ''}"><input class="check" type="checkbox" data-action="toggle-task" data-id="${escapeHTML(task.id)}" ${task.done ? 'checked' : ''} aria-label="${escapeHTML(task.title)}: tamamlandı olarak işaretle"><div class="task-main"><div class="task-name">${escapeHTML(task.title)}</div><div class="task-meta">${task.time ? `<span>${escapeHTML(task.time)}</span>` : ''}<span class="tag ${categoryClass}">${escapeHTML(cat)}</span>${!compact ? `<span>${escapeHTML(task.date || '')}</span>` : ''}</div></div><button class="text-button" data-action="edit-task" data-id="${escapeHTML(task.id)}" aria-label="Görevi düzenle" title="Düzenle">✎</button><button class="text-button" data-action="delete-task" data-id="${escapeHTML(task.id)}" aria-label="Görevi sil" title="Sil">×</button></div>`;
  }
  function emptyState(title, detail, icon = '✳') { return `<div class="empty-state"><div class="empty-icon">${icon}</div><b>${escapeHTML(title)}</b><br>${escapeHTML(detail)}</div>`; }
  function progressBar(done, total) { const pct = total ? Math.round(done / total * 100) : 0; return `<div class="progress-line"><span style="width:${pct}%"></span></div><div class="progress-label">${done}/${total} tamamlandı · %${pct}</div>`; }
  function routineBlock(key, title, subtitle) {
    const items = state.routines[key] || [];
    const checks = state.routineChecks[today()]?.[key] || [];
    const done = items.filter(item => checks.includes(item)).length;
    return `<div class="card"><div class="card-header"><div><h3>${title}</h3><div class="subtle">${subtitle}</div></div><span class="tag">${done}/${items.length}</span></div><div>${items.map(item => `<label class="routine-item"><input class="check" type="checkbox" data-action="routine-check" data-routine="${key}" data-item="${escapeHTML(item)}" ${checks.includes(item) ? 'checked' : ''}><span>${escapeHTML(item)}</span></label>`).join('')}</div>${progressBar(done, items.length)}</div>`;
  }
  function renderBugün() {
    const todaysTasks = getTasksForDate(today()).sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99'));
    const planOccurrences = recurringForDate(new Date());
    const done = todaysTasks.filter(task => task.done).length + planOccurrences.filter(item => isRecurringDone(item,today())).length;
    const habits = state.habits.filter(habit => habit.active !== false);
    const checks = state.habitChecks[today()] || [];
    const habitsDone = habits.filter(habit => checks.includes(habit.id)).length;
    return `<div class="grid grid-two"><div class="grid"><div class="hero-card card"><div class="eyebrow">GÜNÜN, SENİN TEMPON</div><h2>Her şeyi yapmak zorunda değilsin.<br>Bir yerden başla.</h2><p>Planlarını toplamak, önemli olanı fark etmek ve kendine alan açmak için sakin bir yer.</p><button class="button button-primary" data-action="open-task">＋ Görev ekle</button></div><div class="stat-row"><div class="stat-card"><span class="stat-number">${todaysTasks.length}</span><span class="stat-label">Bugünün görevleri</span></div><div class="stat-card"><span class="stat-number">${done}</span><span class="stat-label">Tamamlandı</span></div><div class="stat-card"><span class="stat-number">${habitsDone}/${habits.length}</span><span class="stat-label">Alışkanlıklar</span></div></div><div class="card"><div class="card-header"><h3>Bugünün planı</h3><button class="text-button" data-view="tasks">Tüm görevler ↗</button></div>${todaysTasks.length || planOccurrences.length ? `<div class="task-list">${todaysTasks.map(task => taskRow(task, true)).join('')}${planOccurrences.map(item => recurringRow(item,new Date())).join('')}</div>` : emptyState('Bugün için biraz boşluk','Henüz plan yok. Zaman ayırmak istediğin bir şey ekleyebilirsin.','☁️')}</div></div><div class="grid">${routineBlock('morning','Sabah rutini','Güne niyetle başla')}${routineBlock('evening','Akşam rutini','Günün sakinleşmesine izin ver') }<div class="card"><div class="card-header"><h3>Günlük durum</h3><span class="tag">Bugün</span></div><p class="subtle">Şu anda kendini nasıl hissediyorsun?</p>${moodPicker()}<button class="text-button" data-view="wellbeing">Mola seçenekleri ↗</button></div></div></div>`;
  }
  function moodPicker() {
    const moods = [{ id: 'calm', icon: '😌', label: 'Sakin' }, { id: 'good', icon: '🙂', label: 'İdare eder' }, { id: 'tired', icon: '😴', label: 'Yorgun' }, { id: 'anxious', icon: '😟', label: 'Kaygılı' }, { id: 'low', icon: '🌧️', label: 'Keyifsiz' }];
    return `<div class="mood-grid">${moods.map(mood => `<button class="mood-option ${moodChoice === mood.id ? 'selected' : ''}" data-action="mood" data-mood="${mood.id}" aria-pressed="${moodChoice === mood.id}">${mood.icon}<span>${mood.label}</span></button>`).join('')}</div>`;
  }
  function renderTasks() {
    let tasks = [...state.tasks].sort((a, b) => a.date.localeCompare(b.date) || (a.time || '99:99').localeCompare(b.time || '99:99'));
    if (taskFilter === 'open') tasks = tasks.filter(task => !task.done);
    if (taskFilter === 'done') tasks = tasks.filter(task => task.done);
    if (taskFilter === 'today') tasks = tasks.filter(task => task.date === today());
    if (taskSearch.trim()) tasks = tasks.filter(task => `${task.title} ${task.category}`.toLocaleLowerCase('tr-TR').includes(taskSearch.toLocaleLowerCase('tr-TR')));
    return `<div class="section-heading"><div><h2>Tüm görevlerin</h2><p>Basit tut. Görevlerini başka bir güne taşıyabilirsin.</p></div><button class="button button-primary" data-action="open-task">＋ Görev ekle</button></div><div class="card"><div class="form-inline" style="margin-bottom:14px"><input class="field" id="task-search" placeholder="Görevlerinde ara…" value="${escapeHTML(taskSearch)}" aria-label="Görevlerde ara"></div><div class="filters">${[['all','Tüm görevler'],['today','Bugün'],['open','Yapılacak'],['done','Tamamlandı']].map(([id,label]) => `<button class="filter-button ${taskFilter === id ? 'active' : ''}" data-action="task-filter" data-filter="${id}">${label}</button>`).join('')}</div>${tasks.length ? `<div class="task-list">${tasks.map(task => taskRow(task)).join('')}</div>` : emptyState('Şimdilik burada bir şey yok','Başka bir filtre dene veya başlamak için görev ekle.','☷')}</div>`;
  }
  function renderHabits() {
    const checks = state.habitChecks[today()] || [];
    const habits = state.habits.filter(habit => habit.active !== false);
    return `<div class="grid grid-two"><div class="card"><div class="card-header"><div><h3>Günlük alışkanlıkların</h3><p class="subtle">Şefkatle tekrarlanan küçük adımlar.</p></div><span class="tag">${checks.filter(id => habits.some(h => h.id === id)).length}/${habits.length}</span></div>${habits.length ? `<div class="habit-grid">${habits.map(habit => `<label class="habit-card"><input class="check" type="checkbox" data-action="habit-check" data-id="${escapeHTML(habit.id)}" ${checks.includes(habit.id) ? 'checked' : ''}><span style="font-size:22px">${escapeHTML(habit.icon || '✳')}</span><span class="habit-copy"><span class="habit-name">${escapeHTML(habit.name)}</span><span class="habit-meta">${checks.includes(habit.id) ? 'Bugün tamamlandı' : 'Küçük bir adım'}${habitStreak(habit.id) >= 2 ? ` · 🔥 ${habitStreak(habit.id)} gün üst üste` : ''}</span></span><button type="button" class="text-button" data-action="delete-habit" data-id="${escapeHTML(habit.id)}" aria-label="Alışkanlığı kaldır">×</button></label>`).join('')}</div>` : emptyState('Küçük bir alışkanlıkla başla','Tekrar dönmek istediğin bir şey ekle.')}<div style="margin-top:18px">${progressBar(checks.filter(id => habits.some(h => h.id === id)).length, habits.length)}</div></div><div class="grid">${routineBlock('morning','Sabah rutini','Yumuşak bir başlangıç')}${routineBlock('evening','Akşam rutini','Günü yumuşakça bitir')}<div class="card"><h3>Alışkanlık ekle</h3><form id="habit-form" class="form-inline"><input class="field" name="name" maxlength="70" required placeholder="ör. 5 dakika esneme"><button class="button button-primary" type="submit">Ekle</button></form><p class="tiny" style="margin-top:10px">İşaretler her gün sıfırlanır; önceki günler kayıtlı kalır ve seriler bu kayıtlardan hesaplanır.</p></div></div></div>`;
  }
  function renderWellbeing() {
    return `<div class="grid grid-two"><div class="card"><div class="card-header"><h3>Nasıl hissediyorsun?</h3><span class="tag">Günlük durum</span></div><p class="subtle">Doğru bir cevap yok. Sadece şu an ne olduğunu fark et.</p>${moodPicker()}<p class="subtle" style="margin-top:14px">${moodChoice ? 'Bugünkü durumun kaydedildi.' : 'Sana en yakın gelen duyguyu seç.'}</p></div><div class="card"><div class="eyebrow">BİR NEFESLİK MOLA</div><h2 style="margin-bottom:12px">Nefesine geri dön.</h2><p class="subtle">Omuzlarını gevşet. Altındaki desteği hisset. Yavaşça nefes al, nefes verişini biraz daha uzun tut.</p><div style="display:flex;justify-content:center;padding:20px"><div id="breath-circle" style="width:135px;height:135px;border-radius:50%;background:#e2eadf;display:grid;place-items:center;text-align:center;color:#607b65;font-family:Georgia,serif;font-size:18px;box-shadow:0 0 0 12px #e2eadf55">Yavaşça<br>nefes al</div></div><div style="text-align:center"><button class="button button-primary" data-action="breathing">1 dakikalık molayı başlat</button><p class="tiny" style="margin-top:10px">Şimdiye kadar ${state.breathingCount || 0} mola tamamlandı</p></div></div><div class="card"><h3>Nazik hatırlatmalar</h3><div class="idea-list"><div class="idea-row"><span>☁️</span><p>Her şeyi tek tek ele alabilirsin.</p></div><div class="idea-row"><span>🌿</span><p>Dinlenmek hak edilmesi gereken bir ödül değil; ritmin bir parçası.</p></div><div class="idea-row"><span>♡</span><p>Bir duyguyu hemen düzeltmeye çalışmadan da fark edebilirsin.</p></div></div></div></div>`;
  }
  const journalPrompts = ['Bugün zihnimde en çok yer kaplayan ne?','Bugünü küçük de olsa anlamlı kılacak şey ne olurdu?','Neye daha çok ihtiyacım var, neyi nazikçe bırakabilirim?','Bu andan hatırlamak istediğim bir şey ne?','Bugün kendimi en çok nerede kendim gibi hissettim?'];
  function renderJournal() {
    const entry = state.journal[journalDate] || { text: '', prompt: '' };
    return `<div class="grid grid-two"><div class="card"><div class="card-header"><div><h3>Günlüğün</h3><p class="subtle">Kendini düzeltmeden yazabileceğin bir yer.</p></div><span class="tag">Özel</span></div><label class="label" for="journal-date">Kayıt tarihi</label><input class="field" id="journal-date" type="date" value="${escapeHTML(journalDate)}" style="margin-bottom:16px;max-width:220px"><div class="journal-prompt">${escapeHTML(entry.prompt || journalPrompts[0])}</div><button class="text-button" data-action="new-prompt">↻ Başka bir soru</button><textarea id="journal-text" class="field textarea" placeholder="Neredeysen oradan başla…">${escapeHTML(entry.text || '')}</textarea><div class="split-heading" style="margin-top:13px"><span class="tiny">Yazdıkça otomatik kaydedilir.</span><button class="button button-primary" data-action="save-journal">Kaydet</button></div></div><div class="card"><h3>Önceki yazılar</h3>${Object.keys(state.journal).filter(date => state.journal[date]?.text?.trim()).sort((a,b)=>b.localeCompare(a)).length ? `<div class="idea-list">${Object.keys(state.journal).filter(date => state.journal[date]?.text?.trim()).sort((a,b)=>b.localeCompare(a)).map(date => `<button class="idea-row" style="text-align:left;background:transparent;color:inherit;width:100%" data-action="open-journal" data-date="${date}"><span>✎</span><p><b>${escapeHTML(date)}</b><br><span class="subtle">${escapeHTML(state.journal[date].text.slice(0,100))}${state.journal[date].text.length>100?'…':''}</span></p><span>↗</span></button>`).join('')}</div>` : emptyState('Yazıların burada birikecek','Hazır olduğunda ilk kaydını ekle.','✎')}</div></div>`;
  }
  function renderCareer() {
    return `<div class="grid grid-two"><div class="card"><div class="card-header"><div><h3>Öğrenme notları</h3><p class="subtle">Keşfettiğin şeylerin kaydını tut.</p></div><span class="tag blue">Kariyer</span></div><textarea id="career-notes" class="field textarea" placeholder="Kurslar, fikirler, sorular, öğrendiklerim…">${escapeHTML(state.careerNotes || '')}</textarea><div class="split-heading" style="margin-top:13px"><span class="tiny">Yazdıkça otomatik kaydedilir.</span><button class="button button-primary" data-action="save-career">Notları kaydet</button></div></div><div class="card"><h3>Öğrenmeyi somutlaştır</h3><p class="subtle">Geniş bir niyeti küçük bir sonraki adıma dönüştür. Haftanda yeri olsun diye görev olarak ekle.</p><button class="button button-outline" data-action="open-task" data-category="Kariyer">＋ Öğrenme görevi ekle</button><div style="margin-top:24px"><div class="eyebrow">BİRKAÇ SORU</div><div class="idea-list"><div class="idea-row"><span>01</span><p>Şu anda neyi merak ediyorum?</p></div><div class="idea-row"><span>02</span><p>Bu hafta deneyebileceğim en küçük şey ne?</p></div><div class="idea-row"><span>03</span><p>Sadece okuyarak değil, yaparak ne öğrendim?</p></div></div></div></div></div>`;
  }
  function renderGoals() {
    return `<div class="section-heading"><div><h2>Büyümek istediğim yönler</h2><p>Hedefler son tarih değil, yön olabilir.</p></div></div><div class="grid grid-three">${state.goals.map(goal => `<div class="card goal-card"><div class="eyebrow">GELİŞMEK İSTEDİĞİM YÖN</div><h3 style="font-family:Georgia,serif;font-size:20px;line-height:1.3">${escapeHTML(goal.title)}</h3><p class="subtle">${escapeHTML(goal.detail || '')}</p><div class="goal-progress"><div class="split-heading"><span>İlerleme</span><b>${Number(goal.progress)||0}%</b></div><div class="progress-line"><span style="width:${Math.max(0,Math.min(100,Number(goal.progress)||0))}%"></span></div></div><div class="goal-actions"><button class="button button-quiet small-button" data-action="goal-progress" data-id="${escapeHTML(goal.id)}" data-delta="-10">−10%</button><button class="button button-outline small-button" data-action="goal-progress" data-id="${escapeHTML(goal.id)}" data-delta="10">+10%</button><button class="text-button" data-action="delete-goal" data-id="${escapeHTML(goal.id)}">Kaldır</button></div></div>`).join('')}<div class="card"><h3>Hedef ekle</h3><form id="goal-form"><div class="field-group"><label class="label">Hedef</label><input class="field" name="title" required maxlength="90" placeholder="Benim için ne önemli?"></div><div class="field-group"><label class="label">Biraz bağlam (isteğe bağlı)</label><input class="field" name="detail" maxlength="160" placeholder="Bu neden önemli…"></div><button class="button button-primary" type="submit">＋ Hedef ekle</button></form></div></div>`;
  }
  function renderListModule(title, subtitle, list, inputPlaceholder, kind) {
    const isHome = kind === 'home';
    const rows = list.map(item => `<div class="idea-row"><input class="check" type="checkbox" data-action="toggle-${kind}" data-id="${escapeHTML(item.id)}" ${item.done ? 'checked' : ''} aria-label="Tamamlandı olarak işaretle"><p class="${item.done ? 'completed' : ''}" style="${item.done ? 'text-decoration:line-through;color:#9ba39a' : ''}">${escapeHTML(item.text)}</p><button class="remove" data-action="delete-${kind}" data-id="${escapeHTML(item.id)}" aria-label="Kaldır">×</button></div>`).join('');
    return `<div class="grid grid-two"><div class="card"><div class="card-header"><div><h3>${title}</h3><p class="subtle">${subtitle}</p></div><span class="tag">${list.filter(item => !item.done).length} kaldı</span></div>${list.length ? `<div class="idea-list">${rows}</div>` : emptyState(isHome ? 'Aklında tutman gereken daha az şey' : 'Yerleri ve olasılıkları biriktir','Aşağıya bir fikir ekle, hazır olduğunda geri dön.',isHome?'⌂':'⌁')}<form id="${kind}-form" class="form-inline" style="margin-top:17px"><input class="field" name="text" maxlength="180" required placeholder="${inputPlaceholder}"><button class="button button-primary" type="submit">Ekle</button></form></div><div class="card"><div class="eyebrow">NAZİK BİR HATIRLATMA</div><h2>${isHome ? 'Bitmiş, mükemmelden iyidir.' : 'Merakın yol göstersin.'}</h2><p class="subtle" style="margin-top:12px">${isHome ? 'Bugün her şeyi bitirmek zorunda değilsin. Yarını kolaylaştıracak küçük bir şey seç.' : 'Bir seyahat fikrinin hemen plana dönüşmesi gerekmez. Olasılıkları bulabileceğin bir yerde tut.'}</p>${isHome ? `<button class="button button-outline" data-action="open-task" data-category="Ev">＋ Bir iş planla</button>` : `<button class="button button-outline" data-action="open-task" data-category="Seyahat">＋ Seyahat görevi ekle</button>`}</div></div>`;
  }
  const WEEKDAYS = ['Pazar','Pazartesi','Salı','Çarşamba','Perşembe','Cuma','Cumartesi'];
  const MONTHS = ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];
  function isoLocal(date) { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; }
  function recurringDueOn(item, date) {
    if (item.cadence === 'once') return isoLocal(date) === item.date;
    if (item.cadence === 'weekly') return date.getDay() === Number(item.weekday);
    const wantedDay = Number(item.dayOfMonth);
    const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    return date.getDate() === Math.min(wantedDay, lastDay);
  }
  function recurringForDate(date) { return state.recurringTasks.filter(item => recurringDueOn(item, date)); }
  function isRecurringDone(item, dateKey) { return (item.completedDates || []).includes(dateKey); }
  function recurringRow(item, date) {
    const dateKey = isoLocal(date), done = isRecurringDone(item, dateKey);
    const schedule = item.cadence === 'once' ? 'Tek seferlik' : item.cadence === 'weekly' ? `Her hafta ${WEEKDAYS[Number(item.weekday)]}` : `Her ayın ${item.dayOfMonth}. günü`;
    return `<div class="task-row ${done ? 'completed' : ''}"><input class="check" type="checkbox" data-action="toggle-recurring" data-id="${escapeHTML(item.id)}" data-date="${dateKey}" ${done ? 'checked' : ''} aria-label="${escapeHTML(item.title)} – ${dateKey}: tamamlandı olarak işaretle"><div class="task-main"><div class="task-name">${escapeHTML(item.title)}</div><div class="task-meta"><span>${prettyDate(date, { weekday: 'short', month: 'short', day: 'numeric' })}</span>${item.time ? `<span>${escapeHTML(item.time)}</span>` : ''}<span class="tag">${schedule}</span><span class="tag">${escapeHTML(normCategory(item.category))}</span></div></div><button class="text-button" data-action="delete-recurring" data-id="${escapeHTML(item.id)}" aria-label="Planı sil">×</button></div>`;
  }
  function renderRecurring() {
    const y = recurringMonth.getFullYear(), m = recurringMonth.getMonth();
    const firstDay = new Date(y, m, 1), daysInMonth = new Date(y, m + 1, 0).getDate();
    const monthLabel = `${MONTHS[m]} ${y}`;
    let occurrenceCount = 0, completedCount = 0;
    const occurrences = [];
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(y, m, day);
      recurringForDate(date).forEach(item => { occurrenceCount++; if (isRecurringDone(item, isoLocal(date))) completedCount++; occurrences.push({ item, date }); });
    }
    const modeButtons = `<div class="filters"><button class="filter-button ${recurringMode === 'list' ? 'active' : ''}" data-action="recurring-mode" data-mode="list">☷ Liste</button><button class="filter-button ${recurringMode === 'calendar' ? 'active' : ''}" data-action="recurring-mode" data-mode="calendar">▦ Takvim</button></div>`;
    const calendar = `<div class="calendar-grid calendar-weekdays">${['Pzt','Sal','Çar','Per','Cum','Cmt','Paz'].map(day => `<div>${day}</div>`).join('')}</div><div class="calendar-grid">${Array.from({length:(firstDay.getDay()+6)%7}, () => '<div class="calendar-day blank"></div>').join('')}${Array.from({length:daysInMonth}, (_, i) => { const date = new Date(y,m,i+1), key = isoLocal(date), due = recurringForDate(date); return `<div class="calendar-day ${key === today() ? 'is-today' : ''}"><div class="calendar-day-number">${i+1}</div>${due.slice(0,3).map(item => `<label class="calendar-event ${isRecurringDone(item,key) ? 'is-done' : ''}" title="${escapeHTML(item.title)}"><input type="checkbox" data-action="toggle-recurring" data-id="${escapeHTML(item.id)}" data-date="${key}" ${isRecurringDone(item,key) ? 'checked' : ''}><span>${escapeHTML(item.title)}</span></label>`).join('')}${due.length > 3 ? `<small class="subtle">+${due.length-3} daha</small>` : ''}</div>`; }).join('')}</div>`;
    const list = occurrences.length ? `<div class="task-list">${occurrences.map(({item,date}) => recurringRow(item,date)).join('')}</div>` : emptyState('Bu ay için plan yok','Burada görmek için aşağıdan bir plan ekle.','▦');
    return `<div class="section-heading"><div><h2>Haftalık ve aylık planlar</h2><p>Tek seferlik ya da tekrarlanan planlarını listede veya takvimde takip et.</p></div><span class="tag">${completedCount}/${occurrenceCount} bu ay tamamlandı</span></div><div class="card recurring-card"><div class="card-header"><div><h3>${monthLabel}</h3><p class="subtle">Haftalık planlar seçtiğin gün, aylık planlar seçtiğin tarihte tekrarlanır.</p></div><div class="month-controls"><button class="button button-outline small-button" data-action="recurring-month" data-delta="-1" aria-label="Önceki ay">←</button><button class="button button-outline small-button" data-action="recurring-month" data-delta="1" aria-label="Sonraki ay">→</button></div></div>${modeButtons}${recurringMode === 'calendar' ? calendar : list}</div><div class="card" style="margin-top:17px"><div class="card-header"><div><h3>Plan ekle</h3><p class="subtle">Örnek: cumartesi evi temizle, ayın 1'inde kirayı öde.</p></div></div><form id="recurring-form"><div class="field-group"><label class="label" for="recurring-title">Görev adı</label><input class="field" id="recurring-title" name="title" required maxlength="140" placeholder="Neyi planlamak istiyorsun?"></div><div class="form-row"><div class="field-group"><label class="label" for="recurring-cadence">Tekrar</label><select class="field" id="recurring-cadence" name="cadence"><option value="once">Tek seferlik</option><option value="weekly">Her hafta</option><option value="monthly">Her ay</option></select></div><div class="field-group"><label class="label" for="recurring-category">Kategori</label><select class="field" id="recurring-category" name="category"><option>Kişisel</option><option>Kariyer</option><option>İyi oluş</option><option>Ev</option><option>Hareket</option><option>Seyahat</option></select></div></div><div class="form-row"><div class="field-group"><label class="label" for="recurring-date">Tarih (tek seferlik)</label><input class="field" id="recurring-date" name="date" type="date" value="${today()}"></div><div class="field-group"><label class="label" for="recurring-time">Saat (isteğe bağlı)</label><input class="field" id="recurring-time" name="time" type="time"></div></div><div class="form-row"><div class="field-group"><label class="label" for="recurring-weekday">Haftanın günü</label><select class="field" id="recurring-weekday" name="weekday">${WEEKDAYS.map((day,i) => `<option value="${i}" ${i===6?'selected':''}>${day}</option>`).join('')}</select></div><div class="field-group"><label class="label" for="recurring-day">Ayın günü</label><select class="field" id="recurring-day" name="dayOfMonth">${Array.from({length:31},(_,i)=>`<option value="${i+1}" ${i===0?'selected':''}>${i+1}.</option>`).join('')}</select></div></div><button class="button button-primary" type="submit">＋ Planı kaydet</button></form></div>`;
  }
  function renderFitness() {
    return `<div class="grid grid-two"><div class="card"><div class="card-header"><div><h3>Hareket ve beslenme notları</h3><p class="subtle">Örüntüleri, enerjini ve sana iyi geleni fark et.</p></div><span class="tag warm">Notların</span></div><textarea id="fitness-notes" class="field textarea" placeholder="Hareket, öğünler, enerji, toparlanma, fikirler…">${escapeHTML(state.fitnessNotes || '')}</textarea><div class="split-heading" style="margin-top:13px"><span class="tiny">Yazdıkça otomatik kaydedilir.</span><button class="button button-primary" data-action="save-fitness">Notları kaydet</button></div></div><div class="card"><h3>Küçük bir plan yap</h3><p class="subtle">Bir yürüyüş, biraz esneme ya da besleyici bir şey hazırlamak yeterli bir sonraki adım olabilir.</p><div class="idea-list"><button class="idea-row" style="text-align:left;background:transparent;color:inherit;width:100%" data-action="quick-fitness" data-title="15 dakika hareket et"><span>🌿</span><p>15 dakika hareket et</p><span>＋</span></button><button class="idea-row" style="text-align:left;background:transparent;color:inherit;width:100%" data-action="quick-fitness" data-title="Besleyici bir şey hazırla"><span>🥣</span><p>Besleyici bir şey hazırla</p><span>＋</span></button><button class="idea-row" style="text-align:left;background:transparent;color:inherit;width:100%" data-action="quick-fitness" data-title="Toparlanmaya zaman ayır"><span>☁️</span><p>Toparlanmaya zaman ayır</p><span>＋</span></button></div></div></div>`;
  }
  function renderSettings() {
    const cloud = prefs.firebase || {};
    return `<div class="grid grid-two"><div class="card"><div class="card-header"><h3>Verilerin ve gizliliğin</h3><span class="tag">${prefs.firebase ? 'Cihaz + bulut' : 'Yalnızca cihazda'}</span></div><p class="subtle">Görevlerin, günlüğün ve notların bu tarayıcıda, bu cihazda saklanır. Bulut eşitlemesini ayrıca kurabilirsin.</p><div class="settings-box"><div class="settings-row"><div><b>Yedeği dışa aktar</b><p>Yaşam Planlayıcım verilerini içeren JSON yedek dosyasını indir.</p></div><button class="button button-primary" data-action="export">JSON yedeği indir</button></div><div class="settings-row"><div><b>Yedeği içe aktar</b><p>Önceden aldığın JSON yedeğini geri yükle. Bu işlem bu tarayıcıdaki verilerin yerine geçer.</p></div><button class="button button-outline" data-action="import">Dosya seç</button></div><div class="settings-row"><div><b>Bu cihazdaki verileri sıfırla</b><p>Bu tarayıcıda kayıtlı uygulama verilerini sil. Gerekirse önce yedek al.</p></div><button class="button button-outline danger" data-action="reset">Verileri sıfırla</button></div></div></div><div class="grid"><div class="card"><div class="eyebrow">UYGULAMA DURUMU</div><h2>Kendi tempon için tasarlandı.</h2><p class="subtle" style="margin-top:12px">Uygulama ilk çevrimiçi açılıştan sonra çevrimdışı da açılabilir. iPhone veya bilgisayara eklemek için HTTPS yayın adresini kullan.</p><div class="idea-list"><div class="idea-row"><span>✓</span><p>Görevler, rutinler, alışkanlıklar ve notlar</p></div><div class="idea-row"><span>✓</span><p>Yerel kayıt ve JSON yedeği</p></div><div class="idea-row"><span>✓</span><p>Ana ekrana eklenebilir uygulama</p></div><div class="idea-row"><span>${firebaseReady ? '✓' : '!'}</span><p>${firebaseReady ? 'Cihazlar arası eşitleme açık' : prefs.firebase ? 'Eşitleme ayarlı, bağlantı bekleniyor' : 'Cihazlar arası eşitleme kapalı'}</p></div></div></div><div class="notice"><b>Yedek almayı unutma.</b> Tarayıcı verileri silinebilir. Özellikle cihaz veya tarayıcı değiştirmeden önce düzenli olarak yedek al.</div></div></div><div class="card"><div class="card-header"><h3>Renk paleti</h3><span class="tag">Kişiselleştir</span></div><p class="subtle">Uygulamanın görünümünü seç.</p><div class="palette-options">${Object.entries({sage:'Adaçayı',terracotta:'Krem ve toprak',lavender:'Lavanta',ocean:'Okyanus'}).map(([key,label])=>`<button class="palette-choice ${((prefs.palette||'terracotta')===key)?'selected':''}" data-action="palette" data-palette="${key}"><span class="palette-dots">${PALETTES[key].slice(0,4).map(c=>`<i style="background:${c}"></i>`).join('')}</span><b>${label}</b></button>`).join('')}</div></div><div class="card"><div class="card-header"><h3>Cihazlar arasında eşitleme</h3><span class="tag">Bulut kurulumu</span></div><p class="subtle">Hesap açmadan eşitleme için bir Firebase projesi gerekir. Proje bilgilerini ve iki cihazda da kullanacağın gizli eşitleme kodunu gir.</p><div class="field-group"><label class="label" for="sync-paste">Hızlı kurulum</label><textarea class="field" id="sync-paste" rows="3" placeholder="Firebase’deki firebaseConfig kodunu ya da diğer cihazdan kopyaladığın kurulum kodunu buraya yapıştır"></textarea><button class="button button-outline small-button" type="button" data-action="sync-fill" style="margin-top:8px">Alanları doldur</button></div><form id="sync-form"><div class="field-group"><label class="label">API anahtarı</label><input class="field" name="apiKey" value="${escapeHTML(cloud.apiKey||'')}" required></div><div class="field-group"><label class="label">Proje kimliği</label><input class="field" name="projectId" value="${escapeHTML(cloud.projectId||'')}" required></div><div class="field-group"><label class="label">Kimlik doğrulama alan adı</label><input class="field" name="authDomain" value="${escapeHTML(cloud.authDomain||'')}" placeholder="proje.firebaseapp.com" required></div><div class="field-group"><label class="label">Realtime Database URL</label><input class="field" name="databaseURL" value="${escapeHTML(cloud.databaseURL||'')}" placeholder="https://proje-default-rtdb.europe-west1.firebasedatabase.app" required></div><div class="field-group"><label class="label">Uygulama kimliği</label><input class="field" name="appId" value="${escapeHTML(cloud.appId||'')}" required></div><div class="field-group"><label class="label">Gizli eşitleme kodu (iki cihazda aynı)</label><input class="field" name="room" value="${escapeHTML(cloud.room||'')}" minlength="20" placeholder="En az 20 karakterlik tahmin edilmesi zor bir kod" required><button class="button button-quiet small-button" type="button" data-action="sync-gen" style="margin-top:8px">Rastgele kod oluştur</button></div><button class="button button-primary" type="submit">Eşitlemeyi bağla</button><button class="button button-outline" type="button" data-action="sync-disconnect">Bağlantıyı kes</button>${cloud.room ? `<button class="button button-outline" type="button" data-action="sync-copy">Diğer cihaz için kurulum kodunu kopyala</button>` : ''}</form><p class="tiny">Önemli: Firebase konsolunda Anonymous Authentication ve Realtime Database'i etkinleştirmelisin. Kurulum rehberi ZIP içindeki KURULUM-TR.md dosyasında. Eşitleme kodunu kimseyle paylaşma; bulut kullanımı verilerini yalnızca cihazında tutmaz.</p><div id="sync-status" class="subtle">${firebaseReady ? 'Bağlı: veriler bu kodla eşitleniyor.' : cloud.room ? 'Kayıtlı eşitleme ayarı var, bağlantı kuruluyor ya da kurulamadı.' : 'Henüz eşitleme kurulmadı.'}</div></div>`;
  }
  function render() {
    setHeader();
    const renderers = { today: renderBugün, tasks: renderTasks, recurring: renderRecurring, habits: renderHabits, wellbeing: renderWellbeing, journal: renderJournal, career: renderCareer, goals: renderGoals, home: () => renderListModule('Ev ve işler','Günlük hayatı hafifleten küçük işler.',state.homeItems,'Bir iş veya ev görevi ekle…','home'), travel: () => renderListModule('Seyahat fikirleri','Keşfedilecek yerler, rotalar ve deneyimler.',state.travelIdeas,'Bir yer veya seyahat fikri ekle…','travel'), fitness: renderFitness, settings: renderSettings };
    view.innerHTML = (renderers[currentView] || renderBugün)();
    if (currentView === 'tasks') { const search = $('#task-search'); if (search) { search.addEventListener('input', () => { const pos = search.selectionStart; taskSearch = search.value; const scroll = window.scrollY; render(); const next = $('#task-search'); next?.focus(); next?.setSelectionRange(pos, pos); window.scrollTo(0, scroll); }); } }
  }
  let editingTaskId = null;
  function openTaskDialog(category, task) {
    $('#task-form').reset(); editingTaskId = task ? task.id : null;
    $('#task-dialog-title').textContent = task ? 'Görevi düzenle' : 'Görev ekle';
    $('#task-submit').textContent = task ? 'Değişiklikleri kaydet' : 'Görevi kaydet';
    $('#task-title').value = task ? task.title : '';
    $('#task-date').value = task ? safeDate(task.date) : today();
    $('#task-time').value = task ? (task.time || '') : '';
    $('#task-category').value = normCategory(task ? task.category : category);
    if (typeof dialog.showModal === 'function') dialog.showModal(); else if (!task) { const title = prompt('Görev adı?'); if (title?.trim()) addTask({ title: title.trim(), category: normCategory(category), date: today(), time: '' }); }
    setTimeout(() => $('#task-title').focus(), 50);
  }
  function addTask(data) { state.tasks.push({ id: uid(), title: data.title, category: normCategory(data.category), date: safeDate(data.date), time: data.time || '', done: false, createdAt: new Date().toISOString() }); saveState(); render(); showToast('Görev planına eklendi.'); }
  function scheduleCloudSave() { if (!prefs.firebase || !firebaseReady || remoteApplying) return; clearTimeout(syncDebounce); syncDebounce=setTimeout(()=>{ try { window.__lifePlannerSyncRef?.set({ state, updatedAt: Number(localStorage.getItem(STORE_KEY+'_updated')) || Date.now() }).catch(err=>showToast('Buluta kaydedilemedi: bağlantıyı kontrol et.')); } catch(e) { console.warn(e); } },500); }
  async function connectCloud(showMessage=false) {
    const c=prefs.firebase; if(!c || !c.apiKey || !c.projectId || !c.databaseURL || !c.room) return;
    try {
      await loadFirebase();
      window.__lifePlannerSyncRef?.off();
      if(!firebase.apps.length) firebase.initializeApp({apiKey:c.apiKey,authDomain:c.authDomain, databaseURL:c.databaseURL, projectId:c.projectId, appId:c.appId});
      await firebase.auth().signInAnonymously();
      const safeRoom=c.room.replace(/[^a-zA-Z0-9_-]/g,''); if(safeRoom.length<20) throw new Error('Eşitleme kodu en az 20 karakter olmalı.');
      const ref=firebase.database().ref('lifePlannerRooms/'+safeRoom); window.__lifePlannerSyncRef=ref; firebaseReady=true;
      ref.on('value', snap=>{ const remote=snap.val(); if(!remote || !remote.state) { scheduleCloudSave(); return; } const localTime=Number(localStorage.getItem(STORE_KEY+'_updated')||0); if(Number(remote.updatedAt||0)>localTime) { remoteApplying=true; state=normalizeState(remote.state, true); localStorage.setItem(STORE_KEY,JSON.stringify(state)); localStorage.setItem(STORE_KEY+'_updated',String(remote.updatedAt||Date.now())); moodChoice=state.mood[today()]||''; render(); remoteApplying=false; } else if(Number(remote.updatedAt||0)<localTime || localTime===0) { scheduleCloudSave(); } });
      if (currentView === 'settings') render();
      if(showMessage) showToast('Bulut eşitlemesi bağlandı. Diğer cihazda aynı ayarları gir.');
    } catch(err) { firebaseReady=false; console.error(err); showToast('Bağlantı kurulamadı. Firebase ayarlarını ve kurulum rehberini kontrol et.'); }
  }
  function exportData() {
    const blob = new Blob([JSON.stringify({ app: 'Yaşam Planlayıcım', version: 1, exportedAt: new Date().toISOString(), data: state }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `yasam-planlayicim-yedek-${today()}.json`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); showToast('Yedek indirildi. Güvenli bir yerde sakla.');
  }
  function importData(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result); const imported = parsed.data || parsed;
        if (!imported || typeof imported !== 'object' || !Array.isArray(imported.tasks) || !Array.isArray(imported.habits)) throw new Error('Bu dosya bir Yaşam Planlayıcım yedeği gibi görünmüyor.');
        if (!confirm(`İçe aktarma, bu tarayıcıdaki mevcut verilerin yerine geçecek.${prefs.firebase ? ' Eşitleme açık olduğu için diğer cihazlardaki veriler de değişir.' : ''} Devam edilsin mi?`)) return;
        state = normalizeState(imported); saveState(); moodChoice = state.mood[today()] || ''; render(); showToast('Yedek içe aktarıldı.');
      } catch (error) { alert(`Bu dosya içe aktarılamadı. ${error.message || ''}`); }
    };
    reader.onerror = () => alert('Dosya okunamadı.'); reader.readAsText(file);
  }
  document.addEventListener('click', event => {
    const nav = event.target.closest('[data-view]');
    if (nav) { currentView = nav.dataset.view; $('#sidebar')?.classList.remove('open'); $('.sidebar')?.classList.remove('open'); render(); return; }
    const button = event.target.closest('[data-action]'); if (!button) return;
    const { action, id } = button.dataset;
    if (action === 'open-task') { openTaskDialog(button.dataset.category); return; }
    if (action === 'palette') { prefs.palette=button.dataset.palette; localStorage.setItem(PREF_KEY,JSON.stringify(prefs)); applyPalette(prefs.palette); render(); return; }
    if (action === 'sync-gen') { const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'; const bytes = crypto.getRandomValues(new Uint8Array(32)); const field = $('#sync-form [name=room]'); if (field) field.value = [...bytes].map(b => chars[b % chars.length]).join(''); showToast('Kod oluşturuldu. Diğer cihazda da aynısını kullanacaksın.'); return; }
    if (action === 'sync-fill') { const raw = ($('#sync-paste')?.value || '').trim(); if (!raw) { showToast('Önce bir kod yapıştır.'); return; } const values = {}; const m = raw.match(/PLANLAYICI:([A-Za-z0-9+/=]+)/); if (m) { try { Object.assign(values, JSON.parse(atob(m[1]))); } catch { showToast('Kurulum kodu okunamadı.'); return; } } else { ['apiKey','authDomain','databaseURL','projectId','appId'].forEach(key => { const hit = raw.match(new RegExp(key + '["\\s]*:\\s*["\']([^"\']+)["\']')); if (hit) values[key] = hit[1]; }); } let count = 0; Object.entries(values).forEach(([key, value]) => { const field = $(`#sync-form [name="${key}"]`); if (field && typeof value === 'string') { field.value = value; count++; } }); showToast(count ? `${count} alan dolduruldu.${values.room ? ' Şimdi “Eşitlemeyi bağla”ya dokun.' : ''}` : 'Kodda tanınan bir alan bulunamadı.'); return; }
    if (action === 'sync-copy') { const code = 'PLANLAYICI:' + btoa(JSON.stringify(prefs.firebase || {})); const done = () => showToast('Kurulum kodu kopyalandı. Diğer cihazda “Hızlı kurulum” kutusuna yapıştır.'); if (navigator.clipboard?.writeText) navigator.clipboard.writeText(code).then(done).catch(() => prompt('Bu kodu kopyala:', code)); else prompt('Bu kodu kopyala:', code); return; }
    if (action === 'sync-disconnect') { if (window.__lifePlannerSyncRef) window.__lifePlannerSyncRef.off(); firebaseReady=false; prefs.firebase=null; localStorage.setItem(PREF_KEY,JSON.stringify(prefs)); render(); showToast('Bulut bağlantısı kesildi.'); return; }
    if (action === 'toggle-task') { const task = state.tasks.find(item => item.id === id); if (task) task.done = button.checked; saveState(); render(); return; }
    if (action === 'edit-task') { const task = state.tasks.find(item => item.id === id); if (task) openTaskDialog(null, task); return; }
    if (action === 'delete-task') { state.tasks = state.tasks.filter(item => item.id !== id); saveState(); render(); showToast('Görev silindi.'); return; }
    if (action === 'task-filter') { taskFilter = button.dataset.filter; render(); return; }
    if (action === 'recurring-mode') { recurringMode = button.dataset.mode; render(); return; }
    if (action === 'recurring-month') { recurringMonth = new Date(recurringMonth.getFullYear(), recurringMonth.getMonth() + Number(button.dataset.delta), 1); render(); return; }
    if (action === 'toggle-recurring') { const item = state.recurringTasks.find(entry => entry.id === id); if (item) { item.completedDates ||= []; const dateKey = button.dataset.date; item.completedDates = button.checked ? [...new Set([...item.completedDates, dateKey])] : item.completedDates.filter(value => value !== dateKey); } saveState(); render(); return; }
    if (action === 'delete-recurring') { state.recurringTasks = state.recurringTasks.filter(item => item.id !== id); saveState(); render(); showToast('Plan silindi.'); return; }
    if (action === 'routine-check') { const key = button.dataset.routine, item = button.dataset.item; state.routineChecks[today()] ||= { morning: [], evening: [] }; state.routineChecks[today()][key] ||= []; const list = state.routineChecks[today()][key]; state.routineChecks[today()][key] = button.checked ? [...new Set([...list, item])] : list.filter(value => value !== item); saveState(); render(); return; }
    if (action === 'habit-check') { state.habitChecks[today()] ||= []; state.habitChecks[today()] = button.checked ? [...new Set([...state.habitChecks[today()], id])] : state.habitChecks[today()].filter(value => value !== id); saveState(); render(); return; }
    if (action === 'delete-habit') { state.habits = state.habits.filter(habit => habit.id !== id); saveState(); render(); showToast('Alışkanlık silindi.'); return; }
    if (action === 'mood') { moodChoice = button.dataset.mood; state.mood[today()] = moodChoice; saveState(); render(); showToast('Günlük durum kaydedildi.'); return; }
    if (action === 'new-prompt') { const entry = state.journal[journalDate] || { text: '', prompt: '' }; let next = journalPrompts[Math.floor(Math.random() * journalPrompts.length)]; if (journalPrompts.length > 1 && next === entry.prompt) next = journalPrompts[(journalPrompts.indexOf(next) + 1) % journalPrompts.length]; entry.prompt = next; state.journal[journalDate] = entry; saveState(); render(); return; }
    if (action === 'save-journal') { state.journal[journalDate] = { ...(state.journal[journalDate] || {}), text: $('#journal-text')?.value || '', prompt: state.journal[journalDate]?.prompt || journalPrompts[0], updatedAt: new Date().toISOString() }; saveState(); render(); showToast('Günlük kaydedildi.'); return; }
    if (action === 'open-journal') { journalDate = button.dataset.date; currentView = 'journal'; render(); return; }
    if (action === 'save-career') { state.careerNotes = $('#career-notes')?.value || ''; saveState(); showToast('Öğrenme notları kaydedildi.'); return; }
    if (action === 'save-fitness') { state.fitnessNotes = $('#fitness-notes')?.value || ''; saveState(); showToast('Notlar kaydedildi.'); return; }
    if (action === 'goal-progress') { const goal = state.goals.find(item => item.id === id); if (goal) goal.progress = Math.max(0, Math.min(100, (Number(goal.progress) || 0) + Number(button.dataset.delta))); saveState(); render(); return; }
    if (action === 'delete-goal') { state.goals = state.goals.filter(item => item.id !== id); saveState(); render(); showToast('Hedef silindi.'); return; }
    if (action === 'toggle-home' || action === 'toggle-travel') { const list = action === 'toggle-home' ? state.homeItems : state.travelIdeas; const item = list.find(entry => entry.id === id); if (item) item.done = button.checked; saveState(); render(); return; }
    if (action === 'delete-home' || action === 'delete-travel') { const key = action === 'delete-home' ? 'homeItems' : 'travelIdeas'; state[key] = state[key].filter(item => item.id !== id); saveState(); render(); return; }
    if (action === 'export') { exportData(); return; }
    if (action === 'import') { $('#import-file').click(); return; }
    if (action === 'reset') { if (confirm(`Bu işlem bu tarayıcıdaki Yaşam Planlayıcım verilerini kalıcı olarak siler.${prefs.firebase ? ' Eşitleme açık olduğu için diğer cihazlardaki veriler de sıfırlanır.' : ''} Saklamak istiyorsan önce yedeği dışa aktar. Emin misin?`)) { state = defaultState(); moodChoice = ''; saveState(); render(); showToast('Bu cihazdaki veriler sıfırlandı.'); } return; }
    if (action === 'quick-fitness') { openTaskDialog('Hareket'); setTimeout(() => { const title = $('#task-title'); if (title) title.value = button.dataset.title || ''; }, 70); return; }
    if (action === 'breathing') { runBreathingPause(button); return; }
  });
  function runBreathingPause(button) {
    if (button.dataset.running === 'true') return;
    const circle = $('#breath-circle'); if (!circle) return;
    button.dataset.running = 'true'; button.disabled = true; button.textContent = 'Acele etme…';
    const stages = [{ text: 'Nefes al', ms: 4000, scale: 'scale(1.12)' }, { text: 'Nefes ver', ms: 6000, scale: 'scale(1)' }];
    let elapsed = 0, stageIndex = 0;
    const tick = () => {
      if (!circle.isConnected) { button.dataset.running = 'false'; button.disabled = false; return; }
      const stage = stages[stageIndex % stages.length]; circle.innerHTML = stage.text.replace(' ', '<br>'); circle.style.transition = `transform ${stage.ms}ms ease-in-out`; circle.style.transform = stage.scale;
      setTimeout(() => { elapsed += stage.ms; stageIndex++; if (elapsed >= 60000) { circle.innerHTML = 'Mola<br>tamam'; circle.style.transform = 'scale(1)'; button.disabled = false; button.dataset.running = 'false'; button.textContent = 'Bir mola daha başlat'; state.breathingCount = (state.breathingCount || 0) + 1; saveState(); showToast('Kendine ayırdığın küçük bir mola.'); } else tick(); }, stage.ms);
    };
    tick();
  }
  document.addEventListener('submit', event => {
    const form = event.target;
    if (form.id === 'sync-form') { event.preventDefault(); const d=new FormData(form); prefs.firebase={apiKey:String(d.get('apiKey')).trim(),projectId:String(d.get('projectId')).trim(),authDomain:String(d.get('authDomain')).trim(),databaseURL:String(d.get('databaseURL')).trim(),appId:String(d.get('appId')).trim(),room:String(d.get('room')).trim()}; localStorage.setItem(PREF_KEY,JSON.stringify(prefs)); connectCloud(true); return; }
    if (form.id === 'task-form') { event.preventDefault(); const title = $('#task-title').value.trim(); if (!title) return; const data = { title, category: $('#task-category').value, date: $('#task-date').value, time: $('#task-time').value }; const existing = editingTaskId && state.tasks.find(item => item.id === editingTaskId); if (existing) { Object.assign(existing, { title, category: normCategory(data.category), date: safeDate(data.date), time: data.time || '' }); saveState(); render(); showToast('Görev güncellendi.'); } else addTask(data); editingTaskId = null; dialog.close(); return; }
    if (form.id === 'recurring-form') { event.preventDefault(); const data = new FormData(form); const title = data.get('title')?.toString().trim(); if (!title) return; state.recurringTasks.push({ id: uid(), title, category: normCategory(data.get('category')?.toString()), cadence: data.get('cadence')?.toString() || 'weekly', date: safeDate(data.get('date')?.toString() || today()), time: data.get('time')?.toString() || '', weekday: Number(data.get('weekday')), dayOfMonth: Number(data.get('dayOfMonth')), completedDates: [], createdAt: new Date().toISOString() }); saveState(); render(); showToast('Plan kaydedildi.'); return; }
    if (form.id === 'habit-form') { event.preventDefault(); const name = new FormData(form).get('name')?.toString().trim(); if (!name) return; state.habits.push({ id: uid(), name, icon: '✳', active: true }); saveState(); render(); showToast('Alışkanlık eklendi.'); }
    if (form.id === 'goal-form') { event.preventDefault(); const data = new FormData(form); const title = data.get('title')?.toString().trim(); if (!title) return; state.goals.push({ id: uid(), title, detail: data.get('detail')?.toString().trim() || '', progress: 0 }); saveState(); render(); showToast('Hedef eklendi.'); }
    if (form.id === 'home-form' || form.id === 'travel-form') { event.preventDefault(); const text = new FormData(form).get('text')?.toString().trim(); if (!text) return; const key = form.id === 'home-form' ? 'homeItems' : 'travelIdeas'; state[key].push({ id: uid(), text, done: false }); saveState(); render(); showToast(key === 'homeItems' ? 'Ev listesine eklendi.' : 'Seyahat fikri kaydedildi.'); }
  });
  document.addEventListener('change', event => {
    if (event.target.id === 'journal-date') { journalDate = safeDate(event.target.value); render(); }
    if (event.target.id === 'import-file') { importData(event.target.files?.[0]); event.target.value = ''; }
  });
  document.addEventListener('input', event => {
    if (event.target.id === 'journal-text') { state.journal[journalDate] = { ...(state.journal[journalDate] || {}), text: event.target.value, prompt: state.journal[journalDate]?.prompt || journalPrompts[0], updatedAt: new Date().toISOString() }; saveState(); }
    if (event.target.id === 'career-notes') { state.careerNotes = event.target.value; saveState(); }
    if (event.target.id === 'fitness-notes') { state.fitnessNotes = event.target.value; saveState(); }
  });
  $$('[data-close-dialog]').forEach(button => button.addEventListener('click', () => dialog.close()));
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  $('#quick-add').addEventListener('click', () => openTaskDialog());
  $('#mobile-menu').addEventListener('click', () => $('.sidebar').classList.toggle('open'));
  document.addEventListener('click', event => { if (window.innerWidth <= 700 && !event.target.closest('.sidebar') && !event.target.closest('#mobile-menu')) $('.sidebar').classList.remove('open'); });
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(error => console.warn('Service worker registration failed:', error)));
  }
  render();
  if (prefs.firebase) connectCloud(false);
})();
