'use strict';

/**
 * src/security/index.js
 *
 * Shared singleton factory for the scan pipeline:
 *   ScanEngine → DecisionLayer → ActionExecutor
 *
 * Both guildCreate.js and interactionCreate.js require this file so they
 * share the same DecisionLayer instance (and therefore the same pending-
 * decision Map).
 */

const ScanEngine     = require('./ScanEngine');
const DecisionLayer  = require('./DecisionLayer');
const ActionExecutor = require('./ActionExecutor');

// Module-level singletons
let _decisionLayer  = null;
let _actionExecutor = null;

/**
 * Returns (or lazily creates) the shared DecisionLayer instance.
 * @returns {DecisionLayer}
 */
function getDecisionLayer() {
    if (!_decisionLayer) _decisionLayer = new DecisionLayer();
    return _decisionLayer;
}

/**
 * Returns (or lazily creates) the shared ActionExecutor instance.
 * Requires a bot reference so it can call the Discord API.
 *
 * @param {object} bot
 * @returns {ActionExecutor}
 */
function getActionExecutor(bot) {
    if (!_actionExecutor) {
        _actionExecutor = new ActionExecutor(bot, getDecisionLayer());
    }
    return _actionExecutor;
}

/**
 * Create a fresh ScanEngine bound to a bot instance.
 * (A new instance per scan is fine — ScanEngine is stateless between scans.)
 *
 * @param {object} bot
 * @returns {ScanEngine}
 */
function createScanEngine(bot) {
    return new ScanEngine(bot);
}

module.exports = {
    ScanEngine,
    DecisionLayer,
    ActionExecutor,
    getDecisionLayer,
    getActionExecutor,
    createScanEngine,
};
