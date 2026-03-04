/**
 * DarkLock Widget System v3 — with debug logging
 */
console.log('%c[WS-FILE-LOADED] widget-system.js v3 executing', 'background:#00d4ff;color:#000;font-weight:bold;padding:2px 6px;border-radius:3px');
class WidgetSystem {
    constructor(opts) {
        this.storageKey   = opts.storageKey   || 'dl_widget_layout';
        this.gridSelector = opts.gridSelector || '.widget-grid';
        this.allWidgets   = opts.widgets      || [];
        this.renderFn     = opts.renderWidget;
        this.layout       = [];
        this.grid         = null;
        this._dragSrc     = null;
        this._openSwitcher = null;
        console.log('[WS] WidgetSystem created | storageKey:', this.storageKey, '| gridSelector:', this.gridSelector, '| widgets:', this.allWidgets.length);
    }

    init() {
        console.log('[WS] init() called for', this.gridSelector);
        this.grid = document.querySelector(this.gridSelector);
        if (!this.grid) {
            console.error('[WS] ❌ GRID NOT FOUND for selector:', this.gridSelector, '— available elements with class widget-grid:', document.querySelectorAll('.widget-grid').length);
            return;
        }
        console.log('[WS] ✅ Grid found:', this.grid);
        this.layout = this._load();
        console.log('[WS] Layout loaded:', JSON.stringify(this.layout));
        this._build();
        document.addEventListener('click', e => {
            if (this._openSwitcher && !e.target.closest('.ws-sw-menu') && !e.target.closest('.ws-switch-btn')) {
                this._closeSw();
            }
        });
    }

    refresh() {
        console.log('[WS] refresh() called');
        this._build();
    }

    toggleEditMode() { /* no-op for compat */ }

    resetLayout() {
        console.log('[WS] resetLayout() called');
        localStorage.removeItem(this.storageKey);
        this.layout = this.allWidgets.map(w => this._def(w));
        this._save();
        this._build();
    }

    _def(w) {
        return { id: w.id, viewId: w.defaultView || w.views?.[0]?.id || 'default', colSpan: w.colSpan || 1, visible: true };
    }

    _load() {
        try {
            const raw = localStorage.getItem(this.storageKey);
            if (raw) {
                const saved = JSON.parse(raw);
                console.log('[WS] Loaded saved layout from localStorage:', saved);
                const ids = new Set(this.allWidgets.map(w => w.id));
                const layout = saved.filter(l => ids.has(l.id));
                for (const w of this.allWidgets)
                    if (!layout.find(l => l.id === w.id)) layout.push(this._def(w));
                return layout;
            }
        } catch(e) { console.error('[WS] _load error:', e); }
        console.log('[WS] No saved layout, using defaults');
        return this.allWidgets.map(w => this._def(w));
    }

    _save() {
        try { localStorage.setItem(this.storageKey, JSON.stringify(this.layout)); } catch(e) {}
    }

    _build() {
        if (!this.grid) { console.error('[WS] _build: grid is null'); return; }
        this.grid.innerHTML = '';

        const visible = this.layout.filter(l => l.visible);
        const hidden  = this.layout.filter(l => !l.visible);
        console.log('[WS] _build() — visible:', visible.length, 'hidden:', hidden.length);

        for (const item of visible) {
            const def = this.allWidgets.find(w => w.id === item.id);
            if (def) {
                console.log('[WS] Building cell for:', item.id, '| def found:', !!def);
                this.grid.appendChild(this._cell(item, def));
            } else {
                console.warn('[WS] No def found for widget id:', item.id);
            }
        }

        if (hidden.length > 0) {
            const btn = document.createElement('div');
            btn.className = 'ws-add-btn';
            btn.innerHTML = '<i class="fas fa-plus-circle"></i><br><small>Add Widget</small>';
            btn.onclick = () => this._picker();
            this.grid.appendChild(btn);
            console.log('[WS] Added "Add Widget" button for', hidden.length, 'hidden widgets');
        }

        // Render content into ws-body elements
        console.log('[WS] Rendering widget content. renderFn present:', typeof this.renderFn);
        for (const item of visible) {
            const body = this.grid.querySelector('[data-wid="' + item.id + '"] .ws-body');
            console.log('[WS] Rendering', item.id, '| body found:', !!body);
            if (body && this.renderFn) {
                try { this.renderFn(item.id, item.viewId, body); }
                catch(e) {
                    console.error('[WS] renderFn error for', item.id, ':', e);
                    body.innerHTML = '<p style="padding:1rem;color:#ef4444">Error rendering widget</p>';
                }
            }
        }

        console.log('[WS] _build() complete. Grid children:', this.grid.children.length);
        console.log('[WS] Grid innerHTML length:', this.grid.innerHTML.length);
    }

