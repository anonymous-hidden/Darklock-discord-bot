# Debug Logger Usage Guide

## Overview
The debug logger utility provides conditional logging based on the admin panel debug mode setting. When debug mode is disabled, only warnings and errors are shown. When enabled, all debug logs appear.

## Admin Panel Control
1. Navigate to `/admin` 
2. Go to the **Settings** tab
3. Toggle **Debug Mode** in the Developer Settings card
4. Click **Save Settings**

The change takes effect immediately (with 5-second cache refresh).

## Usage in Code

### Import the logger
```javascript
const debugLogger = require('./utils/debug-logger');
```

### Replace console.log with debug logger
```javascript
// Old way (always logs)
console.log('[MyModule] Processing data...', data);

// New way (only logs when debug mode is enabled)
debugLogger.log('[MyModule] Processing data...', data);
// or
await debugLogger.debug('[MyModule] Processing data...', data);
```

### Log levels

#### Debug logs (hidden when debug mode off)
```javascript
await debugLogger.log('Regular debug info');
await debugLogger.info('Informational message');
await debugLogger.debug('Detailed debug info');
```

#### Always-visible logs
```javascript
debugLogger.warn('Important warning'); // Always shows
debugLogger.error('Critical error');   // Always shows
```

### Synchronous check (performance-critical paths)
```javascript
if (debugLogger.isEnabledSync()) {
    // Do expensive debug operation
    const details = generateDetailedReport();
    console.log('[Debug]', details);
}
```

### Async check
```javascript
if (await debugLogger.isEnabled()) {
    console.log('[Debug] Mode is enabled');
}
```

## Examples

### Before (always logs)
```javascript
console.log('[Maintenance Config] Querying database...');
console.log('[Maintenance Config] Found', states.length, 'states');
console.log('[Dashboard] Loading user settings...');
```

### After (conditional logging)
```javascript
debugLogger.log('[Maintenance Config] Querying database...');
debugLogger.log('[Maintenance Config] Found', states.length, 'states');
debugLogger.log('[Dashboard] Loading user settings...');
```

## Benefits
- **Production-ready**: Reduce log noise in production
- **On-demand debugging**: Enable detailed logs when troubleshooting
- **Performance**: Cached setting check (5s TTL)
- **Backward compatible**: Errors and warnings always show
- **No code changes needed**: Just import and replace console.log

## Database
The setting is stored in the `admin_settings` table:
```sql
key: 'debug_mode'
value: 'true' or 'false'
```

## Performance
- Cache TTL: 5 seconds
- Minimal overhead when disabled
- Async checks for non-critical paths
- Sync checks available for hot paths
