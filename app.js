(() => {
  'use strict';
  const STORE_KEY = 'lifePlannerData_v1';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
  const prettyDate = (date = new Date(), options = { weekday: 'long', month: 'long', day: 'numeric' }) => new Intl.DateTimeFormat('en-GB', options).format(date);
  const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const safeDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value : today();
  const defaultState = () => ({
    tasks: [],
    recurringTasks: [],
    habits: [
      { id: uid(), name: 'Drink a glass of water', icon: '💧', active: true },
      { id: uid(), name: 'Move my body', icon: '🌿', active: true },
      { id: uid(), name: 'Read for 10 minutes', icon: '📖', active: true },
      { id: uid(), name: 'Take a mindful pause', icon: '☁️', active: true }
    ],
    habitChecks: {},
    routines: {
      morning: ['Drink water', 'Stretch for 5 minutes', 'Set an intention'],
      evening: ['Put my phone aside', 'Reflect on the day', 'Read a few pages']
    },
    routineChecks: {},
    journal: {},
    mood: {},
    careerNotes: '',
    fitnessNotes: '',
    goals: [
      { id: uid(), title: 'Make space for learning', detail: 'Small, consistent steps count.', progress: 0 },
      { id: uid(), title: 'Nurture my wellbeing', detail: 'Build routines that feel supportive.', progress: 0 }
    ],
    homeItems: [],
    travelIdeas: [],
    breathingCount: 0
  });
  function loadState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORE_KEY));
      if (!parsed || typeof parsed !== 'object') return defaultState();
      const defaults = defaultState();
      return { ...defaults, ...parsed,
        tasks: Array.isArray(parsed.tasks) ? parsed.tasks : defaults.tasks,
        recurringTasks: Array.isArray(parsed.recurringTasks) ? parsed.recurringTasks : [],
        habits: Array.isArray(parsed.habits) ? parsed.habits : defaults.habits,
        goals: Array.isArray(parsed.goals) ? parsed.goals : defaults.goals,
        homeItems: Array.isArray(parsed.homeItems) ? parsed.homeItems : [],
        travelIdeas: Array.isArray(parsed.travelIdeas) ? parsed.travelIdeas : [],
        routines: parsed.routines || defaults.routines,
        routineChecks: parsed.routineChecks || {}, habitChecks: parsed.habitChecks || {},
        journal: parsed.journal || {}, mood: parsed.mood || {}
      };
    } catch (error) { console.warn('Could not read local data; starting with defaults.', error); return defaultState(); }
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
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
    catch (error) { showToast('Could not save. Please export a backup and check device storage.'); console.error(error); }
  }
  function showToast(message) {
    const toast = $('#toast'); toast.textContent = message; toast.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
  }
  function setHeader() {
    $('#today-date').textContent = prettyDate(new Date()).toUpperCase();
    const titles = { today: 'A little space for you.', tasks: 'One thing at a time.', habits: 'Small things add up.', wellbeing: 'Check in with yourself.', journal: 'A page for your thoughts.', career: 'Keep learning, gently.', goals: 'Grow at your own pace.', home: 'Make room at home.', fitness: 'Care for your energy.', travel: 'Somewhere to look forward to.', settings: 'Your space, your data.', recurring: 'The things that come around.' };
    $('#page-title').textContent = titles[currentView] || titles.today;
    $$('.nav-item[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === currentView));
  }
  const getTasksForDate = date => state.tasks.filter(task => task.date === date);
  const activeTasks = () => state.tasks.filter(task => !task.done);
  function taskRow(task, compact = false) {
    const categoryClass = task.category === 'Wellbeing' ? 'warm' : task.category === 'Career' ? 'blue' : '';
    return `<div class="task-row ${task.done ? 'completed' : ''}"><input class="check" type="checkbox" data-action="toggle-task" data-id="${escapeHTML(task.id)}" ${task.done ? 'checked' : ''} aria-label="Mark ${escapeHTML(task.title)} complete"><div class="task-main"><div class="task-name">${escapeHTML(task.title)}</div><div class="task-meta">${task.time ? `<span>${escapeHTML(task.time)}</span>` : ''}<span class="tag ${categoryClass}">${escapeHTML(task.category || 'Personal')}</span>${!compact ? `<span>${escapeHTML(task.date || '')}</span>` : ''}</div></div><button class="text-button" data-action="delete-task" data-id="${escapeHTML(task.id)}" aria-label="Delete task">×</button></div>`;
  }
  function emptyState(title, detail, icon = '✳') { return `<div class="empty-state"><div class="empty-icon">${icon}</div><b>${escapeHTML(title)}</b><br>${escapeHTML(detail)}</div>`; }
  function progressBar(done, total) { const pct = total ? Math.round(done / total * 100) : 0; return `<div class="progress-line"><span style="width:${pct}%"></span></div><div class="progress-label">${done} of ${total} complete · ${pct}%</div>`; }
  function routineBlock(key, title, subtitle) {
    const items = state.routines[key] || [];
    const checks = state.routineChecks[today()]?.[key] || [];
    const done = items.filter(item => checks.includes(item)).length;
    return `<div class="card"><div class="card-header"><div><h3>${title}</h3><div class="subtle">${subtitle}</div></div><span class="tag">${done}/${items.length}</span></div><div>${items.map(item => `<label class="routine-item"><input class="check" type="checkbox" data-action="routine-check" data-routine="${key}" data-item="${escapeHTML(item)}" ${checks.includes(item) ? 'checked' : ''}><span>${escapeHTML(item)}</span></label>`).join('')}</div>${progressBar(done, items.length)}</div>`;
  }
  function renderToday() {
    const todaysTasks = getTasksForDate(today()).sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99'));
    const done = todaysTasks.filter(task => task.done).length;
    const habits = state.habits.filter(habit => habit.active !== false);
    const checks = state.habitChecks[today()] || [];
    const habitsDone = habits.filter(habit => checks.includes(habit.id)).length;
    return `<div class="grid grid-two"><div class="grid"><div class="hero-card card"><div class="eyebrow">YOUR DAY, YOUR PACE</div><h2>You don't have to do it all.<br>Just begin somewhere.</h2><p>A gentle place to collect your plans, notice what matters and make a little room for yourself.</p><button class="button button-primary" data-action="open-task">＋ Add a task</button></div><div class="stat-row"><div class="stat-card"><span class="stat-number">${todaysTasks.length}</span><span class="stat-label">Tasks for today</span></div><div class="stat-card"><span class="stat-number">${done}</span><span class="stat-label">Completed</span></div><div class="stat-card"><span class="stat-number">${habitsDone}/${habits.length}</span><span class="stat-label">Habits checked</span></div></div><div class="card"><div class="card-header"><h3>Today's plan</h3><button class="text-button" data-view="tasks">All tasks ↗</button></div>${todaysTasks.length ? `<div class="task-list">${todaysTasks.map(task => taskRow(task, true)).join('')}</div>` : emptyState('A little breathing room','Nothing planned for today yet. Add one thing you would like to make time for.','☁️')}</div></div><div class="grid">${routineBlock('morning','Morning routine','Start with a little intention')}${routineBlock('evening','Evening routine','Let the day settle') }<div class="card"><div class="card-header"><h3>Daily check-in</h3><span class="tag">Today</span></div><p class="subtle">How are you arriving in this moment?</p>${moodPicker()}<button class="text-button" data-view="wellbeing">More ways to pause ↗</button></div></div></div>`;
  }
  function moodPicker() {
    const moods = [{ id: 'calm', icon: '😌', label: 'Calm' }, { id: 'good', icon: '🙂', label: 'Okay' }, { id: 'tired', icon: '😴', label: 'Tired' }, { id: 'anxious', icon: '😟', label: 'Anxious' }, { id: 'low', icon: '🌧️', label: 'Low' }];
    return `<div class="mood-grid">${moods.map(mood => `<button class="mood-option ${moodChoice === mood.id ? 'selected' : ''}" data-action="mood" data-mood="${mood.id}" aria-pressed="${moodChoice === mood.id}">${mood.icon}<span>${mood.label}</span></button>`).join('')}</div>`;
  }
  function renderTasks() {
    let tasks = [...state.tasks].sort((a, b) => a.date.localeCompare(b.date) || (a.time || '99:99').localeCompare(b.time || '99:99'));
    if (taskFilter === 'open') tasks = tasks.filter(task => !task.done);
    if (taskFilter === 'done') tasks = tasks.filter(task => task.done);
    if (taskFilter === 'today') tasks = tasks.filter(task => task.date === today());
    if (taskSearch.trim()) tasks = tasks.filter(task => `${task.title} ${task.category}`.toLowerCase().includes(taskSearch.toLowerCase()));
    return `<div class="section-heading"><div><h2>Everything on your list</h2><p>Keep it simple. You can always move things to another day.</p></div><button class="button button-primary" data-action="open-task">＋ Add task</button></div><div class="card"><div class="form-inline" style="margin-bottom:14px"><input class="field" id="task-search" placeholder="Search your tasks…" value="${escapeHTML(taskSearch)}" aria-label="Search tasks"></div><div class="filters">${[['all','All tasks'],['today','Today'],['open','To do'],['done','Completed']].map(([id,label]) => `<button class="filter-button ${taskFilter === id ? 'active' : ''}" data-action="task-filter" data-filter="${id}">${label}</button>`).join('')}</div>${tasks.length ? `<div class="task-list">${tasks.map(task => taskRow(task)).join('')}</div>` : emptyState('Nothing here for now','Try another filter or add a task to get started.','☷')}</div>`;
  }
  function renderHabits() {
    const checks = state.habitChecks[today()] || [];
    const habits = state.habits.filter(habit => habit.active !== false);
    return `<div class="grid grid-two"><div class="card"><div class="card-header"><div><h3>Your daily habits</h3><p class="subtle">Tiny actions, repeated with kindness.</p></div><span class="tag">${checks.filter(id => habits.some(h => h.id === id)).length}/${habits.length}</span></div>${habits.length ? `<div class="habit-grid">${habits.map(habit => `<label class="habit-card"><input class="check" type="checkbox" data-action="habit-check" data-id="${escapeHTML(habit.id)}" ${checks.includes(habit.id) ? 'checked' : ''}><span style="font-size:22px">${escapeHTML(habit.icon || '✳')}</span><span class="habit-copy"><span class="habit-name">${escapeHTML(habit.name)}</span><span class="habit-meta">${checks.includes(habit.id) ? 'Done for today' : 'One small step'}</span></span><button type="button" class="text-button" data-action="delete-habit" data-id="${escapeHTML(habit.id)}" aria-label="Remove habit">×</button></label>`).join('')}</div>` : emptyState('Start with one small habit','Add something you would like to return to.')}<div style="margin-top:18px">${progressBar(checks.filter(id => habits.some(h => h.id === id)).length, habits.length)}</div></div><div class="grid">${routineBlock('morning','Morning routine','A gentle beginning')}${routineBlock('evening','Evening routine','A softer landing')}<div class="card"><h3>Add a habit</h3><form id="habit-form" class="form-inline"><input class="field" name="name" maxlength="70" required placeholder="e.g. 5-minute stretch"><button class="button button-primary" type="submit">Add</button></form><p class="tiny" style="margin-top:10px">Habit checkmarks reset visually each day; previous dates remain in your local data.</p></div></div></div>`;
  }
  function renderWellbeing() {
    return `<div class="grid grid-two"><div class="card"><div class="card-header"><h3>How are you feeling?</h3><span class="tag">Daily check-in</span></div><p class="subtle">There is no right answer. Just notice what is here.</p>${moodPicker()}<p class="subtle" style="margin-top:14px">${moodChoice ? 'Your check-in for today is saved on this device.' : 'Choose the word or feeling that feels closest.'}</p></div><div class="card"><div class="eyebrow">A MOMENT TO PAUSE</div><h2 style="margin-bottom:12px">Come back to your breath.</h2><p class="subtle">Let your shoulders soften. Feel the support beneath you. Breathe in gently, then let the exhale be a little longer.</p><div style="display:flex;justify-content:center;padding:20px"><div id="breath-circle" style="width:135px;height:135px;border-radius:50%;background:#e2eadf;display:grid;place-items:center;text-align:center;color:#607b65;font-family:Georgia,serif;font-size:18px;box-shadow:0 0 0 12px #e2eadf55">Breathe<br>softly</div></div><div style="text-align:center"><button class="button button-primary" data-action="breathing">Start 1-minute pause</button><p class="tiny" style="margin-top:10px">${state.breathingCount || 0} pauses completed in this app</p></div></div><div class="card"><h3>Gentle reminders</h3><div class="idea-list"><div class="idea-row"><span>☁️</span><p>You can take one thing at a time.</p></div><div class="idea-row"><span>🌿</span><p>Rest is part of the rhythm, not a reward you have to earn.</p></div><div class="idea-row"><span>♡</span><p>You can notice a feeling without needing to fix it immediately.</p></div></div></div></div>`;
  }
  const journalPrompts = ['What is taking up space in my mind today?','What would make today feel meaningful, even in a small way?','What do I need more of, and what could I gently release?','What is one thing I want to remember about this moment?','Where did I feel most like myself today?'];
  function renderJournal() {
    const entry = state.journal[journalDate] || { text: '', prompt: '' };
    return `<div class="grid grid-two"><div class="card"><div class="card-header"><div><h3>Your journal</h3><p class="subtle">A place to write without editing yourself.</p></div><span class="tag">Private</span></div><label class="label" for="journal-date">Entry date</label><input class="field" id="journal-date" type="date" value="${escapeHTML(journalDate)}" style="margin-bottom:16px;max-width:220px"><div class="journal-prompt">${escapeHTML(entry.prompt || journalPrompts[0])}</div><button class="text-button" data-action="new-prompt">↻ Another prompt</button><textarea id="journal-text" class="field textarea" placeholder="Start wherever you are…">${escapeHTML(entry.text || '')}</textarea><div class="split-heading" style="margin-top:13px"><span class="tiny">Saved only on this device.</span><button class="button button-primary" data-action="save-journal">Save entry</button></div></div><div class="card"><h3>Past entries</h3>${Object.keys(state.journal).filter(date => state.journal[date]?.text?.trim()).sort((a,b)=>b.localeCompare(a)).length ? `<div class="idea-list">${Object.keys(state.journal).filter(date => state.journal[date]?.text?.trim()).sort((a,b)=>b.localeCompare(a)).map(date => `<button class="idea-row" style="text-align:left;background:transparent;color:inherit;width:100%" data-action="open-journal" data-date="${date}"><span>✎</span><p><b>${escapeHTML(date)}</b><br><span class="subtle">${escapeHTML(state.journal[date].text.slice(0,100))}${state.journal[date].text.length>100?'…':''}</span></p><span>↗</span></button>`).join('')}</div>` : emptyState('Your pages will gather here','Save your first entry whenever you are ready.','✎')}</div></div>`;
  }
  function renderCareer() {
    return `<div class="grid grid-two"><div class="card"><div class="card-header"><div><h3>Learning notes</h3><p class="subtle">Keep track of what you are exploring.</p></div><span class="tag blue">Career</span></div><textarea id="career-notes" class="field textarea" placeholder="Courses, ideas, questions, things I learned…">${escapeHTML(state.careerNotes || '')}</textarea><div class="split-heading" style="margin-top:13px"><span class="tiny">Autosaves when you leave this field.</span><button class="button button-primary" data-action="save-career">Save notes</button></div></div><div class="card"><h3>Make learning tangible</h3><p class="subtle">Turn a broad intention into a small next step. Add it as a task so it has a place in your week.</p><button class="button button-outline" data-action="open-task" data-category="Career">＋ Add a learning task</button><div style="margin-top:24px"><div class="eyebrow">A FEW QUESTIONS</div><div class="idea-list"><div class="idea-row"><span>01</span><p>What am I curious about right now?</p></div><div class="idea-row"><span>02</span><p>What is the smallest thing I could try this week?</p></div><div class="idea-row"><span>03</span><p>What did I learn by doing, not just reading?</p></div></div></div></div></div>`;
  }
  function renderGoals() {
    return `<div class="section-heading"><div><h2>Things I want to grow into</h2><p>Goals can be directions, not deadlines.</p></div></div><div class="grid grid-three">${state.goals.map(goal => `<div class="card goal-card"><div class="eyebrow">A GOAL TO GROW TOWARD</div><h3 style="font-family:Georgia,serif;font-size:20px;line-height:1.3">${escapeHTML(goal.title)}</h3><p class="subtle">${escapeHTML(goal.detail || '')}</p><div class="goal-progress"><div class="split-heading"><span>Progress</span><b>${Number(goal.progress)||0}%</b></div><div class="progress-line"><span style="width:${Math.max(0,Math.min(100,Number(goal.progress)||0))}%"></span></div></div><div class="goal-actions"><button class="button button-quiet small-button" data-action="goal-progress" data-id="${escapeHTML(goal.id)}" data-delta="-10">−10%</button><button class="button button-outline small-button" data-action="goal-progress" data-id="${escapeHTML(goal.id)}" data-delta="10">+10%</button><button class="text-button" data-action="delete-goal" data-id="${escapeHTML(goal.id)}">Remove</button></div></div>`).join('')}<div class="card"><h3>Add a goal</h3><form id="goal-form"><div class="field-group"><label class="label">Goal</label><input class="field" name="title" required maxlength="90" placeholder="What matters to me?"></div><div class="field-group"><label class="label">A little context (optional)</label><input class="field" name="detail" maxlength="160" placeholder="Why this matters…"></div><button class="button button-primary" type="submit">＋ Add goal</button></form></div></div>`;
  }
  function renderListModule(title, subtitle, list, inputPlaceholder, kind) {
    const isHome = kind === 'home';
    const rows = list.map(item => `<div class="idea-row"><input class="check" type="checkbox" data-action="toggle-${kind}" data-id="${escapeHTML(item.id)}" ${item.done ? 'checked' : ''} aria-label="Mark item done"><p class="${item.done ? 'completed' : ''}" style="${item.done ? 'text-decoration:line-through;color:#9ba39a' : ''}">${escapeHTML(item.text)}</p><button class="remove" data-action="delete-${kind}" data-id="${escapeHTML(item.id)}" aria-label="Remove item">×</button></div>`).join('');
    return `<div class="grid grid-two"><div class="card"><div class="card-header"><div><h3>${title}</h3><p class="subtle">${subtitle}</p></div><span class="tag">${list.filter(item => !item.done).length} left</span></div>${list.length ? `<div class="idea-list">${rows}</div>` : emptyState(isHome ? 'A little less to hold in your head' : 'Collect places and possibilities','Add an idea below, and come back to it when you are ready.',isHome?'⌂':'⌁')}<form id="${kind}-form" class="form-inline" style="margin-top:17px"><input class="field" name="text" maxlength="180" required placeholder="${inputPlaceholder}"><button class="button button-primary" type="submit">Add</button></form></div><div class="card"><div class="eyebrow">A GENTLE REMINDER</div><h2>${isHome ? 'Done is better than perfect.' : 'Let curiosity lead.'}</h2><p class="subtle" style="margin-top:12px">${isHome ? 'You do not need to finish everything today. Choose one small thing that will make tomorrow easier.' : 'A travel idea does not have to become a plan right away. Keep the possibilities somewhere you can find them.'}</p>${isHome ? `<button class="button button-outline" data-action="open-task" data-category="Home">＋ Schedule an errand</button>` : `<button class="button button-outline" data-action="open-task" data-category="Travel">＋ Add a travel planning task</button>`}</div></div>`;
  }
  const WEEKDAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  function isoLocal(date) { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; }
  function recurringDueOn(item, date) {
    if (item.cadence === 'weekly') return date.getDay() === Number(item.weekday);
    const wantedDay = Number(item.dayOfMonth);
    const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    return date.getDate() === Math.min(wantedDay, lastDay);
  }
  function recurringForDate(date) { return state.recurringTasks.filter(item => recurringDueOn(item, date)); }
  function isRecurringDone(item, dateKey) { return (item.completedDates || []).includes(dateKey); }
  function recurringRow(item, date) {
    const dateKey = isoLocal(date), done = isRecurringDone(item, dateKey);
    const schedule = item.cadence === 'weekly' ? `Every ${WEEKDAYS[Number(item.weekday)]}` : `Monthly · day ${item.dayOfMonth}`;
    return `<div class="task-row ${done ? 'completed' : ''}"><input class="check" type="checkbox" data-action="toggle-recurring" data-id="${escapeHTML(item.id)}" data-date="${dateKey}" ${done ? 'checked' : ''} aria-label="Mark ${escapeHTML(item.title)} done for ${dateKey}"><div class="task-main"><div class="task-name">${escapeHTML(item.title)}</div><div class="task-meta"><span>${prettyDate(date, { weekday: 'short', month: 'short', day: 'numeric' })}</span><span class="tag">${schedule}</span><span class="tag">${escapeHTML(item.category || 'Personal')}</span></div></div><button class="text-button" data-action="delete-recurring" data-id="${escapeHTML(item.id)}" aria-label="Delete recurring task">×</button></div>`;
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
    const modeButtons = `<div class="filters"><button class="filter-button ${recurringMode === 'list' ? 'active' : ''}" data-action="recurring-mode" data-mode="list">☷ List</button><button class="filter-button ${recurringMode === 'calendar' ? 'active' : ''}" data-action="recurring-mode" data-mode="calendar">▦ Calendar</button></div>`;
    const calendar = `<div class="calendar-grid calendar-weekdays">${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(day => `<div>${day}</div>`).join('')}</div><div class="calendar-grid">${Array.from({length:firstDay.getDay()}, () => '<div class="calendar-day blank"></div>').join('')}${Array.from({length:daysInMonth}, (_, i) => { const date = new Date(y,m,i+1), key = isoLocal(date), due = recurringForDate(date); return `<div class="calendar-day ${key === today() ? 'is-today' : ''}"><div class="calendar-day-number">${i+1}</div>${due.slice(0,3).map(item => `<label class="calendar-event ${isRecurringDone(item,key) ? 'is-done' : ''}" title="${escapeHTML(item.title)}"><input type="checkbox" data-action="toggle-recurring" data-id="${escapeHTML(item.id)}" data-date="${key}" ${isRecurringDone(item,key) ? 'checked' : ''}><span>${escapeHTML(item.title)}</span></label>`).join('')}${due.length > 3 ? `<small class="subtle">+${due.length-3} more</small>` : ''}</div>`; }).join('')}</div>`;
    const list = occurrences.length ? `<div class="task-list">${occurrences.map(({item,date}) => recurringRow(item,date)).join('')}</div>` : emptyState('No recurring tasks this month','Add a weekly or monthly task below to see it here.','▦');
    return `<div class="section-heading"><div><h2>Weekly & monthly tasks</h2><p>Keep track of the things that come around regularly, in a list or on a calendar.</p></div><span class="tag">${completedCount}/${occurrenceCount} completed this month</span></div><div class="card recurring-card"><div class="card-header"><div><h3>${monthLabel}</h3><p class="subtle">Weekly tasks repeat on a chosen weekday. Monthly tasks repeat on a chosen date.</p></div><div class="month-controls"><button class="button button-outline small-button" data-action="recurring-month" data-delta="-1" aria-label="Previous month">←</button><button class="button button-outline small-button" data-action="recurring-month" data-delta="1" aria-label="Next month">→</button></div></div>${modeButtons}${recurringMode === 'calendar' ? calendar : list}</div><div class="card" style="margin-top:17px"><div class="card-header"><div><h3>Add a recurring task</h3><p class="subtle">Examples: clean the bathroom every Saturday, pay rent on the 1st.</p></div></div><form id="recurring-form"><div class="field-group"><label class="label" for="recurring-title">Task name</label><input class="field" id="recurring-title" name="title" required maxlength="140" placeholder="What needs doing regularly?"></div><div class="form-row"><div class="field-group"><label class="label" for="recurring-cadence">Repeat</label><select class="field" id="recurring-cadence" name="cadence"><option value="weekly">Every week</option><option value="monthly">Every month</option></select></div><div class="field-group"><label class="label" for="recurring-category">Area</label><select class="field" id="recurring-category" name="category"><option>Personal</option><option>Career</option><option>Wellbeing</option><option>Home</option><option>Fitness</option><option>Travel</option></select></div></div><div class="form-row"><div class="field-group"><label class="label" for="recurring-weekday">Day of week (weekly)</label><select class="field" id="recurring-weekday" name="weekday">${WEEKDAYS.map((day,i) => `<option value="${i}" ${i===6?'selected':''}>${day}</option>`).join('')}</select></div><div class="field-group"><label class="label" for="recurring-day">Day of month (monthly)</label><select class="field" id="recurring-day" name="dayOfMonth">${Array.from({length:31},(_,i)=>`<option value="${i+1}" ${i===0?'selected':''}>${i+1}${[1,21,31].includes(i+1)?'st':[2,22].includes(i+1)?'nd':[3,23].includes(i+1)?'rd':'th'}</option>`).join('')}</select></div></div><button class="button button-primary" type="submit">＋ Save recurring task</button></form></div>`;
  }
  function renderFitness() {
    return `<div class="grid grid-two"><div class="card"><div class="card-header"><div><h3>Fitness & nutrition notes</h3><p class="subtle">Notice patterns, energy and what supports you.</p></div><span class="tag warm">Your notes</span></div><textarea id="fitness-notes" class="field textarea" placeholder="Movement, meals, energy, recovery, ideas…">${escapeHTML(state.fitnessNotes || '')}</textarea><div class="split-heading" style="margin-top:13px"><span class="tiny">Saved on this device.</span><button class="button button-primary" data-action="save-fitness">Save notes</button></div></div><div class="card"><h3>Make a little plan</h3><p class="subtle">A walk, a stretch or preparing something nourishing can be enough of a next step.</p><div class="idea-list"><button class="idea-row" style="text-align:left;background:transparent;color:inherit;width:100%" data-action="quick-fitness" data-title="Move my body for 15 minutes"><span>🌿</span><p>Move my body for 15 minutes</p><span>＋</span></button><button class="idea-row" style="text-align:left;background:transparent;color:inherit;width:100%" data-action="quick-fitness" data-title="Prepare something nourishing"><span>🥣</span><p>Prepare something nourishing</p><span>＋</span></button><button class="idea-row" style="text-align:left;background:transparent;color:inherit;width:100%" data-action="quick-fitness" data-title="Take time to recover"><span>☁️</span><p>Take time to recover</p><span>＋</span></button></div></div></div>`;
  }
  function renderSettings() {
    return `<div class="grid grid-two"><div class="card"><div class="card-header"><h3>Your data & privacy</h3><span class="tag">Local only</span></div><p class="subtle">Life Planner does not use an account or cloud database. Your tasks, journal and notes are saved in this browser on this device.</p><div class="settings-box"><div class="settings-row"><div><b>Export a backup</b><p>Download a JSON file containing your Life Planner data.</p></div><button class="button button-primary" data-action="export">Export JSON</button></div><div class="settings-row"><div><b>Import a backup</b><p>Restore data from a previous JSON export. This replaces the data currently in this browser.</p></div><button class="button button-outline" data-action="import">Choose file</button></div><div class="settings-row"><div><b>Reset this device</b><p>Delete this app's saved data from this browser. Export a backup first if needed.</p></div><button class="button button-outline danger" data-action="reset">Reset data</button></div></div></div><div class="grid"><div class="card"><div class="eyebrow">APP STATUS</div><h2>Made for your own pace.</h2><p class="subtle" style="margin-top:12px">This app can open offline after its first online visit, once the app shell has been cached. Use the published HTTPS address to install it on your phone or desktop.</p><div class="idea-list"><div class="idea-row"><span>✓</span><p>Tasks, routines, habits and notes</p></div><div class="idea-row"><span>✓</span><p>Local storage and JSON backup</p></div><div class="idea-row"><span>✓</span><p>Installable PWA structure</p></div><div class="idea-row"><span>!</span><p>No automatic sync between devices</p></div></div></div><div class="notice"><b>Keep a backup.</b> Browser storage can be cleared by device or browser settings. Export your data regularly, especially before changing browsers or devices.</div></div></div>`;
  }
  function render() {
    setHeader();
    const renderers = { today: renderToday, tasks: renderTasks, recurring: renderRecurring, habits: renderHabits, wellbeing: renderWellbeing, journal: renderJournal, career: renderCareer, goals: renderGoals, home: () => renderListModule('Home & errands','Small tasks that make everyday life lighter.',state.homeItems,'Add an errand or home task…','home'), travel: () => renderListModule('Travel ideas','Places, routes and experiences to explore.',state.travelIdeas,'Add a place or travel idea…','travel'), fitness: renderFitness, settings: renderSettings };
    view.innerHTML = (renderers[currentView] || renderToday)();
    if (currentView === 'tasks') { const search = $('#task-search'); if (search) { search.addEventListener('input', () => { const pos = search.selectionStart; taskSearch = search.value; const scroll = window.scrollY; render(); const next = $('#task-search'); next?.focus(); next?.setSelectionRange(pos, pos); window.scrollTo(0, scroll); }); } }
  }
  function openTaskDialog(category) {
    $('#task-form').reset(); $('#task-dialog-title').textContent = 'Add a task'; $('#task-date').value = today(); $('#task-category').value = category || 'Personal';
    if (typeof dialog.showModal === 'function') dialog.showModal(); else { const title = prompt('Task name?'); if (title?.trim()) addTask({ title: title.trim(), category: category || 'Personal', date: today(), time: '' }); }
    setTimeout(() => $('#task-title').focus(), 50);
  }
  function addTask(data) { state.tasks.push({ id: uid(), title: data.title, category: data.category || 'Personal', date: safeDate(data.date), time: data.time || '', done: false, createdAt: new Date().toISOString() }); saveState(); render(); showToast('Task added to your plan.'); }
  function exportData() {
    const blob = new Blob([JSON.stringify({ app: 'Life Planner', version: 1, exportedAt: new Date().toISOString(), data: state }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `life-planner-backup-${today()}.json`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); showToast('Backup downloaded. Keep it somewhere safe.');
  }
  function importData(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result); const imported = parsed.data || parsed;
        if (!imported || typeof imported !== 'object' || !Array.isArray(imported.tasks) || !Array.isArray(imported.habits)) throw new Error('This does not look like a Life Planner backup.');
        if (!confirm('Importing will replace the Life Planner data currently saved in this browser. Continue?')) return;
        const defaults = defaultState(); state = { ...defaults, ...imported }; saveState(); moodChoice = state.mood[today()] || ''; render(); showToast('Backup imported.');
      } catch (error) { alert(`Could not import this file. ${error.message || ''}`); }
    };
    reader.onerror = () => alert('Could not read this file.'); reader.readAsText(file);
  }
  document.addEventListener('click', event => {
    const nav = event.target.closest('[data-view]');
    if (nav) { currentView = nav.dataset.view; $('#sidebar')?.classList.remove('open'); $('.sidebar')?.classList.remove('open'); render(); return; }
    const button = event.target.closest('[data-action]'); if (!button) return;
    const { action, id } = button.dataset;
    if (action === 'open-task') { openTaskDialog(button.dataset.category); return; }
    if (action === 'toggle-task') { const task = state.tasks.find(item => item.id === id); if (task) task.done = button.checked; saveState(); render(); return; }
    if (action === 'delete-task') { state.tasks = state.tasks.filter(item => item.id !== id); saveState(); render(); showToast('Task removed.'); return; }
    if (action === 'task-filter') { taskFilter = button.dataset.filter; render(); return; }
    if (action === 'recurring-mode') { recurringMode = button.dataset.mode; render(); return; }
    if (action === 'recurring-month') { recurringMonth = new Date(recurringMonth.getFullYear(), recurringMonth.getMonth() + Number(button.dataset.delta), 1); render(); return; }
    if (action === 'toggle-recurring') { const item = state.recurringTasks.find(entry => entry.id === id); if (item) { item.completedDates ||= []; const dateKey = button.dataset.date; item.completedDates = button.checked ? [...new Set([...item.completedDates, dateKey])] : item.completedDates.filter(value => value !== dateKey); } saveState(); render(); return; }
    if (action === 'delete-recurring') { state.recurringTasks = state.recurringTasks.filter(item => item.id !== id); saveState(); render(); showToast('Recurring task removed.'); return; }
    if (action === 'routine-check') { const key = button.dataset.routine, item = button.dataset.item; state.routineChecks[today()] ||= { morning: [], evening: [] }; state.routineChecks[today()][key] ||= []; const list = state.routineChecks[today()][key]; state.routineChecks[today()][key] = button.checked ? [...new Set([...list, item])] : list.filter(value => value !== item); saveState(); render(); return; }
    if (action === 'habit-check') { state.habitChecks[today()] ||= []; state.habitChecks[today()] = button.checked ? [...new Set([...state.habitChecks[today()], id])] : state.habitChecks[today()].filter(value => value !== id); saveState(); render(); return; }
    if (action === 'delete-habit') { state.habits = state.habits.filter(habit => habit.id !== id); saveState(); render(); showToast('Habit removed.'); return; }
    if (action === 'mood') { moodChoice = button.dataset.mood; state.mood[today()] = moodChoice; saveState(); render(); showToast('Check-in saved.'); return; }
    if (action === 'new-prompt') { const entry = state.journal[journalDate] || { text: '', prompt: '' }; let next = journalPrompts[Math.floor(Math.random() * journalPrompts.length)]; if (journalPrompts.length > 1 && next === entry.prompt) next = journalPrompts[(journalPrompts.indexOf(next) + 1) % journalPrompts.length]; entry.prompt = next; state.journal[journalDate] = entry; saveState(); render(); return; }
    if (action === 'save-journal') { state.journal[journalDate] = { ...(state.journal[journalDate] || {}), text: $('#journal-text')?.value || '', prompt: state.journal[journalDate]?.prompt || journalPrompts[0], updatedAt: new Date().toISOString() }; saveState(); render(); showToast('Journal entry saved.'); return; }
    if (action === 'open-journal') { journalDate = button.dataset.date; currentView = 'journal'; render(); return; }
    if (action === 'save-career') { state.careerNotes = $('#career-notes')?.value || ''; saveState(); showToast('Learning notes saved.'); return; }
    if (action === 'save-fitness') { state.fitnessNotes = $('#fitness-notes')?.value || ''; saveState(); showToast('Notes saved.'); return; }
    if (action === 'goal-progress') { const goal = state.goals.find(item => item.id === id); if (goal) goal.progress = Math.max(0, Math.min(100, (Number(goal.progress) || 0) + Number(button.dataset.delta))); saveState(); render(); return; }
    if (action === 'delete-goal') { state.goals = state.goals.filter(item => item.id !== id); saveState(); render(); showToast('Goal removed.'); return; }
    if (action === 'toggle-home' || action === 'toggle-travel') { const list = action === 'toggle-home' ? state.homeItems : state.travelIdeas; const item = list.find(entry => entry.id === id); if (item) item.done = button.checked; saveState(); render(); return; }
    if (action === 'delete-home' || action === 'delete-travel') { const key = action === 'delete-home' ? 'homeItems' : 'travelIdeas'; state[key] = state[key].filter(item => item.id !== id); saveState(); render(); return; }
    if (action === 'export') { exportData(); return; }
    if (action === 'import') { $('#import-file').click(); return; }
    if (action === 'reset') { if (confirm('This permanently removes Life Planner data saved in this browser. Export a backup first if you want to keep it. Are you sure?')) { state = defaultState(); moodChoice = ''; saveState(); render(); showToast('Local data reset.'); } return; }
    if (action === 'quick-fitness') { openTaskDialog('Fitness'); setTimeout(() => { const title = $('#task-title'); if (title) title.value = button.dataset.title || ''; }, 70); return; }
    if (action === 'breathing') { runBreathingPause(button); return; }
  });
  function runBreathingPause(button) {
    if (button.dataset.running === 'true') return;
    const circle = $('#breath-circle'); if (!circle) return;
    button.dataset.running = 'true'; button.disabled = true; button.textContent = 'Take your time…';
    const stages = [{ text: 'Breathe in', ms: 4000, scale: 'scale(1.12)' }, { text: 'Breathe out', ms: 6000, scale: 'scale(1)' }];
    let elapsed = 0, stageIndex = 0;
    const tick = () => {
      if (!circle.isConnected) { button.dataset.running = 'false'; button.disabled = false; return; }
      const stage = stages[stageIndex % stages.length]; circle.innerHTML = stage.text.replace(' ', '<br>'); circle.style.transition = `transform ${stage.ms}ms ease-in-out`; circle.style.transform = stage.scale;
      setTimeout(() => { elapsed += stage.ms; stageIndex++; if (elapsed >= 60000) { circle.innerHTML = 'Pause<br>complete'; circle.style.transform = 'scale(1)'; button.disabled = false; button.dataset.running = 'false'; button.textContent = 'Start another pause'; state.breathingCount = (state.breathingCount || 0) + 1; saveState(); showToast('A little pause, just for you.'); } else tick(); }, stage.ms);
    };
    tick();
  }
  document.addEventListener('submit', event => {
    const form = event.target;
    if (form.id === 'task-form') { event.preventDefault(); const title = $('#task-title').value.trim(); if (!title) return; addTask({ title, category: $('#task-category').value, date: $('#task-date').value, time: $('#task-time').value }); dialog.close(); }
    if (form.id === 'recurring-form') { event.preventDefault(); const data = new FormData(form); const title = data.get('title')?.toString().trim(); if (!title) return; state.recurringTasks.push({ id: uid(), title, category: data.get('category')?.toString() || 'Personal', cadence: data.get('cadence')?.toString() || 'weekly', weekday: Number(data.get('weekday')), dayOfMonth: Number(data.get('dayOfMonth')), completedDates: [], createdAt: new Date().toISOString() }); saveState(); render(); showToast('Recurring task saved.'); return; }
    if (form.id === 'habit-form') { event.preventDefault(); const name = new FormData(form).get('name')?.toString().trim(); if (!name) return; state.habits.push({ id: uid(), name, icon: '✳', active: true }); saveState(); render(); showToast('Habit added.'); }
    if (form.id === 'goal-form') { event.preventDefault(); const data = new FormData(form); const title = data.get('title')?.toString().trim(); if (!title) return; state.goals.push({ id: uid(), title, detail: data.get('detail')?.toString().trim() || '', progress: 0 }); saveState(); render(); showToast('Goal added.'); }
    if (form.id === 'home-form' || form.id === 'travel-form') { event.preventDefault(); const text = new FormData(form).get('text')?.toString().trim(); if (!text) return; const key = form.id === 'home-form' ? 'homeItems' : 'travelIdeas'; state[key].push({ id: uid(), text, done: false }); saveState(); render(); showToast(key === 'homeItems' ? 'Added to your home list.' : 'Travel idea saved.'); }
  });
  document.addEventListener('change', event => {
    if (event.target.id === 'journal-date') { journalDate = safeDate(event.target.value); render(); }
    if (event.target.id === 'import-file') { importData(event.target.files?.[0]); event.target.value = ''; }
  });
  document.addEventListener('input', event => {
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
})();
