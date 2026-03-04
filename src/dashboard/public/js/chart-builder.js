/**
 * DarkLock Chart Builder v1
 * Enables users to create fully custom chart widgets on the bot dashboard.
 * Persists configs to localStorage, integrates with WidgetSystem.
 */
(function () {
    'use strict';

    // ── Data Source Definitions ──────────────────────────────────
    const CB_SOURCES = [
        {
            id: 'member-joins', label: 'Member Joins', icon: 'user-plus', type: 'timeseries',
            extract(d) {
                const ma = d.memberActivity || [];
                return {
                    labels: ma.map(r => _cbDate(r.date)),
                    datasets: [{ label: 'Joins', data: ma.map(r => r.joins || 0) }]
                };
            }
        },
        {
            id: 'member-leaves', label: 'Member Leaves', icon: 'user-minus', type: 'timeseries',
            extract(d) {
                const ma = d.memberActivity || [];
                return {
                    labels: ma.map(r => _cbDate(r.date)),
                    datasets: [{ label: 'Leaves', data: ma.map(r => r.leaves || 0) }]
                };
            }
        },
        {
            id: 'messages', label: 'Messages', icon: 'comments', type: 'timeseries',
            extract(d) {
                const ma = d.memberActivity || [];
                return {
                    labels: ma.map(r => _cbDate(r.date)),
                    datasets: [{ label: 'Messages', data: ma.map(r => r.messages || 0) }]
                };
            }
        },
        {
            id: 'commands', label: 'Commands', icon: 'terminal', type: 'timeseries',
            extract(d) {
                const cu = d.commandUsage || [];
                return {
                    labels: cu.map(r => _cbDate(r.date)),
                    datasets: [{ label: 'Commands', data: cu.map(r => r.count || 0) }]
                };
            }
        },
        {
            id: 'mod-breakdown', label: 'Mod Actions', icon: 'gavel', type: 'categorical',
            extract(d) {
                const m = d.moderation || {};
                return {
                    labels: ['Warns', 'Kicks', 'Bans', 'Timeouts'],
                    datasets: [{ label: 'Actions', data: [m.warns || 0, m.kicks || 0, m.bans || 0, m.timeouts || 0] }]
                };
            }
        },
        {
            id: 'joins-vs-leaves', label: 'Joins vs Leaves', icon: 'exchange-alt', type: 'timeseries',
            extract(d) {
                const ma = d.memberActivity || [];
                return {
                    labels: ma.map(r => _cbDate(r.date)),
                    datasets: [
                        { label: 'Joins', data: ma.map(r => r.joins || 0) },
                        { label: 'Leaves', data: ma.map(r => r.leaves || 0) }
                    ]
                };
            }
        },
        {
            id: 'mod-trend', label: 'Mod Trend', icon: 'chart-line', type: 'timeseries',
            extract(d) {
                const t = d.moderationTrend || [];
                return {
                    labels: t.map(r => _cbDate(r.date)),
                    datasets: [
                        { label: 'Warns', data: t.map(r => r.warns || 0) },
                        { label: 'Kicks', data: t.map(r => r.kicks || 0) },
                        { label: 'Bans', data: t.map(r => r.bans || 0) },
                        { label: 'Timeouts', data: t.map(r => r.timeouts || 0) }
                    ]
                };
            }
        },
        {
            id: 'full-activity', label: 'All Activity', icon: 'layer-group', type: 'timeseries',
            extract(d) {
                const ma = d.memberActivity || [];
                const cu = d.commandUsage || [];
                return {
                    labels: ma.map(r => _cbDate(r.date)),
                    datasets: [
                        { label: 'Joins', data: ma.map(r => r.joins || 0) },
                        { label: 'Leaves', data: ma.map(r => r.leaves || 0) },
                        { label: 'Messages', data: ma.map(r => r.messages || 0) },
                        { label: 'Commands', data: cu.map(r => r.count || 0) }
                    ]
                };
            }
        }
    ];

    // ── Chart Types ─────────────────────────────────────────────
    const CB_TYPES = [
        { id: 'line',     label: 'Line',     icon: 'chart-line',       forTypes: ['timeseries', 'categorical'] },
        { id: 'bar',      label: 'Bar',      icon: 'chart-bar',        forTypes: ['timeseries', 'categorical'] },
        { id: 'area',     label: 'Area',     icon: 'chart-area',       forTypes: ['timeseries'] },
        { id: 'stacked',  label: 'Stacked',  icon: 'layer-group',      forTypes: ['timeseries'] },
        { id: 'scatter',  label: 'Scatter',  icon: 'braille',          forTypes: ['timeseries'] },
        { id: 'doughnut', label: 'Doughnut', icon: 'circle-notch',     forTypes: ['categorical'] },
        { id: 'pie',      label: 'Pie',      icon: 'chart-pie',        forTypes: ['categorical'] },
        { id: 'polar',    label: 'Polar',    icon: 'bullseye',         forTypes: ['categorical'] },
        { id: 'radar',    label: 'Radar',    icon: 'drafting-compass', forTypes: ['timeseries', 'categorical'] }
    ];

    // ── Color Themes ────────────────────────────────────────────
    const CB_THEMES = {
        neon:   { name: 'Neon',    colors: ['#00d4ff', '#7c3aed', '#ec4899', '#10b981'] },
        ocean:  { name: 'Ocean',   colors: ['#00d4ff', '#0ea5e9', '#0284c7', '#0369a1'] },
        sunset: { name: 'Sunset',  colors: ['#f97316', '#ef4444', '#ec4899', '#f59e0b'] },
        forest: { name: 'Forest',  colors: ['#10b981', '#059669', '#34d399', '#6ee7b7'] },
        mono:   { name: 'Mono',    colors: ['#e5e7eb', '#9ca3af', '#6b7280', '#4b5563'] },
        warm:   { name: 'Warm',    colors: ['#f59e0b', '#ef4444', '#ec4899', '#f97316'] }
    };

    // ── Helpers ──────────────────────────────────────────────────
    function _cbDate(dateStr) {
        if (!dateStr) return '';
        return new Date(dateStr).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    }

    function _cbHex2rgba(hex, a) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r},${g},${b},${a})`;
    }

    function _cbEsc(s) {
        return (s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    // ── Chart Builder Class ─────────────────────────────────────
    class DLChartBuilder {
        constructor() {
            this.storageKey = 'dl_custom_charts';
            this.configs = this._load();
            this._overlay = null;
            this._previewChart = null;
            this._editId = null;
            this._state = { title: '', dataSource: '', chartType: '', colorTheme: 'neon' };
        }

        /* ── Persistence ──────────────────────────────── */
        _load() {
            try {
                const raw = localStorage.getItem(this.storageKey);
                return raw ? JSON.parse(raw) : [];
            } catch { return []; }
        }

        _save() {
            try { localStorage.setItem(this.storageKey, JSON.stringify(this.configs)); } catch (e) {
                console.error('[CB] save error', e);
            }
        }

        /* ── Widget def generation (for WidgetSystem) ── */
        getWidgetDefs() {
            return this.configs.map(cfg => {
                const ds = CB_SOURCES.find(s => s.id === cfg.dataSource);
                const dsType = ds ? ds.type : 'timeseries';
                const views = CB_TYPES.filter(t => t.forTypes.includes(dsType))
                    .map(t => ({ id: t.id, label: t.label, icon: t.icon }));
                const ct = CB_TYPES.find(t => t.id === cfg.chartType);
                return {
                    id: cfg.id,
                    title: cfg.title || 'Custom Chart',
                    icon: ct ? ct.icon : 'chart-bar',
                    description: cfg.description || 'Custom chart',
                    colSpan: 1,
                    views: views,
                    defaultView: cfg.chartType || 'line',
                    _custom: true
                };
            });
        }

        /* ── Open modal ───────────────────────────────── */
        open(editId) {
            this._editId = editId || null;
            if (editId) {
                const cfg = this.configs.find(c => c.id === editId);
                if (cfg) {
                    this._state = { title: cfg.title, dataSource: cfg.dataSource, chartType: cfg.chartType, colorTheme: cfg.colorTheme || 'neon' };
                } else {
                    this._state = { title: '', dataSource: '', chartType: '', colorTheme: 'neon' };
                    this._editId = null;
                }
            } else {
                this._state = { title: '', dataSource: '', chartType: '', colorTheme: 'neon' };
            }
            this._buildModal();
        }

        close() {
            if (this._previewChart) { this._previewChart.destroy(); this._previewChart = null; }
            if (this._overlay) {
                this._overlay.classList.remove('open');
                setTimeout(() => { if (this._overlay) { this._overlay.remove(); this._overlay = null; } }, 260);
            }
        }

        /* ── Build modal DOM ──────────────────────────── */
        _buildModal() {
            if (this._overlay) this._overlay.remove();

            const ov = document.createElement('div');
            ov.className = 'cb-overlay';
            ov.addEventListener('click', e => { if (e.target === ov) this.close(); });

            const modal = document.createElement('div');
            modal.className = 'cb-modal';
            modal.innerHTML = this._html();
            ov.appendChild(modal);

            document.body.appendChild(ov);
            this._overlay = ov;
            requestAnimationFrame(() => ov.classList.add('open'));

            this._bind(modal);
            this._sync(modal);
            if (this._state.dataSource) this._filterTypes(modal);
            if (this._state.dataSource && this._state.chartType) {
                setTimeout(() => this._preview(), 120);
            }
        }

        _html() {
            const s = this._state;
            const editing = !!this._editId;

            let h = `
