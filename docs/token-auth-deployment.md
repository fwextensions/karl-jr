# Token Authentication Deployment Guide

This guide covers the deployment process for migrating from session-based authentication to token exchange authentication.

## Overview

The token exchange authentication system replaces the current session-based flow where raw Wagtail session IDs are sent on every request. Instead, the extension performs a one-time exchange to obtain a short-lived, HMAC-signed token scoped to the companion API.

**Security improvements:**
- Raw Wagtail session IDs are never stored in Redis or logged
- Tokens are self-validating without external dependencies
- Reduced blast radius: leaked tokens grant read-only companion API access for ≤15 minutes (vs full Wagtail admin access)
- ~90% reduction in Wagtail API calls

## Prerequisites

Before deploying, ensure you have:
- Access to Vercel project settings
- OpenSSL installed (for generating signing secret)
- Ability to deploy both server and extension updates

## Environment Variables

### TOKEN_SIGNING_SECRET (Required)

The HMAC-SHA256 signing key for companion API tokens. This must be a cryptographically secure random value.

**Generate the secret:**
```bash
openssl rand -hex 32
```

This produces a 64-character hex string (32 bytes). Example output:
```
a1b2c3d4e5f6789012345678901234567890abcdefabcdefabcdefabcdefabcd
```

**Set in Vercel:**
1. Navigate to your Vercel project dashboard
2. Go to Settings → Environment Variables
3. Add new variable:
   - Name: `TOKEN_SIGNING_SECRET`
   - Value: (paste the generated hex string)
   - Environment: Production, Preview, Development

**Security notes:**
- Never commit this value to version control
- Use different secrets for production and staging environments
- Rotate the secret periodically (requires redeployment)
- Minimum length: 32 hex characters (16 bytes)

### TOKEN_TTL_SECONDS (Optional)

Token lifetime in seconds. Default: 900 (15 minutes)

**Configuration:**
- Acceptable range: 300-3600 (5 minutes to 1 hour)
- Shorter values increase security but require more frequent token exchanges
- Longer values reduce API calls but increase exposure window if tokens leak

**Set in Vercel:**
1. Navigate to Settings → Environment Variables
2. Add new variable:
   - Name: `TOKEN_TTL_SECONDS`
   - Value: `900` (or your preferred value)
   - Environment: Production, Preview, Development

**Recommended values:**
- Production: `900` (15 minutes) - balances security and UX
- Development: `3600` (1 hour) - reduces token exchanges during testing

## Migration Phases

The deployment follows a three-phase approach to ensure zero downtime and backward compatibility.

### Phase 1: Deploy Server Changes (Backward-Compatible)

**Goal:** Enable token authentication while maintaining support for existing extension versions.

**Steps:**

1. **Set environment variables in Vercel:**
   ```bash
   # Generate signing secret
   openssl rand -hex 32
   
   # Add to Vercel project settings:
   # TOKEN_SIGNING_SECRET=<generated_value>
   # TOKEN_TTL_SECONDS=900 (optional)
   ```

2. **Deploy server changes:**
   ```bash
   cd packages/server
   npm run deploy
   ```

3. **Verify deployment:**
   - Check Vercel deployment logs for successful build
   - Confirm no errors related to missing environment variables
   - Test token exchange endpoint:
     ```bash
     curl -X POST "https://your-api.vercel.app/api/auth/token" \
       -H "X-Wagtail-Session: your_session_cookie" \
       -H "Origin: chrome-extension://your-extension-id"
     ```

**What happens in Phase 1:**
- New `/api/auth/token` endpoint is available
- `/api/feedback` and `/api/link-check` accept BOTH:
  - `Authorization: Bearer <token>` (new method)
  - `X-Wagtail-Session: <session>` (legacy method)
- Server checks for bearer token first, falls back to session validation
- Existing extension versions continue working unchanged

**Rollback plan:**
If issues occur, redeploy the previous server version. No extension changes have been made yet, so rollback is safe.

### Phase 2: Deploy Extension Changes

**Goal:** Update extension to use token authentication.

**Steps:**

1. **Build extension:**
   ```bash
   cd packages/extension
   npm run build
   ```

