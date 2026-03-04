/**
 * Darklock Platform - Route Index
 * Exports all platform routes for easy importing
 */

const authRoutes = require('./auth');
const dashboardRoutes = require('./dashboard');
const { requireAuth } = require('../admin-v4/middleware');
const profileRoutes = require('./profile');

module.exports = {
    authRoutes,
    dashboardRoutes,
    profileRoutes,
    requireAuth
};