<div class="cb-header">
    <div class="cb-title"><i class="fas fa-palette"></i> ${editing ? 'Edit Chart' : 'Chart Builder'}</div>
    <button class="cb-close" data-cb="close"><i class="fas fa-times"></i></button>
</div>

<div class="cb-section">Chart Title</div>
<input class="cb-input" data-cb="title" type="text" placeholder="My Custom Chart" value="${_cbEsc(s.title)}" maxlength="50" autocomplete="off">

<div class="cb-section">Data Source</div>
<div class="cb-grid" data-cb="sources">`;
            for (const src of CB_SOURCES) {
                h += `<div class="cb-tile" data-src="${src.id}"><i class="fas fa-${src.icon}"></i><span>${src.label}</span></div>`;
            }
            h += `</div>

<div class="cb-section">Chart Type</div>
<div class="cb-grid cb-grid--types" data-cb="types">`;
            for (const ct of CB_TYPES) {
                h += `<div class="cb-tile" data-ctype="${ct.id}"><i class="fas fa-${ct.icon}"></i><span>${ct.label}</span></div>`;
            }
            h += `</div>

<div class="cb-section">Color Theme</div>
<div class="cb-grid cb-grid--colors" data-cb="themes">`;
            for (const [key, theme] of Object.entries(CB_THEMES)) {
                const dots = theme.colors.map(c => `<div class="cb-color-dot" style="background:${c}"></div>`).join('');
                h += `<div class="cb-tile cb-color-tile" data-theme="${key}"><div class="cb-color-swatch">${dots}</div><span>${theme.name}</span></div>`;
            }
            h += `</div>

