# Security Implementation - Testing Guide

## 🧪 PRE-DEPLOYMENT TESTING

### Test Environment Setup
1. Start dashboard in development mode
2. Clear all browser cookies
3. Open browser DevTools (F12)
4. Keep Network and Console tabs open

---

## 1️⃣ LOGIN TESTS

### Test 1.1: Successful Login
**Steps:**
1. Navigate to `/login`
2. Enter correct admin username and password
3. Click "Sign In"

**Expected:**
- ✅ Redirects to `/admin`
- ✅ Cookie `dashboardToken` is set (check Application > Cookies)
- ✅ Cookie flags: `HttpOnly`, `Secure` (if HTTPS), `SameSite=Lax`
- ✅ Dashboard loads correctly
- ✅ No token in URL
- ✅ No token in localStorage

### Test 1.2: Wrong Password
**Steps:**
1. Navigate to `/login`
2. Enter correct username, wrong password
3. Click "Sign In"

**Expected:**
- ✅ Error message: "Invalid credentials"
- ✅ HTTP Status: 401
- ✅ No cookie set
- ✅ Can try again

### Test 1.3: Brute Force Protection
**Steps:**
1. Navigate to `/login`
2. Enter wrong password 5 times

**Expected:**
- ✅ After 5th attempt: HTTP Status 429
- ✅ Error: "Too many failed attempts. Account locked for 15 minutes."
- ✅ Cannot login even with correct password
- ✅ Server logs show brute force block

**Cleanup:**
- Wait 15 minutes OR restart server to clear lockout

### Test 1.4: User Enumeration Prevention
**Steps:**
1. Try login with invalid username
2. Try login with valid username but wrong password

**Expected:**
- ✅ Both show same error: "Invalid credentials"
- ✅ Same HTTP status code (401)
- ✅ Same response time (approximately)

---

## 2️⃣ OAUTH TESTS

### Test 2.1: Discord OAuth Flow
**Steps:**
1. Navigate to `/login`
2. Click "Login with Discord"
3. Authorize on Discord
4. Get redirected back

**Expected:**
- ✅ Redirects to `/admin` (NOT `/dashboard`)
- ✅ NO `?token=...` in URL
- ✅ Cookie `dashboardToken` is set
- ✅ Dashboard loads correctly

### Test 2.2: OAuth Security
**Steps:**
1. Complete OAuth flow
2. Check browser history
3. Check localStorage
4. Check cookies

**Expected:**
- ✅ No token in browser history URLs
- ✅ No token in localStorage
- ✅ dashboardToken cookie has HttpOnly flag
- ✅ Cannot read cookie via `document.cookie` in console

---

## 3️⃣ LOGOUT TESTS

### Test 3.1: Manual Logout
**Steps:**
1. Login successfully
2. Navigate to a dashboard page
3. Click "Logout"

**Expected:**
- ✅ Redirects to `/login.html?logout=true`
- ✅ Cookies cleared: `dashboardToken`, `authToken`, `userId`
- ✅ Other cookies preserved (if any)
- ✅ Cannot access dashboard pages

### Test 3.2: Session Expiry
**Steps:**
1. Login successfully
2. Wait 24 hours (OR manually delete cookie)
3. Try to access dashboard page

**Expected:**
- ✅ Redirects to `/login`
- ✅ Error: "Access token required" or "Invalid token"

---

## 4️⃣ CSRF TESTS

### Test 4.1: CSRF Token Endpoint
**Steps:**
1. Login successfully
2. GET `/api/csrf-token`

**Expected:**
- ✅ HTTP Status: 200
- ✅ Response: `{ csrfToken: "...", expiresAt: 1234567890 }`
- ✅ Token is 32+ characters

### Test 4.2: CSRF Protection (Manual Test)
**Steps:**
1. Login successfully
2. Open DevTools Console
3. Try POST without CSRF token:
```javascript
fetch('/api/some-protected-route', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ test: true })
}).then(r => r.json()).then(console.log);
```

**Expected:**
- ✅ HTTP Status: 403
- ✅ Error: "Invalid CSRF token"

### Test 4.3: CSRF Protection (With Token)
**Steps:**
1. Login successfully
2. Get CSRF token: `fetch('/api/csrf-token').then(r => r.json()).then(console.log)`
3. Try POST with token:
```javascript
const csrfToken = "..."; // from step 2
fetch('/api/some-protected-route', {
    method: 'POST',
    credentials: 'include',
    headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken
    },
    body: JSON.stringify({ test: true })
}).then(r => r.json()).then(console.log);
```

**Expected:**
- ✅ HTTP Status: 200 (or appropriate success)
- ✅ Request succeeds

---

## 5️⃣ COOKIE TESTS

### Test 5.1: Cookie Attributes
**Steps:**
1. Login successfully
2. Open DevTools > Application > Cookies
3. Inspect `dashboardToken` cookie

**Expected:**
- ✅ HttpOnly: Yes
- ✅ Secure: Yes (production) or No (development)
- ✅ SameSite: Lax
- ✅ Path: /
- ✅ Expires: 24 hours from now

### Test 5.2: Cookie Scope
**Steps:**
1. Login successfully
2. Open DevTools Console
3. Try: `document.cookie`

**Expected:**
- ✅ `dashboardToken` NOT visible (HttpOnly)
- ✅ Cannot read token via JavaScript

---

## 6️⃣ API AUTHENTICATION TESTS

### Test 6.1: Authenticated API Call
**Steps:**
1. Login successfully
2. Navigate to dashboard
3. Perform action that triggers API call