    _cell(item, def) {
        console.log('[WS] _cell() building:', item.id, '| colSpan:', item.colSpan);
        const cell = document.createElement('div');
        cell.className = 'ws-cell';
        cell.dataset.wid = item.id;
        if (item.colSpan > 1) cell.style.gridColumn = 'span 2';

        const card = document.createElement('div');
        card.className = 'chart-container';
        card.style.cssText = 'margin-bottom:0;height:100%;display:flex;flex-direction:column;box-sizing:border-box;';

        // Header
        const hdr = document.createElement('div');
        hdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;gap:0.5rem;flex-wrap:nowrap;';

        const curView = def.views?.find(v => v.id === item.viewId) || def.views?.[0] || {};
        const title = document.createElement('div');
        title.className = 'chart-title';
        title.style.cssText = 'display:flex;align-items:center;gap:0.5rem;flex:1;min-width:0;';
        title.innerHTML = '<i class="fas fa-' + (curView.icon || def.icon || 'chart-bar') + '"></i><span>' + (curView.label || def.title) + '</span>';
        hdr.appendChild(title);

        // Controls — always visible via inline styles
        const ctrl = document.createElement('div');
        ctrl.style.cssText = 'display:flex;align-items:center;gap:4px;flex-shrink:0;z-index:10;';
        console.log('[WS] Creating controls for', item.id, '| views:', def.views?.length || 0);

        // Drag handle
        const drag = document.createElement('button');
        drag.className = 'ws-btn';
        drag.title = 'Drag to reorder';
        drag.innerHTML = '<i class="fas fa-grip-vertical"></i>';
        drag.style.cursor = 'grab';
        drag.addEventListener('mousedown', () => { cell.draggable = true; });
        ctrl.appendChild(drag);

        // Switch view
        if (def.views && def.views.length > 1) {
            const sw = document.createElement('button');
            sw.className = 'ws-btn ws-switch-btn';
            sw.title = 'Switch chart view';
            sw.innerHTML = '<i class="fas fa-layer-group"></i>';
            sw.addEventListener('click', e => { e.stopPropagation(); this._openSwitcher ? this._closeSw() : this._openSw(sw, item, def); });
            ctrl.appendChild(sw);
        }

        // Remove
        const rm = document.createElement('button');
        rm.className = 'ws-btn ws-remove-btn';
        rm.title = 'Remove widget';
        rm.innerHTML = '<i class="fas fa-times"></i>';
        rm.addEventListener('click', e => {
            e.stopPropagation();
            console.log('[WS] Removing widget:', item.id);
            item.visible = false;
            this._save();
            this._build();
        });
        ctrl.appendChild(rm);

        console.log('[WS] ctrl has', ctrl.children.length, 'buttons for', item.id);
        hdr.appendChild(ctrl);
        card.appendChild(hdr);

        // Body
        const body = document.createElement('div');
        body.className = 'ws-body chart-wrapper';
        body.style.cssText = 'flex:1;min-height:200px;height:auto;';
        card.appendChild(body);

        cell.appendChild(card);

        // Drag events
        cell.draggable = false;
        cell.addEventListener('dragstart', e => { this._dragSrc = cell; e.dataTransfer.setData('text/plain', item.id); cell.classList.add('ws-dragging'); });
        cell.addEventListener('dragend',   () => { this._dragSrc = null; cell.draggable = false; cell.classList.remove('ws-dragging'); this.grid && this.grid.querySelectorAll('.ws-over').forEach(c => c.classList.remove('ws-over')); });
        cell.addEventListener('dragover',  e => { e.preventDefault(); if (cell !== this._dragSrc) cell.classList.add('ws-over'); });
        cell.addEventListener('dragleave', e => { if (!cell.contains(e.relatedTarget)) cell.classList.remove('ws-over'); });
        cell.addEventListener('drop',      e => { e.preventDefault(); e.stopPropagation(); cell.classList.remove('ws-over'); if (this._dragSrc && this._dragSrc !== cell) { const si = this.layout.findIndex(l => l.id === this._dragSrc.dataset.wid); const ti = this.layout.findIndex(l => l.id === item.id); if (si !== -1 && ti !== -1) { [this.layout[si], this.layout[ti]] = [this.layout[ti], this.layout[si]]; this._save(); this._build(); } } });

        return cell;
    }

