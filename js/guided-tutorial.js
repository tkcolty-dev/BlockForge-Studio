/**
 * GuidedTutorial - Interactive step-by-step tutorial system
 * Highlights UI elements, shows instruction popovers, and waits
 * for the user to perform actions before advancing.
 */
class GuidedTutorial {
    constructor(app) {
        this.app = app;
        this.steps = null;
        this.currentStep = 0;
        this._transitioning = false;
        this._actionCleanups = [];
        this._highlightedEl = null;
        this._savedStyles = null;
        this._resizeHandler = null;
        this._escHandler = null;
        this._createDOM();
    }

    _createDOM() {
        // Overlay
        this.overlay = document.createElement('div');
        this.overlay.className = 'guided-overlay';
        this.overlay.addEventListener('click', (e) => {
            // Block clicks on overlay unless on highlighted element
            e.stopPropagation();
        });

        // Popover
        this.popover = document.createElement('div');
        this.popover.className = 'guided-popover';
        this.popover.innerHTML = `
            <div class="guided-popover-icon"><span class="material-icons-round"></span></div>
            <div class="guided-popover-title"></div>
            <div class="guided-popover-text"></div>
            <div class="guided-action-hint" style="display:none">
                <span class="pulse-dot"></span>
                <span class="hint-text">Waiting for you...</span>
            </div>
            <div class="guided-popover-nav">
                <button class="guided-skip-btn">Skip tutorial</button>
                <div class="guided-dots"></div>
                <button class="guided-next-btn">Next <span class="material-icons-round" style="font-size:16px">arrow_forward</span></button>
            </div>
        `;

        this.popover.querySelector('.guided-skip-btn').addEventListener('click', () => this.skip());
        this.popover.querySelector('.guided-next-btn').addEventListener('click', () => this._onNextClick());

        document.body.appendChild(this.overlay);
        document.body.appendChild(this.popover);
    }