**Expected:**
- ✅ API call succeeds
- ✅ Cookie sent automatically (check Network tab)
- ✅ No `Authorization` header

### Test 6.2: Unauthenticated API Call
**Steps:**
1. Logout (or open incognito)
2. Try: `fetch('/api/dashboard-data').then(r => r.json()).then(console.log)`

**Expected:**
- ✅ HTTP Status: 401
- ✅ Error: "Access token required"

---

## 7️⃣ SECURITY HEADER TESTS

### Test 7.1: Content-Security-Policy
**Steps:**
1. Navigate to any dashboard page
2. Open DevTools > Network
3. Click on HTML page
4. Check Response Headers

**Expected:**
- ✅ `Content-Security-Policy` header present
- ✅ Includes `script-src 'self'` (and trusted CDNs)
- ✅ Includes `connect-src 'self'` (and WebSocket URL)

### Test 7.2: Other Security Headers
**Steps:**
1. Same as 7.1

**Expected:**
- ✅ `X-Frame-Options: DENY` OR `frame-ancestors 'none'` in CSP
- ✅ `X-Content-Type-Options: nosniff`
- ✅ `Referrer-Policy: no-referrer` or `strict-origin-when-cross-origin`
- ✅ `Strict-Transport-Security` (production only)

---

## 8️⃣ INTEGRATION TESTS

### Test 8.1: Full User Journey
**Steps:**
1. Open incognito window
2. Navigate to dashboard (`/admin` or `/`)
3. Should redirect to `/login`
4. Login with correct credentials
5. Dashboard loads
6. Navigate to different pages
7. Perform actions (change settings, etc.)
8. Logout
9. Verify cannot access dashboard

### Test 8.2: OAuth → Dashboard → Logout
**Steps:**
1. Click "Login with Discord"
2. Authorize
3. Dashboard loads
4. Click settings
5. Change something
6. Logout
7. Login again (Discord)
8. Verify settings persisted

---

## 🐛 KNOWN ISSUES TO TEST

### Issue 1: Stripe Payment Redirect
**Test:**
1. Login
2. Navigate to billing
3. Start Stripe checkout
4. Complete payment
5. Redirect back to dashboard

**Expected:**
- ✅ Still authenticated after redirect
- ✅ Cookie preserved through Stripe redirect

### Issue 2: Long Session
**Test:**
1. Login
2. Leave dashboard open for 23+ hours
3. Try to perform action

**Expected:**
- ⚠️ Warning shown at 5 minutes before expiry (if secure-auth.js loaded)
- ✅ Redirects to login when token expires

---

## 📊 PERFORMANCE TESTS

### Test P1: Login Speed
**Steps:**
1. Clear browser cache
2. Navigate to `/login`
3. Measure time from "Sign In" click to dashboard load

**Acceptable:**
- ✅ < 500ms for login
- ✅ < 1s total (including redirect)

### Test P2: API Call Overhead
**Steps:**
1. Login
2. Make 10 API calls
3. Measure time

**Expected:**
- ✅ No significant slowdown vs old system
- ✅ Cookie overhead negligible

---

## 🚨 PENETRATION TESTS

### PT1: CSRF Attack Simulation
**Steps:**
1. Login to dashboard
2. Create malicious HTML page:
```html
<form action="https://yourdashboard.com/api/delete-all" method="POST">
    <input type="hidden" name="confirm" value="yes">
</form>
<script>document.forms[0].submit();</script>
```
3. Open in new tab

**Expected:**
- ✅ Attack fails (403 CSRF error)

### PT2: XSS Cookie Theft Attempt
**Steps:**
1. Login
2. Try inject XSS: `<script>alert(document.cookie)</script>`
3. If XSS executes, try steal cookie

**Expected:**
- ✅ Cookie NOT in `document.cookie` (HttpOnly)
- ✅ Cannot exfiltrate token

### PT3: Session Hijacking
**Steps:**
1. Login from Device A
2. Copy cookie value
3. Try use same cookie on Device B

**Expected:**
- ⚠️ Cookie might work (no IP binding by default)
- ✅ Consider adding IP check or device fingerprinting

---

## ✅ SIGN-OFF CHECKLIST

Before deploying to production:

- [ ] All login tests pass
- [ ] OAuth flow works without token in URL
- [ ] Logout clears only auth cookies
- [ ] CSRF protection active on POST routes
- [ ] Brute force protection triggers at 5 attempts
- [ ] Cookies have correct flags (HttpOnly, Secure, SameSite)
- [ ] No tokens in localStorage
- [ ] No tokens in URLs
- [ ] Security headers present
- [ ] Full user journey test passes
- [ ] Stripe redirect test passes (if applicable)
- [ ] Performance acceptable
- [ ] CSRF attack simulation fails
- [ ] XSS cookie theft fails

---

## 📝 TEST RESULTS TEMPLATE

```
Test Date: 2024-XX-XX
Tester: [Your Name]
Environment: [Development/Staging/Production]

| Test ID | Description | Status | Notes |
|---------|-------------|--------|-------|
| 1.1 | Successful Login | ✅ PASS | |
| 1.2 | Wrong Password | ✅ PASS | |
| 1.3 | Brute Force | ✅ PASS | |
| 2.1 | Discord OAuth | ✅ PASS | |
| 3.1 | Logout | ✅ PASS | |
| 4.1 | CSRF Token | ✅ PASS | |
| ... | ... | ... | |

Overall Status: [PASS/FAIL]
Production Ready: [YES/NO]
Issues Found: [List any issues]
```