    _openSw(anchorBtn, item, def) {
        console.log('[WS] _openSw() for', item.id, '| views:', def.views.map(v=>v.id));
        this._closeSw();
        const menu = document.createElement('div');
        menu.className = 'ws-sw-menu';

        for (const v of def.views) {
            const opt = document.createElement('button');
            opt.className = 'ws-sw-opt' + (v.id === item.viewId ? ' active' : '');
            opt.innerHTML = '<i class="fas fa-' + (v.icon || 'chart-bar') + '"></i> ' + v.label;
            opt.addEventListener('click', e => { e.stopPropagation(); item.viewId = v.id; this._save(); this._closeSw(); this._build(); });
            menu.appendChild(opt);
        }

        anchorBtn.style.position = 'relative';
        anchorBtn.appendChild(menu);
        this._openSwitcher = menu;
        requestAnimationFrame(() => menu.classList.add('open'));
    }

    _closeSw() {
        if (this._openSwitcher) { this._openSwitcher.remove(); this._openSwitcher = null; }
    }

    _picker() {
        console.log('[WS] _picker() called');
        const hidden = this.layout.filter(l => !l.visible);
        if (!hidden.length) return;

        const overlay = document.createElement('div');
        overlay.className = 'ws-picker-overlay';
        overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

        const box = document.createElement('div');
        box.className = 'ws-picker-box';
        box.innerHTML = '<div class="ws-picker-title"><i class="fas fa-th-large"></i> Add Widget</div>';

        const closeBtn = document.createElement('button');
        closeBtn.className = 'ws-btn';
        closeBtn.style.cssText = 'position:absolute;top:1rem;right:1rem;';
        closeBtn.innerHTML = '<i class="fas fa-times"></i>';
        closeBtn.addEventListener('click', () => overlay.remove());
        box.appendChild(closeBtn);

        const grid = document.createElement('div');
        grid.className = 'ws-picker-grid';

        for (const item of hidden) {
            const def = this.allWidgets.find(w => w.id === item.id);
            if (!def) continue;
            const tile = document.createElement('div');
            tile.className = 'ws-picker-tile';
            tile.innerHTML = '<div style="font-size:1.8rem;color:#00d4ff;margin-bottom:0.4rem;"><i class="fas fa-' + (def.icon || 'chart-bar') + '"></i></div><strong>' + def.title + '</strong><small>' + (def.description || '') + '</small>';
            tile.addEventListener('click', () => { item.visible = true; this._save(); overlay.remove(); this._build(); });
            grid.appendChild(tile);
        }

        box.appendChild(grid);
        overlay.appendChild(box);
        document.body.appendChild(overlay);
        requestAnimationFrame(() => overlay.classList.add('open'));
    }
}