<div class="cb-section">Preview</div>
<div class="cb-preview" data-cb="preview">
    <div class="cb-preview-empty"><i class="fas fa-chart-bar"></i><span>Select data source &amp; chart type</span></div>
</div>

<div class="cb-footer">`;
            if (editing) h += `<button class="cb-btn cb-btn--delete" data-cb="delete"><i class="fas fa-trash"></i> Delete</button>`;
            h += `<button class="cb-btn cb-btn--cancel" data-cb="cancel">Cancel</button>`;
            h += `<button class="cb-btn cb-btn--save" data-cb="save"><i class="fas fa-save"></i> ${editing ? 'Update' : 'Create'} Chart</button>`;
            h += `</div>`;
            return h;
        }

        /* ── Bind events ──────────────────────────────── */
        _bind(modal) {
            const q = s => modal.querySelector(s);
            const qa = s => modal.querySelectorAll(s);

            q('[data-cb="close"]').onclick = () => this.close();
            q('[data-cb="cancel"]').onclick = () => this.close();
            q('[data-cb="title"]').oninput = e => { this._state.title = e.target.value; };

            qa('[data-cb="sources"] .cb-tile').forEach(t => t.onclick = () => {
                this._state.dataSource = t.dataset.src;
                this._sync(modal);
                this._filterTypes(modal);
                this._preview();
            });

            qa('[data-cb="types"] .cb-tile').forEach(t => t.onclick = () => {
                if (t.classList.contains('cb-tile--disabled')) return;
                this._state.chartType = t.dataset.ctype;
                this._sync(modal);
                this._preview();
            });

            qa('[data-cb="themes"] .cb-tile').forEach(t => t.onclick = () => {
                this._state.colorTheme = t.dataset.theme;
                this._sync(modal);
                this._preview();
            });

            q('[data-cb="save"]').onclick = () => this._saveChart();

            const del = q('[data-cb="delete"]');
            if (del) del.onclick = () => this._deleteChart();
        }

        /* ── Sync selected states ─────────────────────── */
        _sync(modal) {
            const s = this._state;
            modal.querySelectorAll('[data-cb="sources"] .cb-tile').forEach(t =>
                t.classList.toggle('selected', t.dataset.src === s.dataSource));
            modal.querySelectorAll('[data-cb="types"] .cb-tile').forEach(t =>
                t.classList.toggle('selected', t.dataset.ctype === s.chartType));
            modal.querySelectorAll('[data-cb="themes"] .cb-tile').forEach(t =>
                t.classList.toggle('selected', t.dataset.theme === s.colorTheme));
        }

        /* ── Filter chart types by data source type ──── */
        _filterTypes(modal) {
            const ds = CB_SOURCES.find(s => s.id === this._state.dataSource);
            const dsType = ds ? ds.type : 'timeseries';
            modal.querySelectorAll('[data-cb="types"] .cb-tile').forEach(t => {
                const ct = CB_TYPES.find(c => c.id === t.dataset.ctype);
                const ok = ct && ct.forTypes.includes(dsType);
                t.classList.toggle('cb-tile--disabled', !ok);
                if (!ok && t.dataset.ctype === this._state.chartType) {
                    this._state.chartType = '';
                    t.classList.remove('selected');
                }
            });
        }

        /* ── Live preview ─────────────────────────────── */
        _preview() {
            const s = this._state;
            const container = this._overlay?.querySelector('[data-cb="preview"]');
            if (!container) return;

            if (!s.dataSource || !s.chartType) {
                container.innerHTML = '<div class="cb-preview-empty"><i class="fas fa-chart-bar"></i><span>Select data source &amp; chart type</span></div>';
                return;
            }

            if (this._previewChart) { this._previewChart.destroy(); this._previewChart = null; }

            const ds = CB_SOURCES.find(d => d.id === s.dataSource);
            if (!ds) return;

            const analyticsData = (typeof _cachedAnalyticsData !== 'undefined') ? _cachedAnalyticsData : {};
            const extracted = ds.extract(analyticsData);
            const theme = CB_THEMES[s.colorTheme] || CB_THEMES.neon;

            const canvasId = '_cbPreview_' + Date.now();
            container.innerHTML = `<canvas id="${canvasId}"></canvas>`;
            const ctx = document.getElementById(canvasId);
            if (!ctx) return;

            const config = this._chartConfig(s.chartType, extracted, theme.colors);
            this._previewChart = new Chart(ctx, config);
        }

        /* ── Build Chart.js config ────────────────────── */
        _chartConfig(chartType, extracted, colors) {
            const { labels, datasets } = extracted;

            // Categorical types: doughnut, pie, polar
            if (['doughnut', 'pie', 'polar'].includes(chartType)) {
                const cjsType = chartType === 'polar' ? 'polarArea' : chartType;
                return {
                    type: cjsType,
                    data: {
                        labels,
                        datasets: [{
                            data: datasets[0]?.data || [],
                            backgroundColor: labels.map((_, i) => colors[i % colors.length]),
                            borderWidth: 0
                        }]
                    },
                    options: {
                        responsive: true, maintainAspectRatio: false,
                        cutout: chartType === 'doughnut' ? '65%' : undefined,
                        plugins: { legend: { position: 'bottom', labels: { padding: 16, usePointStyle: true, color: 'rgba(255,255,255,0.7)' } } }
                    }
                };
            }

            // Scatter
            if (chartType === 'scatter') {
                return {
                    type: 'scatter',
                    data: {
                        datasets: datasets.map((ds, i) => ({
                            label: ds.label,
                            data: (ds.data || []).map((y, x) => ({ x, y })),
                            backgroundColor: colors[i % colors.length],
                            pointRadius: 6
                        }))
                    },
                    options: {
                        responsive: true, maintainAspectRatio: false,
                        plugins: { legend: { position: 'bottom', labels: { padding: 16, usePointStyle: true, color: 'rgba(255,255,255,0.7)' } } },
                        scales: {
                            y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: 'rgba(255,255,255,0.5)' } },
                            x: { ticks: { callback: v => labels[v] || v, color: 'rgba(255,255,255,0.5)' }, grid: { display: false } }
                        }
                    }
                };
            }

            // Radar
            if (chartType === 'radar') {
                return {
                    type: 'radar',
                    data: {
                        labels,
                        datasets: datasets.map((ds, i) => ({
                            label: ds.label,
                            data: ds.data || [],
                            borderColor: colors[i % colors.length],
                            backgroundColor: _cbHex2rgba(colors[i % colors.length], 0.15),
                            pointBackgroundColor: colors[i % colors.length]
                        }))
                    },
                    options: {
                        responsive: true, maintainAspectRatio: false,
                        plugins: { legend: { position: 'bottom', labels: { padding: 16, usePointStyle: true, color: 'rgba(255,255,255,0.7)' } } },
                        scales: { r: { grid: { color: 'rgba(255,255,255,0.08)' }, ticks: { display: false } } }
                    }
                };
            }

            // Line, bar, area, stacked
            const isBar = (chartType === 'bar' || chartType === 'stacked');
            const fill = (chartType === 'area');
            const stacked = (chartType === 'stacked');
            const cjsType = isBar ? 'bar' : 'line';

            return {
                type: cjsType,
                data: {
                    labels,
                    datasets: datasets.map((ds, i) => ({
                        label: ds.label,
                        data: ds.data || [],
                        borderColor: colors[i % colors.length],
                        backgroundColor: isBar
                            ? _cbHex2rgba(colors[i % colors.length], 0.6)
                            : _cbHex2rgba(colors[i % colors.length], 0.12),
                        fill,
                        tension: 0.4,
                        pointBackgroundColor: colors[i % colors.length],
                        pointRadius: isBar ? 0 : 4,
                        borderRadius: isBar ? 4 : 0,
                        stack: stacked ? 's' : undefined
                    }))
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: { legend: { position: 'bottom', labels: { padding: 16, usePointStyle: true, color: 'rgba(255,255,255,0.7)' } } },
                    scales: stacked
                        ? { y: { stacked: true, beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: 'rgba(255,255,255,0.5)' } }, x: { stacked: true, grid: { display: false }, ticks: { color: 'rgba(255,255,255,0.5)' } } }
                        : { y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: 'rgba(255,255,255,0.5)' } }, x: { grid: { display: false }, ticks: { color: 'rgba(255,255,255,0.5)' } } }
                }
            };
        }

        /* ── Save chart config ────────────────────────── */
        _saveChart() {
            const s = this._state;
            if (!s.title.trim()) { this._shake('[data-cb="title"]'); return; }
            if (!s.dataSource) { this._shake('[data-cb="sources"]'); return; }
            if (!s.chartType) { this._shake('[data-cb="types"]'); return; }

            const ds = CB_SOURCES.find(d => d.id === s.dataSource);

            if (this._editId) {
                const idx = this.configs.findIndex(c => c.id === this._editId);
                if (idx !== -1) {
                    this.configs[idx] = {
                        ...this.configs[idx],
                        title: s.title.trim(),
                        dataSource: s.dataSource,
                        chartType: s.chartType,
                        colorTheme: s.colorTheme,
                        description: ds ? ds.label + ' — ' + s.chartType : 'Custom chart',
                        updatedAt: Date.now()
                    };
                }
            } else {
                this.configs.push({
                    id: 'custom-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6),
                    title: s.title.trim(),
                    dataSource: s.dataSource,
                    chartType: s.chartType,
                    colorTheme: s.colorTheme,
                    description: ds ? ds.label + ' — ' + s.chartType : 'Custom chart',
                    createdAt: Date.now()
                });
            }

            this._save();
            this.close();
            this._refreshDashboard();
        }

        /* ── Delete chart config ──────────────────────── */
        _deleteChart() {
            if (!this._editId) return;
            this.configs = this.configs.filter(c => c.id !== this._editId);

            // Clean from layout too
            try {
                const raw = localStorage.getItem('dl_dashboard_layout');
                if (raw) {
                    const layout = JSON.parse(raw);
                    const filtered = layout.filter(l => l.id !== this._editId);
                    localStorage.setItem('dl_dashboard_layout', JSON.stringify(filtered));
                }
            } catch (e) { /* noop */ }

            this._save();
            this.close();
            this._refreshDashboard();
        }

        _refreshDashboard() {
            // Dashboard page
            if (typeof renderDashboard === 'function' && typeof _cachedOverview !== 'undefined') {
                renderDashboard(_cachedOverview, _cachedServerInfo);
                return;
            }
            // Analytics page
            if (typeof analyticsWidgetSystem !== 'undefined' && analyticsWidgetSystem && typeof analyticsWidgetSystem.refresh === 'function') {
                analyticsWidgetSystem.refresh();
                return;
            }
            // Generic fallback – refresh whichever WidgetSystem is active
            if (typeof dashboardWidgetSystem !== 'undefined' && dashboardWidgetSystem && typeof dashboardWidgetSystem.refresh === 'function') {
                dashboardWidgetSystem.refresh();
            }
        }

        _shake(selector) {
            const el = this._overlay?.querySelector(selector);
            if (!el) return;
            el.style.animation = 'none';
            void el.offsetHeight;
            el.style.animation = 'cbShake 0.4s ease';
        }

        /* ── Render custom chart inside a widget body ── */
        render(widgetId, viewId, container) {
            const cfg = this.configs.find(c => c.id === widgetId);
            if (!cfg) {
                container.innerHTML = '<p style="padding:1rem;color:rgba(255,255,255,0.4);text-align:center;">Chart config not found</p>';
                return;
            }

            const ds = CB_SOURCES.find(d => d.id === cfg.dataSource);
            if (!ds) {
                container.innerHTML = '<p style="padding:1rem;color:rgba(255,255,255,0.4);text-align:center;">Unknown data source</p>';
                return;
            }

            const analyticsData = (typeof _cachedAnalyticsData !== 'undefined') ? _cachedAnalyticsData : {};
            const extracted = ds.extract(analyticsData);
            const theme = CB_THEMES[cfg.colorTheme] || CB_THEMES.neon;
            const activeType = viewId || cfg.chartType || 'line';
            const config = this._chartConfig(activeType, extracted, theme.colors);

            const canvasId = 'cc_' + widgetId.replace(/[^a-z0-9]/gi, '') + '_' + Date.now();
            const safeId = _cbEsc(widgetId);
            container.innerHTML = `
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.5rem;">
                    <span class="cb-badge"><i class="fas fa-palette"></i> Custom</span>
                    <button class="ws-btn" title="Edit chart" onclick="window._dlChartBuilder.open('${safeId}')" style="font-size:10px;">
                        <i class="fas fa-pen"></i>
                    </button>
                </div>
                <canvas id="${canvasId}"></canvas>
            `;

            const ctx = document.getElementById(canvasId);
            if (ctx) {
                try { if (window.charts && window.charts[widgetId]) window.charts[widgetId].destroy(); } catch (e) { /* */ }
                const chart = new Chart(ctx, config);
                if (window.charts) window.charts[widgetId] = chart;
            }
        }
    }

    // ── Expose globally ─────────────────────────────────────────
    window._dlChartBuilder = new DLChartBuilder();
    window.CB_SOURCES = CB_SOURCES;
    window.CB_TYPES = CB_TYPES;
    window.CB_THEMES = CB_THEMES;

    console.log('%c[CB] Chart Builder loaded', 'color:#00d4ff;font-weight:bold', '| Custom charts:', window._dlChartBuilder.configs.length);
})();