    start(key, tutorial) {
        this.tutorialKey = key;
        this.steps = tutorial.steps;
        this.currentStep = 0;
        this._transitioning = false;

        // Show overlay
        this.overlay.classList.add('active');

        // Escape key to skip
        this._escHandler = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                this.skip();
            }
        };
        document.addEventListener('keydown', this._escHandler, true);

        // Resize handler for repositioning
        this._resizeHandler = () => this._repositionPopover();
        window.addEventListener('resize', this._resizeHandler);

        this.goToStep(0);
    }

    goToStep(index) {
        if (!this.steps || index < 0 || index >= this.steps.length) return;

        // Clean up previous step
        this._cleanupAction();
        this._clearHighlight();

        this.currentStep = index;
        const step = this.steps[index];

        // Prepare UI state if needed
        this._prepareUI(step.prepare);

        // Small delay to let UI prep settle
        setTimeout(() => {
            this._updateDots();

            if (step.target && step.action) {
                this._showInteractiveStep(step);
            } else {
                this._showPassiveStep(step);
            }
        }, step.prepare ? 300 : 50);
    }

    _showPassiveStep(step) {
        this._updatePopoverContent(step, false);

        // Center the popover on screen
        this.popover.style.top = '50%';
        this.popover.style.left = '50%';
        this.popover.style.transform = 'translate(-50%, -50%)';
        this.popover.classList.add('visible');

        // Show next/done button
        const nextBtn = this.popover.querySelector('.guided-next-btn');
        nextBtn.style.display = 'flex';
        if (this.currentStep === this.steps.length - 1) {
            nextBtn.innerHTML = 'Done <span class="material-icons-round" style="font-size:16px">check</span>';
        } else {
            nextBtn.innerHTML = 'Next <span class="material-icons-round" style="font-size:16px">arrow_forward</span>';
        }
    }

    _showInteractiveStep(step) {
        const targetEl = document.querySelector(step.target);
        if (!targetEl) {
            // Target not found — fall back to passive
            this._showPassiveStep(step);
            return;
        }

        // Highlight the target
        this._highlightElement(targetEl);

        // Update popover content
        this._updatePopoverContent(step, true);

        // Hide next button for interactive steps (must perform action)
        const nextBtn = this.popover.querySelector('.guided-next-btn');
        nextBtn.style.display = 'none';

        // Position popover near target
        this._positionPopover(targetEl, step.popover?.position || 'auto');
        this.popover.classList.add('visible');

        // Wait for action
        this._waitForAction(step.action).then(() => {
            this._onActionCompleted();
        });
    }

    _updatePopoverContent(step, isInteractive) {
        this.popover.querySelector('.guided-popover-icon .material-icons-round').textContent = step.icon || 'school';
        this.popover.querySelector('.guided-popover-title').textContent = step.title;
        this.popover.querySelector('.guided-popover-text').textContent = step.text;

        const actionHint = this.popover.querySelector('.guided-action-hint');
        if (isInteractive) {
            actionHint.style.display = 'flex';
            const hintTexts = {
                'click': 'Click the highlighted element',
                'select-object': 'Click an object in the viewport',
                'drop-block': 'Drag a block to the workspace',
                'change-value': 'Change the highlighted value',
                'key-press': 'Press the indicated key'
            };
            actionHint.querySelector('.hint-text').textContent =
                hintTexts[step.action?.type] || 'Complete the action above';
        } else {
            actionHint.style.display = 'none';
        }
    }

    _updateDots() {
        const dotsContainer = this.popover.querySelector('.guided-dots');
        dotsContainer.innerHTML = '';
        for (let i = 0; i < this.steps.length; i++) {
            const dot = document.createElement('span');
            dot.className = 'guided-dot';
            if (i === this.currentStep) dot.classList.add('active');
            else if (i < this.currentStep) dot.classList.add('completed');
            dotsContainer.appendChild(dot);
        }
    }

    _highlightElement(el) {
        this._savedStyles = {
            position: el.style.position,
            zIndex: el.style.zIndex,
            pointerEvents: el.style.pointerEvents,
            boxShadow: el.style.boxShadow
        };
        this._highlightedEl = el;
        el.classList.add('guided-highlight');
    }

    _clearHighlight() {
        if (this._highlightedEl) {
            this._highlightedEl.classList.remove('guided-highlight');
            // Restore saved styles
            if (this._savedStyles) {
                Object.entries(this._savedStyles).forEach(([key, val]) => {
                    this._highlightedEl.style[key] = val || '';
                });
            }
            this._highlightedEl = null;
            this._savedStyles = null;
        }
    }

    _positionPopover(targetEl, preferredPos) {
        // Reset transform in case it was centered
        this.popover.style.transform = '';

        const rect = targetEl.getBoundingClientRect();
        // Temporarily show to get dimensions
        this.popover.style.visibility = 'hidden';
        this.popover.classList.add('visible');
        const pRect = this.popover.getBoundingClientRect();
        this.popover.style.visibility = '';

        const MARGIN = 16;
        const space = {
            top: rect.top,
            bottom: window.innerHeight - rect.bottom,
            left: rect.left,
            right: window.innerWidth - rect.right
        };

        let pos = preferredPos;
        if (pos === 'auto') {
            if (space.bottom >= pRect.height + MARGIN) pos = 'bottom';
            else if (space.right >= pRect.width + MARGIN) pos = 'right';
            else if (space.top >= pRect.height + MARGIN) pos = 'top';
            else if (space.left >= pRect.width + MARGIN) pos = 'left';
            else pos = 'bottom';
        }

        let top, left;
        switch (pos) {
            case 'bottom':
                top = rect.bottom + MARGIN;
                left = rect.left + rect.width / 2 - pRect.width / 2;
                break;
            case 'top':
                top = rect.top - pRect.height - MARGIN;
                left = rect.left + rect.width / 2 - pRect.width / 2;
                break;
            case 'right':
                top = rect.top + rect.height / 2 - pRect.height / 2;
                left = rect.right + MARGIN;
                break;
            case 'left':
                top = rect.top + rect.height / 2 - pRect.height / 2;
                left = rect.left - pRect.width - MARGIN;
                break;
        }

        // Clamp to viewport
        left = Math.max(8, Math.min(left, window.innerWidth - pRect.width - 8));
        top = Math.max(8, Math.min(top, window.innerHeight - pRect.height - 8));

        this.popover.style.top = top + 'px';
        this.popover.style.left = left + 'px';
    }

    _repositionPopover() {
        if (!this.steps) return;
        const step = this.steps[this.currentStep];
        if (step.target && this._highlightedEl) {
            this._positionPopover(this._highlightedEl, step.popover?.position || 'auto');
        }
    }

    _prepareUI(prepare) {
        if (!prepare) return;

        if (prepare.tab) {
            const tab = document.querySelector(`.panel-tab[data-tab="${prepare.tab}"]`);
            if (tab && !tab.classList.contains('active')) tab.click();
        }

        if (prepare.expandEditor === true) {
            const body = document.body;
            if (!body.classList.contains('editor-expanded')) {
                document.getElementById('btn-toggle-editor')?.click();
            }
        }

        if (prepare.category) {
            const cat = document.querySelector(`.palette-category[data-category="${prepare.category}"]`);
            if (cat && !cat.classList.contains('active')) cat.click();
        }
    }

    _waitForAction(action) {
        return new Promise((resolve) => {
            switch (action.type) {
                case 'click': {
                    const handler = (e) => {
                        const target = e.target.closest(action.selector);
                        if (target) {
                            document.removeEventListener('click', handler, true);
                            resolve();
                        }
                    };
                    document.addEventListener('click', handler, true);
                    this._actionCleanups.push(() => document.removeEventListener('click', handler, true));
                    break;
                }

                case 'select-object': {
                    // Elevate viewport so clicks reach the canvas
                    const viewport = document.getElementById('viewport-container');
                    if (viewport) {
                        viewport.style.zIndex = '8001';
                        viewport.style.pointerEvents = 'auto';
                        this._actionCleanups.push(() => {
                            viewport.style.zIndex = '';
                            viewport.style.pointerEvents = '';
                        });
                    }

                    const originalCb = this.app.scene3d.onObjectSelected;
                    this.app.scene3d.onObjectSelected = (obj) => {
                        if (originalCb) originalCb(obj);
                        this.app.scene3d.onObjectSelected = originalCb;
                        resolve();
                    };
                    this._actionCleanups.push(() => {
                        this.app.scene3d.onObjectSelected = originalCb;
                    });
                    break;
                }

                case 'drop-block': {
                    const wsCanvas = document.getElementById('workspace-canvas');
                    if (!wsCanvas) { resolve(); break; }

                    // Elevate block editor so it's interactive
                    const editor = document.getElementById('block-editor');
                    if (editor) {
                        editor.style.zIndex = '8001';
                        editor.style.pointerEvents = 'auto';
                        this._actionCleanups.push(() => {
                            editor.style.zIndex = '';
                            editor.style.pointerEvents = '';
                        });
                    }

                    const observer = new MutationObserver((mutations) => {
                        for (const m of mutations) {
                            if (m.addedNodes.length > 0) {
                                observer.disconnect();
                                resolve();
                                return;
                            }
                        }
                    });
                    observer.observe(wsCanvas, { childList: true, subtree: true });
                    this._actionCleanups.push(() => observer.disconnect());
                    break;
                }

                case 'change-value': {
                    const el = document.querySelector(action.selector);
                    if (!el) { resolve(); break; }
                    const handler = () => {
                        el.removeEventListener('change', handler);
                        el.removeEventListener('input', handler);
                        resolve();
                    };
                    el.addEventListener('change', handler);
                    el.addEventListener('input', handler);
                    this._actionCleanups.push(() => {
                        el.removeEventListener('change', handler);
                        el.removeEventListener('input', handler);
                    });
                    break;
                }

                case 'key-press': {
                    const handler = (e) => {
                        if (e.key === action.key) {
                            document.removeEventListener('keydown', handler);
                            resolve();
                        }
                    };
                    document.addEventListener('keydown', handler);
                    this._actionCleanups.push(() => document.removeEventListener('keydown', handler));
                    break;
                }

                default:
                    resolve();
            }
        });
    }

    _onActionCompleted() {
        if (this._transitioning) return;
        this._transitioning = true;

        // If the game just started from a tutorial step, stop it before advancing
        const shouldStopGame = this.app.runtime && this.app.runtime.isRunning;

        // Brief delay to let the UI update from the action
        setTimeout(() => {
            if (shouldStopGame) {
                this.app.runtime.stop();
            }
            this._transitioning = false;
            if (this.currentStep < this.steps.length - 1) {
                this.goToStep(this.currentStep + 1);
            } else {
                this.skip();
            }
        }, shouldStopGame ? 1500 : 400);
    }

    _onNextClick() {
        if (this._transitioning) return;
        if (this.currentStep < this.steps.length - 1) {
            this.goToStep(this.currentStep + 1);
        } else {
            this.skip();
        }
    }

    _cleanupAction() {
        this._actionCleanups.forEach(fn => fn());
        this._actionCleanups = [];
    }

    skip() {
        this._cleanupAction();
        this._clearHighlight();

        this.overlay.classList.remove('active');
        this.popover.classList.remove('visible');
        this.steps = null;

        if (this._escHandler) {
            document.removeEventListener('keydown', this._escHandler, true);
            this._escHandler = null;
        }
        if (this._resizeHandler) {
            window.removeEventListener('resize', this._resizeHandler);
            this._resizeHandler = null;
        }

        // Stop the game if it was started during the tutorial
        if (this.app.runtime && this.app.runtime.isRunning) {
            this.app.runtime.stop();
        }
    }
}