2. **Test locally:**
   - Load unpacked extension from `dist/` directory
   - Navigate to SF.gov pages
   - Verify side panel loads correctly
   - Check browser console for authentication errors
   - Confirm feedback and link check features work

3. **Distribute extension:**
   - For Chrome Web Store: Upload `release/*.zip` file
   - For internal distribution: Share the zip file with users
   - For development: Users load unpacked from `dist/`

4. **Monitor rollout:**
   - Check for authentication errors in user reports
   - Monitor Vercel logs for 401 responses
   - Verify token exchange requests are succeeding

**What happens in Phase 2:**
- New extension versions use token authentication
- Old extension versions continue using session authentication
- Both work simultaneously during transition period
- Server handles both authentication methods

**Rollback plan:**
If issues occur, users can reinstall the previous extension version. Server still supports legacy authentication, so old versions work immediately.

### Phase 3: Remove Legacy Support (Optional)

**Goal:** Clean up backward compatibility code after all users have updated.

**When to proceed:**
- Wait at least 2-4 weeks after Phase 2 deployment
- Confirm >95% of users have updated to new extension version
- Monitor Vercel logs to verify no `X-Wagtail-Session` headers in `/api/feedback` and `/api/link-check` requests
  - Note: `/api/auth/token` will continue to receive `X-Wagtail-Session` headers (this is expected and required)

**Steps:**

1. **Update server code:**
   - Remove `X-Wagtail-Session` handling from `feedback.ts` and `link-check.ts`
   - **Keep** `X-Wagtail-Session` handling in `/api/auth/token` (required for token exchange)
   - Remove session validation Redis caching (`session:*` keys) from feedback and link-check endpoints
   - Remove `X-Wagtail-Session` from CORS `Access-Control-Allow-Headers` in feedback and link-check endpoints
   - **Keep** `X-Wagtail-Session` in CORS headers for `/api/auth/token` endpoint
   - Update error messages to indicate token authentication is required

2. **Deploy server changes:**
   ```bash
   cd packages/server
   npm run deploy
   ```

3. **Verify deployment:**
   - Test with new extension version (should work)
   - Test with old extension version (should fail with clear error)
   - Confirm Redis no longer stores session validation results

**What happens in Phase 3:**
- Server only accepts token authentication
- Old extension versions stop working
- Users must update to new extension version
- Reduced server complexity and maintenance burden

**Rollback plan:**
If issues occur, redeploy Phase 1 server code to restore backward compatibility.

## Verification Checklist

After each phase, verify the following:

### Phase 1 Verification
- [ ] `TOKEN_SIGNING_SECRET` is set in Vercel environment variables
- [ ] Server deployment succeeded without errors
- [ ] `/api/auth/token` endpoint returns valid tokens
- [ ] `/api/feedback` accepts bearer tokens
- [ ] `/api/feedback` still accepts session headers (backward compatibility)
- [ ] Existing extension versions continue working

### Phase 2 Verification
- [ ] Extension builds without errors
- [ ] Extension loads in browser without errors
- [ ] Side panel displays page information correctly
- [ ] Feedback feature works with token authentication
- [ ] Link check feature works with token authentication
- [ ] Token refresh happens automatically before expiry
- [ ] 401 responses trigger token refresh and retry

### Phase 3 Verification (Optional)
- [ ] Server no longer accepts `X-Wagtail-Session` headers
- [ ] Old extension versions fail with clear error messages
- [ ] New extension versions continue working
- [ ] Redis no longer stores session validation results
- [ ] Server logs no longer contain session-related errors

## Troubleshooting

### Token Exchange Fails with 401

**Symptoms:** Extension shows "Invalid or expired session" error

**Causes:**
- Wagtail session cookie is missing or expired
- User is not logged in to Wagtail admin
- Wagtail API is unreachable

**Solutions:**
1. Verify user is logged in to SF.gov Wagtail admin
2. Check browser cookies for `sessionid` on `api.sf.gov` domain
3. Test Wagtail API directly: `curl https://api.sf.gov/admin/api/v2/pages`
4. Check Vercel logs for Wagtail API errors

