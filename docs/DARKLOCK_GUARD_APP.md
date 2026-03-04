# Darklock Guard Desktop Application

## Complete Technical Documentation

> **Version:** 1.0.0  
> **Framework:** Tauri v2 (Rust backend + Web frontend)  
> **Purpose:** Advanced File Integrity Monitoring and Tamper Detection

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Technology Stack](#technology-stack)
4. [Application Layout](#application-layout)
5. [Core Features](#core-features)
6. [Frontend Components](#frontend-components)
7. [Backend (Rust) Modules](#backend-rust-modules)
8. [Cryptographic Security](#cryptographic-security)
9. [Event Chain System](#event-chain-system)
10. [Data Storage](#data-storage)
11. [State Management](#state-management)
12. [API Communication](#api-communication)
13. [File Structure](#file-structure)
14. [Configuration & Settings](#configuration--settings)
15. [Security Model](#security-model)

---

## Overview

**Darklock Guard** is a cross-platform desktop application designed to protect files from unauthorized modifications through cryptographic integrity verification. It uses SHA-256 hashing, Merkle trees, and an append-only event chain to detect tampering.

### What It Does:
- Monitors selected directories for file changes
- Creates cryptographic baselines of protected files
- Detects modifications, additions, and deletions
- Maintains a tamper-evident audit log (event chain)
- Signs manifests with Ed25519 digital signatures
- Integrates with DarkLock.net platform for authentication

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     DARKLOCK GUARD APP                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                   FRONTEND (JavaScript)                  │   │
│  │  ┌──────────┐  ┌────────────────────────────────────┐   │   │
│  │  │ Sidebar  │  │           Main Content              │   │   │
│  │  │          │  │  ┌──────────────────────────────┐  │   │   │
│  │  │ Dashboard│  │  │    Current View Component    │  │   │   │
│  │  │ Files    │  │  │    - Dashboard               │  │   │   │
│  │  │ Integrity│  │  │    - FilesView               │  │   │   │
│  │  │ Events   │  │  │    - IntegrityView           │  │   │   │
│  │  │ Settings │  │  │    - EventsView              │  │   │   │
│  │  └──────────┘  │  │    - SettingsView            │  │   │   │
│  │                │  └──────────────────────────────┘  │   │   │
│  │                └────────────────────────────────────┘   │   │
│  │                                                         │   │
│  │  Store ←──→ Router ←──→ TauriAPI                       │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│                              │ Tauri IPC (invoke)               │
│                              ▼                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                   BACKEND (Rust)                         │   │
│  │                                                         │   │
│  │  commands.rs ──→ All Tauri command handlers             │   │
│  │  integrity.rs ──→ File scanning & hash verification     │   │
│  │  crypto.rs ──→ SHA-256, Ed25519, Merkle trees           │   │
│  │  event_chain.rs ──→ Tamper-evident audit log            │   │
│  │  storage.rs ──→ State persistence, settings             │   │
│  │  error.rs ──→ Error handling                            │   │
│  │                                                         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│                              ▼                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                   DATA STORAGE                           │   │
│  │                                                         │   │
│  │  ~/.local/share/DarklockGuard/                          │   │
│  │    ├── config.json        (settings)                    │   │
│  │    ├── protected_paths.json                             │   │
│  │    ├── manifests/         (file baselines)              │   │
│  │    ├── event_chain.json   (audit log)                   │   │
│  │    └── signing_key.bin    (Ed25519 key, encrypted)      │   │
│  │                                                         │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Technology Stack

### Frontend
| Technology | Version | Purpose |
|------------|---------|---------|
| Vite | 5.4.21 | Build tool & dev server |
| TailwindCSS | 3.4+ | Styling with custom dark theme |
| Vanilla JS | ES6+ | Component-based architecture |

### Backend (Rust)
| Crate | Version | Purpose |
|-------|---------|---------|
| tauri | 2.x | Desktop framework |
| sha2 | 0.10 | SHA-256 file hashing |
| ed25519-dalek | 2.x | Digital signatures |
| blake3 | 1.5 | Fast hashing |
| rusqlite | 0.32 | SQLite storage |
| walkdir | 2.x | Directory traversal |
| chrono | 0.4 | Timestamp handling |
| uuid | 1.x | Unique identifiers |
| notify | 7.0 | Filesystem watching |
| serde | 1.x | Serialization |
| reqwest | 0.11 | HTTP client |
| parking_lot | 0.12 | Fast synchronization |

### Tauri Plugins
- `tauri-plugin-dialog` - Native file/folder dialogs
- `tauri-plugin-fs` - Filesystem access
- `tauri-plugin-notification` - Desktop notifications
- `tauri-plugin-shell` - Shell command execution
- `tauri-plugin-updater` - Auto-updates

---

## Application Layout

### Main Window Structure

```
┌────────────────────────────────────────────────────────────────┐
│                        DARKLOCK GUARD                          │
├──────────────┬─────────────────────────────────────────────────┤
│              │                                                 │
│   SIDEBAR    │              MAIN CONTENT AREA                  │
│   (256px)    │                                                 │
│              │  ┌─────────────────────────────────────────┐   │
│ ┌──────────┐ │  │  Header                                 │   │
│ │  Logo    │ │  │  - Page title                          │   │
│ │ Darklock │ │  │  - Page description                    │   │
│ │ Guard    │ │  │  - Action buttons (Scan, Add Path)     │   │
│ └──────────┘ │  └─────────────────────────────────────────┘   │
│              │                                                 │
│ ── NAV ──── │  ┌─────────────────────────────────────────┐   │
│              │  │  Status Banner                          │   │
│ ○ Dashboard  │  │  (SECURE/COMPROMISED/SCANNING)          │   │
│ ○ Protected  │  └─────────────────────────────────────────┘   │
│   Files      │                                                 │
│ ○ Integrity  │  ┌─────────────────────────────────────────┐   │
│   Check      │  │  Content Cards / Tables                 │   │
│ ○ Event Log  │  │  - Statistics                           │   │
│ ○ Settings   │  │  - Protected paths list                 │   │
│              │  │  - Scan results                         │   │
│              │  │  - Event timeline                       │   │
│ ── STATUS ── │  └─────────────────────────────────────────┘   │
│              │                                                 │
│ ● All Secure │                                                 │
│              │                                                 │
│ [Logout]     │                                                 │
│              │                                                 │
└──────────────┴─────────────────────────────────────────────────┘
```

### Navigation Items
1. **Dashboard** (`/`) - Global security status overview
2. **Protected Files** (`/files`) - Manage monitored directories
3. **Integrity Check** (`/integrity`) - Run scans, view results
4. **Event Log** (`/events`) - Audit trail with timestamps
5. **Settings** (`/settings`) - Configure app behavior

---

## Core Features

### 1. Protected Path Management
- **Add Path:** Opens native folder picker dialog
- **Remove Path:** Removes from monitoring with confirmation
- **Scan Path:** Run integrity check on specific directory
- **View Tree:** Browse file hierarchy (coming soon)

### 2. Integrity Scanning
- **Full Scan:** Check all protected paths
- **Path Scan:** Check single directory
- **Baseline Creation:** First scan creates reference hashes
- **Change Detection:** Compare current vs baseline hashes

### 3. Global Verdict System
The dashboard computes an overall security verdict:

```javascript
// Verdict Priority (highest to lowest):
1. COMPROMISED - Any path has compromised status OR event chain is invalid
2. CHANGED     - Any path has modified/deleted files
3. NOT_SCANNED - No paths have been scanned yet
4. SECURE      - All paths verified AND event chain valid
```

### 4. Event Chain (Tamper-Evident Audit Log)
- Append-only cryptographic chain
- Each event links to previous via hash
- Ed25519 digital signatures on events
- Chain integrity verification

### 5. Settings
- **Automatic Scanning:** Enable/disable scheduled scans
- **Scan Interval:** 15min / 30min / 1hr / 6hr / Daily
- **Real-time Monitoring:** Watch filesystem events
- **Strict Mode:** Alert on metadata changes too
- **Verify Chain on Startup:** Auto-verify at launch
- **Desktop Notifications:** Enable/disable alerts
- **Alert on Violation:** Urgent alert for tampering

---

## Frontend Components

### `/src/main.js` - Application Entry Point
```javascript
// Initializes:
// - Store (state management)
// - TauriAPI (backend communication)
// - Router (navigation)
// - App component

async function init() {
  const store = new Store({ loading: true, protectedPaths: [], ... });
  const api = new TauriAPI();
  const router = new Router({ routes: [...], defaultRoute: '/' });
  const app = new App({ store, router, api });
  
  // Load initial state from backend
  const data = await api.initialize();
  store.setState({ ...data, loading: false });
  
  // Render app
  render();
  router.init();
}
```

### `/src/components/App.js` - Main Container
```javascript
class App {
  render() {
    return `
      <div class="flex h-screen overflow-hidden">
        ${new Sidebar(...).render()}
        <main class="flex-1 overflow-y-auto">
          ${this.renderView(state.currentView)}
        </main>
      </div>
    `;
  }
  
  // Action handlers:
  // - runScan()
  // - addProtectedPath()
  // - removeProtectedPath(pathId)
  // - verifyEventChain()
  // - exportReport()
  // - logout()
  // - handleToggle(settingKey)
}
```

### `/src/components/Sidebar.js` - Navigation Sidebar
```javascript
// Renders:
// - Logo with version
// - Navigation menu (5 items)
// - Status indicator (Secure/Alert/Scanning/Unknown)
// - Logout button

navItems = [
  { id: 'dashboard', path: '/', label: 'Dashboard', icon: 'dashboard' },
  { id: 'files', path: '/files', label: 'Protected Files', icon: 'folder' },
  { id: 'integrity', path: '/integrity', label: 'Integrity Check', icon: 'shieldCheck' },
  { id: 'events', path: '/events', label: 'Event Log', icon: 'activity' },
  { id: 'settings', path: '/settings', label: 'Settings', icon: 'settings' },
];
```

### `/src/components/views/Dashboard.js` - Overview Page
**Features:**
- Global verdict banner (SECURE/COMPROMISED/CHANGED/NOT_SCANNED)
- Quick stats cards (paths, files, last scan, chain status)
- Protected paths health overview
- "Start Full Scan" button

**Verdict Computation:**
```javascript
computeGlobalVerdict(state) {
  const paths = state.protectedPaths || [];
  if (paths.length === 0) return 'NOT_SCANNED';
  
  // Check for compromised paths
  const compromised = paths.filter(p => p.status === 'compromised');
  if (compromised.length > 0 || state.eventChainValid === false) {
    return 'COMPROMISED';
  }
  
  // Check for changed files
  const changed = paths.filter(p => 
    p.modified_files > 0 || p.deleted_files > 0
  );
  if (changed.length > 0) return 'CHANGED';
  
  // Check if any scanned
  const scanned = paths.filter(p => p.last_scan);
  if (scanned.length === 0) return 'NOT_SCANNED';
  
  return 'SECURE';
}
```

**Visual Verdict Banners:**
| Verdict | Color | Icon | Message |
|---------|-------|------|---------|
| SECURE | Green gradient | shieldCheck | "All Systems Secure" |
| COMPROMISED | Red gradient | shieldAlert | "Security Alert" |
| CHANGED | Orange gradient | alertTriangle | "Changes Detected" |
| NOT_SCANNED | Gray | shield | "Run a Scan" |

### `/src/components/views/FilesView.js` - Protected Paths Browser
**Features:**
- List of protected directories as cards
- Each card shows:
  - Path name
  - File count
  - Status badge
  - Last scan time
  - Action buttons (Scan, View Tree, Remove)
- Empty state with "Add Path" button
- "Add Protected Path" button in header

**Path Card Layout:**
```
┌────────────────────────────────────────────────────────────┐
│ 📁 /home/user/projects/myapp                    [VERIFIED] │
│    156 files • Last scan: 2 hours ago                     │
│                                                            │
│    [Scan] [View Tree] [Remove]                            │
└────────────────────────────────────────────────────────────┘
```

### `/src/components/views/IntegrityView.js` - Scan Results Page
**Features:**
- "Start Full Scan" button
- Status banner (Verified/Compromised/Scanning/Unknown)
- Scan overview stats:
  - Total files
  - Verified count
  - Modified count
  - Deleted count
  - Scan duration
- Integrity verification details:
  - Hash algorithm (SHA-256 FIPS 180-4)
  - Merkle tree root hash
  - Event chain status
- "Verify Event Chain" button

**Status Banner States:**
```javascript
bannerConfig = {
  verified: { title: 'All Files Verified', color: 'green' },
  compromised: { title: 'Integrity Violations Detected', color: 'red' },
  scanning: { title: 'Scan in Progress', color: 'blue' },
  unknown: { title: 'Run a Scan', color: 'gray' },
}
```

### `/src/components/views/EventsView.js` - Audit Log Page
**Features:**
- Chain status banner (Verified/Alert)
- Chain length counter
- "Verify Chain" and "Export" buttons
- Filter tabs: All Events / Scans / Modifications / Alerts
- Search input
- Event timeline with:
  - Severity icon (info/success/warning/error)
  - Event type label
  - Message
  - Timestamp (relative + absolute on hover)
  - Event hash (truncated)
  - Event ID
- "Load More Events" pagination

**Event Types:**
- `scan_complete` - Integrity scan completed
- `file_modified` - File modification detected
- `file_added` - New file detected
- `file_deleted` - File deleted
- `path_added` - Protected path added
- `path_removed` - Protected path removed
- `baseline_created` - Initial baseline created

**Event Timeline Visual:**
```
┌────────────────────────────────────────────────────────────┐
│ ℹ️  Scan Complete                               2 hours ago │
│     Full integrity scan completed successfully             │
│     #a1b2c3d4...  Event #1                                │
├────────────────────────────────────────────────────────────┤
│ ⚠️  File Modified                               5 hours ago │
│     File modification detected: config.json                │
│     #b2c3d4e5...  Event #2                                │
└────────────────────────────────────────────────────────────┘
```

### `/src/components/views/SettingsView.js` - Configuration Page
**Settings Sections:**

**1. Scan Settings**
- Automatic Scanning toggle
- Scan Interval dropdown (15min/30min/1hr/6hr/Daily)
- Hash Algorithm (SHA-256, read-only)

**2. Security Settings**
- Real-time Monitoring toggle
- Strict Mode toggle
- Verify Chain on Startup toggle

**3. Notification Settings**
- Desktop Notifications toggle
- Alert on Integrity Violation toggle

**4. About Card**
- Version info
- License
- Check for Updates button

**5. Danger Zone**
- Reset Event Chain button
- Clear All Data button

---

## Backend (Rust) Modules

### `/src-tauri/src/commands.rs` - Tauri Command Handlers
All privileged operations exposed to frontend via IPC.

**Authentication Commands:**
```rust
#[tauri::command]
pub async fn login(email: String, password: String, app: AppHandle) -> Result<LoginResponse>
// Authenticates with darklock.net API, stores token

#[tauri::command]
pub async fn check_login(app: AppHandle) -> Result<bool>
// Checks if auth token exists

#[tauri::command]
pub async fn logout(app: AppHandle) -> Result<bool>
// Removes auth token
```

**Initialization Commands:**
```rust
#[tauri::command]
pub async fn initialize(state: State<'_, SharedState>) -> Result<InitResponse>
// Returns: protected paths, integrity status, events, settings
```

**Protected Path Commands:**
```rust
#[tauri::command]
pub async fn get_protected_paths(state: State<'_, SharedState>) -> Result<Vec<ProtectedPath>>

#[tauri::command]
pub async fn add_protected_path(path: String, state: State<'_, SharedState>) -> Result<ProtectedPath>
// Validates path exists, creates ProtectedPath, saves state

#[tauri::command]
pub async fn remove_protected_path(path_id: String, state: State<'_, SharedState>) -> Result<bool>
```

**Integrity Commands:**
```rust
#[tauri::command]
pub async fn scan_integrity(state: State<'_, SharedState>) -> Result<ScanResult>
// Full scan of all protected paths

#[tauri::command]
pub async fn scan_path(path_id: String, state: State<'_, SharedState>) -> Result<ScanResult>
// Scan single path
```

**Event Chain Commands:**
```rust
#[tauri::command]
pub async fn verify_event_chain(state: State<'_, SharedState>) -> Result<ChainVerificationResult>
// Verifies cryptographic chain integrity

#[tauri::command]
pub async fn get_events(offset: usize, limit: usize, state: State<'_, SharedState>) -> Result<Vec<EventDisplay>>
// Paginated event retrieval
```

### `/src-tauri/src/crypto.rs` - Cryptographic Operations

**File Hashing:**
```rust
pub fn hash_file(path: &Path) -> Result<String>
// SHA-256 hash with 64KB buffer for large files

pub fn hash_bytes(data: &[u8]) -> String
// SHA-256 hash of raw bytes

pub fn hash_string(data: &str) -> String
// SHA-256 hash of string
```

**Ed25519 Digital Signatures:**
```rust
pub struct SigningKeyPair {
    signing_key: SigningKey,
    verifying_key: VerifyingKey,
}

impl SigningKeyPair {
    pub fn generate() -> Self
    // Generate new random key pair
    
    pub fn sign(&self, message: &[u8]) -> String
    // Sign message, return base64 signature
    
    pub fn verify(&self, message: &[u8], signature_b64: &str) -> Result<bool>
    // Verify signature
}
```

**Merkle Tree:**
```rust
pub struct MerkleNode {
    pub hash: String,
    pub left: Option<Box<MerkleNode>>,
    pub right: Option<Box<MerkleNode>>,
}

pub fn build_merkle_tree(hashes: &[String]) -> Option<MerkleNode>
// Build tree from file hashes

pub fn merkle_root(hashes: &[String]) -> Option<String>
// Get root hash only
```

### `/src-tauri/src/integrity.rs` - Integrity Scanning

**Scan Configuration:**
```rust
pub struct ScanConfig {
    pub exclude_patterns: Vec<String>,  // ["*.tmp", "*.log", "node_modules", ".git"]
    pub follow_symlinks: bool,           // false
    pub max_file_size: Option<u64>,      // 100MB
}
```

**File Entry:**
```rust
pub struct FileEntry {
    pub path: String,
    pub relative_path: String,
    pub hash: String,           // SHA-256
    pub size: u64,
    pub modified: DateTime<Utc>,
    pub status: FileStatus,     // Verified/Modified/New/Deleted/Unknown
}
```

**Scan Result:**
```rust
pub struct ScanResult {
    pub path_id: String,
    pub path: String,
    pub status: PathStatus,      // Verified/Compromised/Unknown/Scanning
    pub total_files: usize,
    pub verified_files: usize,
    pub modified_files: usize,
    pub new_files: usize,
    pub deleted_files: usize,
    pub merkle_root: Option<String>,
    pub scan_duration_ms: u64,
    pub errors: Vec<String>,
}
```

**Scanner Operations:**
```rust
impl IntegrityScanner {
    pub fn scan_directory(&self, dir_path: &Path) -> Result<Vec<FileEntry>>
    // Walk directory, hash each file
    
    pub fn compare_with_manifest(&self, current: &mut [FileEntry], baseline: &[FileEntry]) -> ChangeSummary
    // Compare current scan to baseline, detect changes
    
    pub fn create_file_tree(&self, entries: &[FileEntry], root_path: &str) -> FileTreeNode
    // Build tree structure for UI
}
```

### `/src-tauri/src/event_chain.rs` - Tamper-Evident Audit Log

**Event Types Enum:**
```rust
pub enum EventType {
    AppStart,
    AppShutdown,
    PathAdded,
    PathRemoved,
    ScanStarted,
    ScanCompleted,
    FileModified,
    FileAdded,
    FileDeleted,
    SettingsChanged,
    ChainVerified,
    SecurityAlert,
    ManifestSigned,
    Info,
}

pub enum EventSeverity {
    Info,
    Warning,
    Error,
    Critical,
}
```

**Chain Event Structure:**
```rust
pub struct ChainEvent {
    pub id: String,              // UUID
    pub sequence: u64,           // 0-indexed
    pub timestamp: DateTime<Utc>,
    pub event_type: EventType,
    pub severity: EventSeverity,
    pub message: String,
    pub data: Option<serde_json::Value>,
    pub prev_hash: Option<String>,  // Links to previous event
    pub hash: String,               // SHA-256 of this event
    pub signature: Option<String>,  // Ed25519 signature
}
```

**Hash Computation:**
```rust
// Event hash includes all fields except signature:
let hash_content = format!(
    "{}:{}:{}:{:?}:{:?}:{}:{:?}:{:?}",
    id, sequence, timestamp, event_type, severity, message, data, prev_hash
);
let hash = hash_string(&hash_content);
```

**Event Chain Operations:**
```rust
impl EventChain {
    pub fn new(data_dir: &Path, max_events: usize) -> Result<Self>
    // Load or create chain
    
    pub fn append(&mut self, event_type: EventType, severity: EventSeverity, 
                  message: String, data: Option<Value>, key: &SigningKeyPair) -> Result<&ChainEvent>
    // Add new event, link to previous, sign
    
    pub fn verify(&self, key: &SigningKeyPair) -> ChainVerificationResult
    // Verify entire chain integrity
    
    pub fn get_events(&self, offset: usize, limit: usize) -> Vec<&ChainEvent>
    // Paginated retrieval
}
```

**Chain Verification:**
```rust
pub struct ChainVerificationResult {
    pub valid: bool,
    pub total_events: usize,
    pub verified_events: usize,
    pub errors: Vec<ChainError>,
}

// Checks:
// 1. Each event's hash matches computed hash
// 2. Each event's prev_hash matches previous event's hash
// 3. Sequence numbers are consecutive
// 4. Signatures verify (if present)
```

### `/src-tauri/src/storage.rs` - State Persistence

**Protected Path:**
```rust
pub struct ProtectedPath {
    pub id: String,
    pub path: String,
    pub added_at: DateTime<Utc>,
    pub last_scan: Option<DateTime<Utc>>,
    pub file_count: usize,
    pub status: PathStatus,
    pub merkle_root: Option<String>,
}
```

**Application Settings:**
```rust
pub struct Settings {
    pub auto_scan: bool,                 // false
    pub scan_interval_minutes: u32,      // 60
    pub notify_on_change: bool,          // true
    pub notify_on_scan_complete: bool,   // true
    pub exclude_patterns: Vec<String>,   // ["*.tmp", "*.log", ...]
    pub hash_algorithm: String,          // "sha256"
    pub preserve_event_chain: bool,      // true
    pub max_event_history: usize,        // 10000
}
```

**Application State:**
```rust
pub struct AppState {
    pub protected_paths: Vec<ProtectedPath>,
    pub manifests: HashMap<String, Vec<FileEntry>>,
    pub settings: Settings,
    pub integrity_status: IntegrityStatus,
    pub last_scan_time: Option<DateTime<Utc>>,
    pub event_chain_valid: bool,
    signing_key: Option<SigningKeyPair>,
    data_dir: PathBuf,
}
```

**Data Directory:**
- Linux: `~/.local/share/DarklockGuard/`
- Windows: `C:\Users\<user>\AppData\Local\darklock\DarklockGuard\`
- macOS: `~/Library/Application Support/net.darklock.DarklockGuard/`

---

## Cryptographic Security

### Hash Algorithm: SHA-256
- **Standard:** FIPS 180-4 compliant
- **Output:** 64 hex characters (256 bits)
- **Buffer size:** 64KB for streaming large files
- **Used for:**
  - File integrity verification
  - Event chain linking
  - Merkle tree computation

### Digital Signatures: Ed25519
- **Standard:** EdDSA using Curve25519
- **Key size:** 256-bit private, 256-bit public
- **Signature size:** 64 bytes (base64 encoded)
- **Used for:**
  - Signing event chain entries
  - Signing file manifests

### Merkle Tree
- **Purpose:** Efficient integrity verification
- **Algorithm:** Binary tree of SHA-256 hashes
- **Root hash:** Represents entire file set
- **Benefits:**
  - O(log n) proof of inclusion
  - Detect which files changed

### Key Storage
- **Windows:** DPAPI encryption
- **Linux/macOS:** Keyring service
- **Fallback:** File-based with permissions

---

## Event Chain System

### How It Works

1. **Genesis Event:** First event has `prev_hash: null`
2. **Linking:** Each new event includes hash of previous event
3. **Signing:** Events are signed with Ed25519 key
4. **Persistence:** Chain saved to `event_chain.json`

### Chain Structure
```
Event 0 (Genesis)
  ├─ id: "abc..."
  ├─ sequence: 0
  ├─ prev_hash: null
  ├─ hash: "def..." ←────────┐
  └─ signature: "..."        │
                              │
Event 1                       │
  ├─ id: "ghi..."            │
  ├─ sequence: 1             │
  ├─ prev_hash: "def..." ────┘
  ├─ hash: "jkl..." ←────────┐
  └─ signature: "..."        │
                              │
Event 2                       │
  ├─ id: "mno..."            │
  ├─ sequence: 2             │
  ├─ prev_hash: "jkl..." ────┘
  ├─ hash: "pqr..."
  └─ signature: "..."
```

### Tamper Detection
Any modification breaks the chain:
- Changing event content → hash mismatch
- Reordering events → sequence mismatch
- Deleting events → prev_hash mismatch
- Forging events → signature verification fails

---

## Data Storage

### File Locations
```
~/.local/share/DarklockGuard/
├── config.json           # Application settings
├── protected_paths.json  # List of monitored paths
├── manifests/            # File baselines by path ID
│   ├── <path-id-1>.json
│   ├── <path-id-2>.json
│   └── ...
├── event_chain.json      # Audit log
└── signing_key.bin       # Ed25519 private key (encrypted)
```

### Config File Format
```json
{
  "autoScan": false,
  "scanIntervalMinutes": 60,
  "notifyOnChange": true,
  "notifyOnScanComplete": true,
  "excludePatterns": ["*.tmp", "*.log", "node_modules", ".git"],
  "hashAlgorithm": "sha256",
  "preserveEventChain": true,
  "maxEventHistory": 10000
}
```

### Protected Paths Format
```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "path": "/home/user/projects/myapp",
    "addedAt": "2025-01-15T10:30:00Z",
    "lastScan": "2025-01-15T12:00:00Z",
    "fileCount": 156,
    "status": "verified",
    "merkleRoot": "a7f3d8e2c1b4..."
  }
]
```

### Manifest Format
```json
{
  "pathId": "550e8400-e29b-41d4-a716-446655440000",
  "createdAt": "2025-01-15T10:30:00Z",
  "updatedAt": "2025-01-15T12:00:00Z",
  "merkleRoot": "a7f3d8e2c1b4...",
  "files": [
    {
      "path": "/home/user/projects/myapp/src/main.rs",
      "relativePath": "src/main.rs",
      "hash": "b2c3d4e5f6g7...",
      "size": 2048,
      "modified": "2025-01-14T08:00:00Z",
      "status": "verified"
    }
  ]
}
```

---

## State Management

### Frontend Store (`/src/lib/store.js`)
Simple pub/sub state container:

```javascript
class Store {
  constructor(initialState) {
    this.state = initialState;
    this.listeners = new Set();
  }
  
  getState() { return this.state; }
  
  setState(partial) {
    this.state = { ...this.state, ...partial };
    this.notify();  // Re-render
  }
  
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
```

### Initial State
```javascript
{
  loading: true,
  currentView: 'dashboard',
  protectedPaths: [],
  integrityStatus: 'unknown',  // 'verified' | 'compromised' | 'scanning' | 'unknown'
  lastScanTime: null,
  lastVerifiedAt: null,
  eventChainValid: true,
  settings: {
    autoScan: false,
    scanInterval: 3600,
    realtimeMonitoring: false,
    strictMode: false,
    verifyChainOnStartup: true,
    notificationsEnabled: true,
    alertOnViolation: true,
  },
}
```

---

## API Communication

### TauriAPI Class (`/src/lib/tauri-api.js`)

**Purpose:** Bridge between frontend JS and backend Rust

**Key Methods:**
```javascript
class TauriAPI {
  // Initialization
  async initialize()
  
  // Protected Paths
  async getProtectedPaths()
  async addProtectedPath(path)
  async removeProtectedPath(pathId)
  
  // Integrity
  async scanIntegrity()
  async scanPath(pathId)
  async getFileTree(pathId)
  
  // Events
  async getEvents(offset, limit)
  async verifyEventChain()
  
  // Settings
  async updateSettings(settings)
  
  // Utils
  async selectDirectory()  // Opens native folder picker
  async exportReport(format)
  
  // Auth
  async logout()
}
```

**Mock Mode:**
When Tauri is not available (dev mode in browser), returns mock data for testing:

```javascript
_mockResponse(cmd, args) {
  const mocks = {
    'get_protected_paths': [
      { id: '1', path: 'C:\\Projects\\MyApp', fileCount: 156, status: 'verified' },
    ],
    'scan_integrity': { status: 'verified', filesScanned: 179, ... },
    // etc.
  };
  return Promise.resolve(mocks[cmd] || null);
}
```

---

## File Structure

```
ainti-tampering-app/tauri-app/
├── package.json              # Node.js dependencies
├── vite.config.js            # Vite build config
├── tailwind.config.js        # TailwindCSS theme
├── postcss.config.js         # PostCSS plugins
├── index.html                # HTML entry point
│
├── src/                      # Frontend JavaScript
│   ├── main.js               # App initialization
│   ├── styles/
│   │   └── main.css          # TailwindCSS + custom styles
│   ├── lib/
│   │   ├── store.js          # State management
│   │   ├── router.js         # Client-side routing
│   │   ├── tauri-api.js      # Rust backend interface
│   │   ├── icons.js          # SVG icon library
│   │   └── utils.js          # Helpers (timeAgo, formatDate)
│   └── components/
│       ├── App.js            # Main app component
│       ├── Sidebar.js        # Navigation sidebar
│       └── views/
│           ├── Dashboard.js  # Overview page
│           ├── FilesView.js  # Protected paths
│           ├── IntegrityView.js  # Scan results
│           ├── EventsView.js     # Audit log
│           └── SettingsView.js   # Configuration
│
└── src-tauri/                # Backend Rust
    ├── Cargo.toml            # Rust dependencies
    ├── tauri.conf.json       # Tauri config
    ├── build.rs              # Build script
    ├── icons/                # App icons
    └── src/
        ├── main.rs           # Tauri entry point
        ├── lib.rs            # Library exports
        ├── commands.rs       # Tauri command handlers
        ├── crypto.rs         # Cryptographic ops
        ├── integrity.rs      # File scanning
        ├── event_chain.rs    # Audit chain
        ├── storage.rs        # State persistence
        ├── error.rs          # Error types
        └── protection/       # Additional protection modules
```

---

## Configuration & Settings

### Default Settings
| Setting | Default | Description |
|---------|---------|-------------|
| `autoScan` | `false` | Enable scheduled scanning |
| `scanIntervalMinutes` | `60` | Time between auto-scans |
| `notifyOnChange` | `true` | Alert when files change |
| `notifyOnScanComplete` | `true` | Alert when scan finishes |
| `excludePatterns` | `["*.tmp", "*.log", "node_modules", ".git", "__pycache__", "*.pyc"]` | Files/folders to skip |
| `hashAlgorithm` | `"sha256"` | Fixed, cannot change |
| `preserveEventChain` | `true` | Keep audit history |
| `maxEventHistory` | `10000` | Max events to retain |

### TailwindCSS Theme Colors
```javascript
colors: {
  'darklock-bg-primary': '#0a0a0f',      // Main background
  'darklock-bg-secondary': '#12121a',    // Card background
  'darklock-bg-tertiary': '#1a1a24',     // Elevated surfaces
  'darklock-accent': '#6366f1',          // Primary brand (indigo)
  'darklock-success': '#22c55e',         // Green
  'darklock-warning': '#f59e0b',         // Orange
  'darklock-error': '#ef4444',           // Red
  'darklock-info': '#3b82f6',            // Blue
  'darklock-text-primary': '#ffffff',    // Main text
  'darklock-text-secondary': '#a1a1aa',  // Muted text
  'darklock-border': '#27272a',          // Border color
}
```

---

## Security Model

### Principles
1. **Deny by Default:** All operations require explicit permission
2. **Input Validation:** All paths/inputs validated in Rust
3. **No Secrets in Frontend:** Keys never exposed to JavaScript
4. **Cryptographic Integrity:** Chain cannot be modified without detection
5. **Secure Key Storage:** Platform-native encryption (DPAPI/Keyring)

### Threat Model
| Threat | Mitigation |
|--------|------------|
| Malicious file modification | SHA-256 hash comparison |
| Log tampering | Cryptographic event chain |
| Key theft | Platform-native key storage |
| Memory attacks | Rust memory safety |
| MITM on platform auth | HTTPS + token storage |

### Security Commands
```rust
// Security header in commands.rs:
//! SECURITY MODEL:
//! - All privileged operations are performed here in Rust
//! - Input validation on all parameters
//! - No secrets exposed to frontend
//! - Deny-by-default approach
```

---

## Running the Application

### Development Mode
```bash
cd ainti-tampering-app/tauri-app
npm install
npm run tauri:dev
```

### Production Build
```bash
cd ainti-tampering-app/tauri-app
npm run tauri:build
# Output: src-tauri/target/release/bundle/
```

### Requirements
- **Node.js:** 18+
- **Rust:** 1.70+
- **Linux:** libwebkit2gtk-4.1-dev, libssl-dev, librsvg2-dev
- **Windows:** MSVC toolchain, WebView2
- **macOS:** Xcode Command Line Tools

---

## Summary

**Darklock Guard** is a comprehensive file integrity monitoring solution that:

1. **Protects files** by creating cryptographic baselines
2. **Detects tampering** through hash comparison
3. **Maintains audit trail** via tamper-evident event chain
4. **Signs manifests** with Ed25519 digital signatures
5. **Provides clear UI** showing security status at a glance

The architecture cleanly separates concerns:
- **Frontend (JS):** UI rendering, user interaction
- **Backend (Rust):** Cryptography, file I/O, security operations
- **Storage:** JSON files with platform-native key encryption

This creates a secure, performant desktop application for protecting sensitive file systems from unauthorized modifications.
