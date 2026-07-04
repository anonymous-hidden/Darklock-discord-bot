#!/usr/bin/env node
/**
 * Darklock Admin CLI - Create Admin Account
 * 
 * Usage:
 *   node create-admin.js <email> <password> [role]
 * 
 * Arguments:
 *   email     - Admin email address
 *   password  - Password (min 12 characters)
 *   role      - owner|coowner|admin|mod|helper|bug_tester|pr (default: admin)
 * 
 * Example:
 *   node create-admin.js admin@example.com MySecurePass123! owner
 * 
 * SECURITY NOTES:
 * - Password will be hashed with bcrypt (12 rounds)
 * - Never store or log plaintext passwords
 * - Use a strong, unique password
 */

const path = require('path');

// Load environment variables
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const db = require('./utils/database');
const { createAdmin, initializeAdminTables, BCRYPT_ROUNDS } = require('./routes/admin-auth');

async function main() {
    const args = process.argv.slice(2);

    // Display help if requested
    if (args.includes('--help') || args.includes('-h')) {
        console.log(`
Darklock Admin CLI - Create Admin Account

Usage:
  node create-admin.js <email> <password> [role]

Arguments:
  email     - Admin email address (required)
  password  - Password, min 12 characters (required)
    role      - owner|coowner|admin|mod|helper|bug_tester|pr (default: admin)

Examples:
  node create-admin.js admin@example.com MySecurePass123!
  node create-admin.js owner@example.com SuperSecure456! owner

Security:
  - Password hashed with bcrypt (${BCRYPT_ROUNDS} rounds)
  - Passwords are never stored in plaintext
  - Use a strong, unique password
`);
        process.exit(0);
    }

    // Parse arguments
    const [email, password, role = 'admin'] = args;

    // Validate arguments
    if (!email || !password) {
        console.error('❌ Error: Email and password are required');
        console.error('');
        console.error('Usage: node create-admin.js <email> <password> [role]');
        console.error('Run with --help for more information');
        process.exit(1);
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        console.error('❌ Error: Invalid email format');
        process.exit(1);
    }

    // Validate password strength
    if (password.length < 12) {
        console.error('❌ Error: Password must be at least 12 characters');
        process.exit(1);
    }

    // Validate role
    const validRoles = ['owner', 'coowner', 'admin', 'mod', 'helper', 'bug_tester', 'pr'];
    if (!validRoles.includes(role)) {
        console.error('❌ Error: Role must be one of: ' + validRoles.join(', '));
        process.exit(1);
    }

    try {
        console.log('🔄 Initializing database...');
        await db.initialize();

        console.log('🔄 Setting up admin tables...');
        await initializeAdminTables();

        console.log('🔄 Creating admin account...');
        const admin = await createAdmin(email, password, role);

        console.log('');
        console.log('✅ Admin account created successfully!');
        console.log('');
        console.log('   Email:', admin.email);
        console.log('   Role:', admin.role);
        console.log('   ID:', admin.id);
        console.log('');
        console.log('🔐 You can now sign in at /signin');
        console.log('');

        // Close database connection
        process.exit(0);

    } catch (err) {
        if (err.message?.includes('UNIQUE constraint failed') || err.message?.includes('already exists')) {
            console.error('❌ Error: An admin with this email already exists');
        } else {
            console.error('❌ Error:', err.message);
        }
        process.exit(1);
    }
}

main();