### Token Exchange Fails with 403

**Symptoms:** Extension shows "Token exchange failed: 403" error

**Causes:**
- Extension origin is not whitelisted in server CORS configuration
- Extension ID changed after reinstallation

**Solutions:**
1. Check extension ID in `chrome://extensions/`
2. Verify origin matches pattern in server CORS config
3. Update server CORS configuration if needed
4. Redeploy server after CORS changes

### Token Exchange Fails with 500

**Symptoms:** Extension shows "Token exchange failed: 500" error

**Causes:**
- `TOKEN_SIGNING_SECRET` is missing or invalid
- Server code error during token creation

**Solutions:**
1. Verify `TOKEN_SIGNING_SECRET` is set in Vercel environment variables
2. Check Vercel function logs for error details
3. Verify secret is at least 32 hex characters
4. Redeploy server after fixing environment variables

### Tokens Expire Too Quickly

**Symptoms:** Users see frequent "refreshing authentication" messages

**Causes:**
- `TOKEN_TTL_SECONDS` is set too low
- System clock skew between client and server

**Solutions:**
1. Increase `TOKEN_TTL_SECONDS` to 900 or higher
2. Verify server system time is accurate
3. Check browser system time is accurate
4. Redeploy server after changing TTL

### Old Extension Versions Stop Working After Phase 3

**Symptoms:** Users report "authentication failed" errors after Phase 3 deployment

**Expected behavior:** This is intentional after Phase 3

**Solutions:**
1. Instruct users to update to latest extension version
2. Provide clear update instructions in error message
3. If rollback needed, redeploy Phase 1 server code

## Security Considerations

### Secret Rotation

Rotate `TOKEN_SIGNING_SECRET` periodically (recommended: every 90 days):

1. Generate new secret: `openssl rand -hex 32`
2. Update Vercel environment variable
3. Redeploy server
4. All existing tokens become invalid immediately
5. Extension automatically exchanges for new tokens

**Impact:** Users may see brief "refreshing authentication" message, but no action required.

### Token Leakage

If tokens are leaked (e.g., in logs or error reports):

**Immediate impact:**
- Attacker gains read-only companion API access
- Access expires after TOKEN_TTL_SECONDS (default: 15 minutes)
- Attacker cannot access Wagtail admin

**Mitigation:**
- Tokens are short-lived (15 minutes by default)
- Tokens are scoped to companion API only
- No sensitive data exposed in token payload
- Rotate `TOKEN_SIGNING_SECRET` if widespread leakage suspected

### Logging Best Practices

The server logs session fingerprints (first 8 characters of SHA-256 hash) instead of raw session IDs:

```
Token exchange: sfp=a1b2c3d4
Feedback request: sfp=a1b2c3d4
```

**Never log:**
- Raw Wagtail session IDs
- Complete tokens
- `TOKEN_SIGNING_SECRET`

## Monitoring

### Key Metrics

Monitor these metrics in Vercel dashboard:

1. **Token exchange rate:** Requests to `/api/auth/token`
   - Expected: ~1 per user per 15 minutes
   - High rate may indicate token caching issues

2. **Authentication errors:** 401 responses from `/api/feedback` and `/api/link-check`
   - Expected: <1% of requests
   - High rate may indicate token expiry issues

3. **Token exchange failures:** 401 responses from `/api/auth/token`
   - Expected: <5% of requests (expired sessions)
   - High rate may indicate Wagtail API issues

4. **Server errors:** 500 responses from any endpoint
   - Expected: <0.1% of requests
   - Any 500s should be investigated immediately

### Alerts

Set up alerts for:
- 500 errors from `/api/auth/token` (indicates configuration issue)
- >10% 401 rate from `/api/feedback` (indicates token validation issue)
- Missing `TOKEN_SIGNING_SECRET` environment variable

## Support

For issues or questions:
1. Check Vercel function logs for error details
2. Review browser console for client-side errors
3. Verify environment variables are set correctly
4. Test token exchange endpoint directly with curl
5. Consult the design document: `.kiro/specs/token-exchange-auth/design.md`
