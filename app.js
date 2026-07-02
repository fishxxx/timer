document.addEventListener('DOMContentLoaded', () => {
    // ── UI Elements ──────────────────────────────────────────────────
    const timeDisplay = document.getElementById('timeDisplay');
    const statusIndicator = document.getElementById('statusIndicator');
    const timerPanel = document.getElementById('timerPanel');
    const cubiBtn = document.getElementById('cubiBtn');
    const skipRestBtn = document.getElementById('skipRestBtn');
    const tags = document.querySelectorAll('.tag');
    const durationSelect = document.getElementById('focusDuration');
    const soundSelect = document.getElementById('soundProfile');
    const logList = document.getElementById('logList');
    const logFilter = document.getElementById('logFilter');

    const projectStatsContent = document.getElementById('projectStatsContent');

    const editModal = document.getElementById('editLogModal');
    const editLogProject = document.getElementById('editLogProject');
    const editLogTag = document.getElementById('editLogTag');
    const editLogDuration = document.getElementById('editLogDuration');
    const cancelEditBtn = document.getElementById('cancelEditBtn');
    const saveEditBtn = document.getElementById('saveEditBtn');
    let editingLogId = null;

    const projectInput = document.getElementById('projectName');
    const projectList = document.getElementById('projectList');
    const estimateInput = document.getElementById('projectEstimate');
    const progressSection = document.getElementById('progressSection');
    const progressProjectName = document.getElementById('progressProjectName');
    const progressPercentage = document.getElementById('progressPercentage');
    const progressBarFill = document.getElementById('progressBarFill');
    const progressTimeSpent = document.getElementById('progressTimeSpent');
    const progressTimeEst = document.getElementById('progressTimeEst');

    // ── Audio ─────────────────────────────────────────────────────────
    // AudioContext must be created after a user gesture (browser policy).
    // So we lazy-init it on the first button click via initAudio().
    let audioCtx = null;

    // ── State Machine ────────────────────────────────────────────────
    // The timer goes through these states in order:
    //   IDLE → POMODORO → FLASHING (15s) → OVERTIME → (stop) → REST → IDLE
    let state = 'IDLE';
    let pomodoroCount = 0;       // Tracks completed pomodoros for long-rest logic
    let currentTag = 'WORK';
    let targetTimeMs = 0;        // How long the current phase should last
    let startTimeMs = 0;         // Date.now() when current phase started
    let elapsedMs = 0;
    let timerInterval = null;
    let lastTickMinute = -1;     // Used to play tick sound once per minute
    let warningPlayed = false;   // Prevents 5-second warning from repeating

    // Load logs on startup
    loadLogs();
    
    // Setup Projects list
    populateProjectList();
    const lastProject = localStorage.getItem('cubi_last_project');
    if (lastProject) {
        projectInput.value = lastProject;
    }
    updateProjectUI();

    // Event Listeners
    projectInput.addEventListener('change', () => {
        localStorage.setItem('cubi_last_project', projectInput.value.trim());
        updateProjectUI();
    });
    estimateInput.addEventListener('change', updateProjectEstimate);
    tags.forEach(tag => {
        tag.addEventListener('click', (e) => {
            if (state !== 'IDLE') return; // Cannot change tag while running
            tags.forEach(t => t.classList.remove('active'));
            e.target.classList.add('active');
            currentTag = e.target.dataset.tag;
        });
    });

    durationSelect.addEventListener('change', () => {
        if (state === 'IDLE') {
            updateDisplay(parseFloat(durationSelect.value) * 60);
        }
    });

    cubiBtn.addEventListener('click', () => {
        initAudio();
        
        if (state === 'IDLE') {
            startPomodoro();
        } else if (state === 'REST') {
            resetToIdle();
        } else {
            stopTimer();
        }
    });

    if (skipRestBtn) {
        skipRestBtn.addEventListener('click', () => {
            resetToIdle();
            startPomodoro();
        });
    }

    if (logFilter) {
        logFilter.addEventListener('change', loadLogs);
    }

    // ── Data Export ──────────────────────────────────────────────────
    // Exports ALL localStorage data (logs, projects, settings) as a
    // downloadable JSON file. This is the user's only backup mechanism
    // since localStorage can be wiped by clearing browser cache.
    const exportDataBtn = document.getElementById('exportDataBtn');
    if (exportDataBtn) {
        exportDataBtn.addEventListener('click', () => {
            const exportData = {
                exportDate: new Date().toISOString(),
                version: 'v1.4.3',
                logs: JSON.parse(localStorage.getItem('cubi_logs') || '[]'),
                projects: JSON.parse(localStorage.getItem('cubi_projects') || '{}'),
                lastProject: localStorage.getItem('cubi_last_project') || ''
            };
            const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            const dateStr = new Date().toISOString().slice(0, 10);
            a.href = url;
            a.download = `cubi-backup-${dateStr}.json`;
            a.click();
            URL.revokeObjectURL(url);
        });
    }

    cancelEditBtn.addEventListener('click', () => {
        editModal.style.display = 'none';
        editingLogId = null;
    });


    function showProjectStats() {
        const projects = getProjects();
        projectStatsContent.innerHTML = '';
        
        const projectKeys = Object.keys(projects);
        if (projectKeys.length === 0) {
            projectStatsContent.innerHTML = '<div style="color: var(--text-secondary); text-align: center;">No project data yet.</div>';
        } else {
            // Sort projects by total time spent, descending
            projectKeys.sort((a, b) => projects[b].totalSeconds - projects[a].totalSeconds).forEach(pName => {
                const data = projects[pName];
                const spentH = (data.totalSeconds / 3600).toFixed(2);
                const estH = data.estimatedSeconds > 0 ? (data.estimatedSeconds / 3600).toFixed(2) : '0.00';
                
                let percent = 0;
                if (data.estimatedSeconds > 0) {
                    percent = Math.min(100, Math.max(0, (data.totalSeconds / data.estimatedSeconds) * 100));
                }

                const itemHtml = `
                    <div style="background: rgba(255,255,255,0.02); padding: 1rem; border-radius: 12px; border: 1px solid var(--glass-border);">
                        <div style="display: flex; justify-content: space-between; font-weight: 600; margin-bottom: 0.5rem; color: var(--text-primary);">
                            <span>${pName}</span>
                            <span style="color: var(--accent);">${data.estimatedSeconds > 0 ? percent.toFixed(1) + '%' : ''}</span>
                        </div>
                        <div class="progress-bar-bg" style="margin-bottom: 0.5rem; height: 6px;">
                            <div class="progress-bar-fill" style="width: ${percent}%;"></div>
                        </div>
                        <div style="display: flex; justify-content: space-between; font-family: 'JetBrains Mono', monospace; font-size: 0.8rem; color: var(--text-secondary);">
                            <span>Total: ${spentH}h</span>
                            <span>Est: ${estH}h</span>
                        </div>
                    </div>
                `;
                projectStatsContent.innerHTML += itemHtml;
            });
        }
    }

    saveEditBtn.addEventListener('click', () => {
        if (!editingLogId) return;
        
        const newProject = editLogProject.value.trim();
        const newTag = editLogTag.value;
        const newDurationMinutes = parseFloat(editLogDuration.value);
        const newDuration = Math.round(newDurationMinutes * 60);
        
        if (isNaN(newDuration) || newDuration < 1) {
            alert('Duration must be at least a fraction of a minute (e.g. 0.1).');
            return;
        }

        let logs = JSON.parse(localStorage.getItem('cubi_logs') || '[]');
        const logIndex = logs.findIndex(l => l.id === editingLogId);
        
        if (logIndex !== -1) {
            const oldLog = logs[logIndex];
            
            if (oldLog.project) updateProjectTimeRaw(oldLog.project, -oldLog.duration);
            if (newProject) updateProjectTimeRaw(newProject, newDuration);
            
            logs[logIndex].project = newProject;
            logs[logIndex].tag = newTag;
            logs[logIndex].duration = newDuration;
            
            localStorage.setItem('cubi_logs', JSON.stringify(logs));
        }
        
        editModal.style.display = 'none';
        editingLogId = null;
        loadLogs();
        updateProjectUI();
        showProjectStats();
    });

    // ── Audio Synthesis (Web Audio API) ──────────────────────────────
    // All sounds are generated procedurally — no audio files needed.
    // Three profiles: 'mechanical' (realistic clock), 'electronic'
    // (classic digital beeps), 'mute' (silent).
    function initAudio() {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
    }

    function playTick() {
        if (!audioCtx) return;
        const profile = soundSelect.value;
        if (profile === 'mute') return;

        if (profile === 'electronic') {
            const t = audioCtx.currentTime;
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'square';
            osc.frequency.value = 800;
            gain.gain.setValueAtTime(0.02, t);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start(t);
            osc.stop(t + 0.05);
            return;
        }

        const playMechanicalTick = (timeOffset, isTock) => {
            const t = audioCtx.currentTime + timeOffset;
            
            const osc = audioCtx.createOscillator();
            const oscGain = audioCtx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(isTock ? 400 : 600, t);
            osc.frequency.exponentialRampToValueAtTime(50, t + 0.03);
            oscGain.gain.setValueAtTime(0.5, t);
            oscGain.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
            
            const bufferSize = Math.floor(audioCtx.sampleRate * 0.02);
            const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
            const data = buffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) {
                data[i] = Math.random() * 2 - 1;
            }
            const noise = audioCtx.createBufferSource();
            noise.buffer = buffer;
            
            const noiseFilter = audioCtx.createBiquadFilter();
            noiseFilter.type = 'highpass';
            noiseFilter.frequency.value = 4000;
            
            const noiseGain = audioCtx.createGain();
            noiseGain.gain.setValueAtTime(0.3, t);
            noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.02);
            
            osc.connect(oscGain);
            oscGain.connect(audioCtx.destination);
            
            noise.connect(noiseFilter);
            noiseFilter.connect(noiseGain);
            noiseGain.connect(audioCtx.destination);
            
            osc.start(t);
            osc.stop(t + 0.03);
            noise.start(t);
        };

        playMechanicalTick(0, false);
        playMechanicalTick(0.15, true);
    }

    function playAlarm() {
        if (!audioCtx) return;
        const profile = soundSelect.value;
        if (profile === 'mute') return;
        
        if (profile === 'electronic') {
            const playBeep = (timeOffset) => {
                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();
                osc.type = 'square';
                osc.frequency.value = 1000;
                gain.gain.setValueAtTime(0.1, audioCtx.currentTime + timeOffset);
                gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + timeOffset + 0.1);
                osc.connect(gain);
                gain.connect(audioCtx.destination);
                osc.start(audioCtx.currentTime + timeOffset);
                osc.stop(audioCtx.currentTime + timeOffset + 0.1);
            };
            for(let i=0; i<5; i++) playBeep(i * 0.2);
            return;
        }

        const playRing = (timeOffset) => {
            const osc1 = audioCtx.createOscillator();
            const osc2 = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            
            osc1.type = 'sine';
            osc1.frequency.value = 800;
            
            osc2.type = 'sine';
            osc2.frequency.value = 830;
            
            gain.gain.setValueAtTime(0.3, audioCtx.currentTime + timeOffset);
            gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + timeOffset + 0.1);
            
            osc1.connect(gain);
            osc2.connect(gain);
            gain.connect(audioCtx.destination);
            
            osc1.start(audioCtx.currentTime + timeOffset);
            osc2.start(audioCtx.currentTime + timeOffset);
            osc1.stop(audioCtx.currentTime + timeOffset + 0.1);
            osc2.stop(audioCtx.currentTime + timeOffset + 0.1);
        };

        for(let i=0; i<10; i++) {
            playRing(i * 0.1);
        }
    }

    function playWarning() {
        if (!audioCtx) return;
        const profile = soundSelect.value;
        if (profile === 'mute') return;

        if (profile === 'electronic') {
            const playDing = (timeOffset) => {
                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();
                osc.type = 'sine';
                osc.frequency.value = 1200;
                gain.gain.setValueAtTime(0.1, audioCtx.currentTime + timeOffset);
                gain.gain.linearRampToValueAtTime(0.01, audioCtx.currentTime + timeOffset + 0.1);
                osc.connect(gain);
                gain.connect(audioCtx.destination);
                osc.start(audioCtx.currentTime + timeOffset);
                osc.stop(audioCtx.currentTime + timeOffset + 0.1);
            };
            playDing(0); playDing(0.2); playDing(0.4);
            return;
        }

        const playDing = (timeOffset) => {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            
            osc.type = 'sine';
            osc.frequency.setValueAtTime(1200, audioCtx.currentTime + timeOffset);
            osc.frequency.exponentialRampToValueAtTime(800, audioCtx.currentTime + timeOffset + 0.1);
            
            gain.gain.setValueAtTime(0.2, audioCtx.currentTime + timeOffset);
            gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + timeOffset + 0.1);
            
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            
            osc.start(audioCtx.currentTime + timeOffset);
            osc.stop(audioCtx.currentTime + timeOffset + 0.1);
        };
        // 3 quick dings
        playDing(0);
        playDing(0.15);
        playDing(0.3);
    }

    // ── Timer Logic ──────────────────────────────────────────────────
    function startPomodoro() {
        const durationMinutes = parseFloat(durationSelect.value);
        targetTimeMs = durationMinutes * 60 * 1000;
        startTimeMs = Date.now();
        elapsedMs = 0;
        lastTickMinute = 0;
        warningPlayed = false;
        
        state = 'POMODORO';
        cubiBtn.classList.add('active');
        timerPanel.className = 'timer-glass-panel state-pomodoro';
        statusIndicator.textContent = `Focusing on [${currentTag}]`;
        
        durationSelect.disabled = true;
        
        timerInterval = setInterval(updateTimer, 100); // 100ms for smooth updates if needed, though we show seconds
        playTick(); // Initial tick
        updateTimer();
    }

    function updateTimer() {
        const now = Date.now();
        const runTime = now - startTimeMs;
        
        // Play tick sound every minute during POMODORO and OVERTIME
        if (state === 'POMODORO' || state === 'OVERTIME') {
            const elapsedMinutes = Math.floor(runTime / 60000);
            if (elapsedMinutes > lastTickMinute) {
                if (state === 'OVERTIME') {
                    playTick();
                    setTimeout(playTick, 500); // Double tick to remind it's overtime
                } else {
                    playTick();
                }
                lastTickMinute = elapsedMinutes;
            }
        }

        if (state === 'REST') {
            const remaining = targetTimeMs - runTime;
            if (remaining <= 0) {
                playWarning(); // Signal rest is over
                resetToIdle();
            } else {
                updateDisplay(remaining / 1000);
            }
        } else if (state === 'POMODORO') {
            const remaining = targetTimeMs - runTime;
            
            if (remaining <= 5000 && !warningPlayed) {
                playWarning();
                warningPlayed = true;
            }

            if (remaining <= 0) {
                // Time is up, transition to flashing
                enterFlashingState();
            } else {
                updateDisplay(remaining / 1000);
            }
        } else if (state === 'FLASHING') {
            // FLASHING lasts exactly 15 seconds with red border animation.
            // After 15s, we assume the user is in a flow state and switch
            // to OVERTIME which counts up silently with an orange display.
            const overtimeMs = runTime - targetTimeMs;
            if (overtimeMs >= 15000) {
                enterOvertimeState(runTime);
            }
            updateDisplay(Math.abs(targetTimeMs - runTime) / 1000); // Show 0 or slightly negative
        } else if (state === 'OVERTIME') {
            const overtimeMs = runTime - targetTimeMs;
            updateDisplay(overtimeMs / 1000, true);
        }
    }

    function enterFlashingState() {
        state = 'FLASHING';
        timerPanel.className = 'timer-glass-panel state-flash';
        statusIndicator.textContent = 'Time Up! Click to Stop';
        playAlarm();
    }

    function enterOvertimeState(runTime) {
        state = 'OVERTIME';
        timerPanel.className = 'timer-glass-panel state-overtime';
        statusIndicator.textContent = 'Flow State: Overtime';
    }

    function stopTimer() {
        clearInterval(timerInterval);
        
        const totalRunTime = Date.now() - startTimeMs;
        const totalSeconds = Math.floor(totalRunTime / 1000);
        const wasCompleted = (state === 'FLASHING' || state === 'OVERTIME');
        
        // Only log sessions > 10 seconds to avoid accidental taps
        if (totalSeconds > 10) {
            saveLog(currentTag, totalSeconds, state === 'OVERTIME');
            updateProjectTime(totalSeconds);
        }

        if (wasCompleted) {
            pomodoroCount++;
            startRest();
        } else {
            resetToIdle();
        }
    }

    function startRest() {
        // Standard Pomodoro technique: 5 min rest, every 4th cycle → 15 min
        const restMinutes = (pomodoroCount % 4 === 0) ? 15 : 5;
        targetTimeMs = restMinutes * 60 * 1000;
        startTimeMs = Date.now();
        elapsedMs = 0;
        lastTickMinute = 0;
        
        state = 'REST';
        cubiBtn.classList.remove('active');
        cubiBtn.classList.add('resting');
        timerPanel.className = 'timer-glass-panel state-rest';
        statusIndicator.textContent = restMinutes === 15 ? 'Long Rest' : 'Short Rest';
        
        if (skipRestBtn) skipRestBtn.style.display = 'block';
        durationSelect.disabled = true;
        
        timerInterval = setInterval(updateTimer, 100);
        updateTimer();
    }

    function resetToIdle() {
        clearInterval(timerInterval);
        state = 'IDLE';
        cubiBtn.classList.remove('active');
        cubiBtn.classList.remove('resting');
        timerPanel.className = 'timer-glass-panel';
        statusIndicator.textContent = 'Ready to Focus';
        durationSelect.disabled = false;
        if (skipRestBtn) skipRestBtn.style.display = 'none';
        
        updateDisplay(parseFloat(durationSelect.value) * 60);
    }

    // ── Display Utilities ────────────────────────────────────────────
    function updateDisplay(totalSeconds, isOvertime = false) {
        const sign = isOvertime ? '+' : '';
        const absSeconds = Math.floor(Math.abs(totalSeconds));
        const m = Math.floor(absSeconds / 60).toString().padStart(2, '0');
        const s = (absSeconds % 60).toString().padStart(2, '0');
        timeDisplay.textContent = `${sign}${m}:${s}`;
    }

    function saveLog(tag, durationSeconds, isOvertime) {
        const log = {
            id: Date.now(),
            tag,
            project: projectInput.value.trim(),
            duration: durationSeconds,
            isOvertime,
            timestamp: new Date().toISOString()
        };

        let logs = JSON.parse(localStorage.getItem('cubi_logs') || '[]');
        logs.unshift(log);
        localStorage.setItem('cubi_logs', JSON.stringify(logs));
        
        renderLog(log);
        showProjectStats(); // Update dashboard stats live
    }

    function loadLogs() {
        let logs = JSON.parse(localStorage.getItem('cubi_logs') || '[]');
        
        if (!logFilter || logFilter.value === 'today') {
            const today = new Date().toDateString();
            logs = logs.filter(log => new Date(log.timestamp).toDateString() === today);
        }
        
        logList.innerHTML = '';
        logs.forEach(renderLog);
        showProjectStats(); // Ensure stats are rendered initially
    }

    function renderLog(log) {
        const li = document.createElement('li');
        li.className = `log-item ${log.isOvertime ? 'overtime' : ''}`;
        
        const m = Math.floor(log.duration / 60);
        const s = log.duration % 60;
        const timeString = m > 0 ? `${m}m ${s}s` : `${s}s`;
        
        const timeObj = new Date(log.timestamp);
        let timeFormat = `${timeObj.getHours().toString().padStart(2, '0')}:${timeObj.getMinutes().toString().padStart(2, '0')}`;
        
        const today = new Date().toDateString();
        if (timeObj.toDateString() !== today) {
            const month = (timeObj.getMonth() + 1).toString().padStart(2, '0');
            const day = timeObj.getDate().toString().padStart(2, '0');
            timeFormat = `${month}-${day} ` + timeFormat;
        }

        li.innerHTML = `
            <div class="log-tag">
                <span style="opacity:0.7; font-size:0.8em; margin-right:5px;">${log.project || ''}</span>
                ${log.tag} ${log.isOvertime ? '🚀' : '✅'}
            </div>
            <div class="log-details">
                <span>${timeFormat}</span>
                <span class="log-duration">${timeString}</span>
                <button class="edit-log-btn" data-id="${log.id}" title="Edit log">✏️</button>
            </div>
        `;
        
        li.querySelector('.edit-log-btn').addEventListener('click', () => {
            editingLogId = log.id;
            editLogProject.value = log.project || '';
            editLogTag.value = log.tag;
            editLogDuration.value = +(log.duration / 60).toFixed(2);
            editModal.style.display = 'flex';
        });

        logList.append(li);
    }

    // ── Project Management ───────────────────────────────────────────
    // All project data is stored in localStorage under 'cubi_projects'.
    // Each project tracks { totalSeconds, estimatedSeconds }.
    function getProjects() {
        return JSON.parse(localStorage.getItem('cubi_projects') || '{}');
    }

    function saveProjects(projects) {
        localStorage.setItem('cubi_projects', JSON.stringify(projects));
        populateProjectList();
    }

    function populateProjectList() {
        const projects = getProjects();
        projectList.innerHTML = '';
        Object.keys(projects).forEach(pName => {
            const option = document.createElement('option');
            option.value = pName;
            projectList.appendChild(option);
        });
    }

    function updateProjectEstimate() {
        const pName = projectInput.value.trim();
        const est = parseFloat(estimateInput.value) || 0;
        if (pName && est > 0) {
            const projects = getProjects();
            if (!projects[pName]) projects[pName] = { totalSeconds: 0 };
            projects[pName].estimatedSeconds = est * 3600;
            saveProjects(projects);
        }
        updateProjectUI();
    }

    function updateProjectTimeRaw(pName, durationDiff) {
        if (!pName) return;
        const projects = getProjects();
        if (!projects[pName]) {
            projects[pName] = { totalSeconds: 0, estimatedSeconds: 0 };
        }
        projects[pName].totalSeconds = Math.max(0, projects[pName].totalSeconds + durationDiff);
        saveProjects(projects);
    }

    function updateProjectTime(sessionSeconds) {
        const pName = projectInput.value.trim();
        if (!pName) return;

        const projects = getProjects();
        if (!projects[pName]) {
            projects[pName] = { totalSeconds: 0, estimatedSeconds: (parseFloat(estimateInput.value) || 0) * 3600 };
        }
        projects[pName].totalSeconds += sessionSeconds;
        saveProjects(projects);
        updateProjectUI();
    }

    function updateProjectUI() {
        const pName = projectInput.value.trim();
        if (!pName) {
            progressSection.style.display = 'none';
            return;
        }

        const projects = getProjects();
        const projectData = projects[pName] || { totalSeconds: 0, estimatedSeconds: 0 };
        
        // Ensure estimate input reflects saved data if any, and only if not currently editing
        if (projectData.estimatedSeconds && document.activeElement !== estimateInput) {
            estimateInput.value = projectData.estimatedSeconds / 3600;
        }

        const est = parseFloat(estimateInput.value) || 0;
        const estSeconds = est * 3600;
        const spentSeconds = projectData.totalSeconds;

        progressProjectName.textContent = pName;
        progressTimeSpent.textContent = (spentSeconds / 3600).toFixed(2) + 'h';
        progressTimeEst.textContent = (estSeconds / 3600).toFixed(2) + 'h';

        if (estSeconds > 0) {
            const percent = Math.min(100, Math.max(0, (spentSeconds / estSeconds) * 100));
            progressPercentage.textContent = percent.toFixed(1) + '%';
            progressBarFill.style.width = percent + '%';
            progressSection.style.display = 'block';
        } else {
            progressPercentage.textContent = '0%';
            progressBarFill.style.width = '0%';
            if (spentSeconds > 0) {
                progressSection.style.display = 'block'; // Still show spent time if there's no estimate yet
            } else {
                progressSection.style.display = 'none';
            }
        }
    }

    // Init UI
    updateDisplay(parseFloat(durationSelect.value) * 60);
});
