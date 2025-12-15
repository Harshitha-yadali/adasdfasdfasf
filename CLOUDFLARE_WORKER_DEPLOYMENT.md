# Cloudflare Worker Deployment Guide

## 🚀 Quick Deployment Steps

### 1. Update Your Cloudflare Worker

Copy the contents of `cloudflare-worker-enhanced.js` to your Cloudflare Worker:

```bash
# File: cloudflare-worker-enhanced.js
# Worker URL: https://damp-haze-85c6.harshithayadali30.workers.dev
```

### 2. Add Environment Variables

In Cloudflare Dashboard → Workers → `damp-haze-85c6` → Settings → Variables:

**Add these secrets:**

| Variable Name | Type | Description | Status |
|--------------|------|-------------|--------|
| `EDENAI_API_KEY` | Secret | EdenAI API key | ✅ Already added |
| `GEMINI_API_KEY` | Secret | Google Gemini API key | ✅ Already added |
| `OPENROUTER_API_KEY` | Secret | OpenRouter API key | ⚠️ **NEEDS TO BE ADDED** |
| `GITHUB_API_TOKEN` | Secret | GitHub Personal Access Token | ⚠️ **NEEDS TO BE ADDED** |

### 3. Get Required API Keys

#### OpenRouter API Key
1. Go to [openrouter.ai/keys](https://openrouter.ai/keys)
2. Create account or login
3. Generate API key: `sk-or-v1-xxxxxxxxxxxxx`
4. Copy the key

#### GitHub API Token
1. Go to [github.com/settings/tokens](https://github.com/settings/tokens)
2. Click "Generate new token (classic)"
3. Name: `PrimoBoost Worker`
4. Scopes: **Only select `public_repo`** (read-only access to public repos)
5. Generate token: `ghp_xxxxxxxxxxxxx`
6. Copy the token immediately (you won't see it again)

### 4. Add Keys to Cloudflare

**Steps:**
1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Workers & Pages → `damp-haze-85c6`
3. Settings → Variables
4. Click "Add variable"
5. For each key:
   - Variable name: (see table above)
   - Value: (paste your API key)
   - Type: **Secret** (encrypted)
   - Click "Save"

### 5. Deploy the Worker

After updating the code:

```bash
# Option 1: Copy-paste in Cloudflare Dashboard
# 1. Workers & Pages → damp-haze-85c6 → Quick Edit
# 2. Paste contents of cloudflare-worker-enhanced.js
# 3. Click "Save and Deploy"

# Option 2: Deploy via Wrangler CLI (if installed)
wrangler deploy cloudflare-worker-enhanced.js
```

### 6. Test the Deployment

**Test AI Endpoint:**
```bash
curl -X POST https://damp-haze-85c6.harshithayadali30.workers.dev \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Hello, test message"}'
```

**Expected Response:**
```json
{
  "success": true,
  "text": "Hello! How can I help you today?",
  "provider": "edenai",
  "model": "openai"
}
```

**Test GitHub API Proxy:**
```bash
curl "https://damp-haze-85c6.harshithayadali30.workers.dev/github/search/repositories?q=react&sort=stars&per_page=3"
```

**Expected Response:**
```json
{
  "total_count": 123456,
  "items": [
    {
      "name": "react",
      "html_url": "https://github.com/facebook/react",
      "stargazers_count": 200000,
      ...
    }
  ]
}
```

## 🔒 Security Checklist

After deployment, verify:

- [ ] All 4 environment variables are added as **Secrets** (not plain text)
- [ ] GitHub token only has `public_repo` scope (no write access)
- [ ] Worker URL returns proper responses
- [ ] No API keys visible in browser Network tab
- [ ] No API keys in frontend bundle (check dist/assets/*.js)

## 📊 Monitor Usage

**Cloudflare Dashboard → Workers → Analytics:**

Track:
- Total requests
- Error rate
- Response time
- Bandwidth usage

**Free Tier Limits:**
- 100,000 requests/day
- 10ms CPU time per request
- Plenty for your app's usage

## 🐛 Troubleshooting

### Error: "GitHub API token not configured"
**Fix**: Add `GITHUB_API_TOKEN` as a secret in Cloudflare Worker settings

### Error: "All AI providers failed"
**Fix**:
1. Verify all 3 AI API keys are added correctly
2. Check if APIs have credits/quota remaining
3. Test each API key individually

### Error: "403 Rate Limit"
**For GitHub API**:
- Authenticated: 5,000 requests/hour
- Unauthenticated: 60 requests/hour
- **Fix**: Ensure `GITHUB_API_TOKEN` is configured

### Worker not updating
**Fix**:
1. Clear Cloudflare cache: Caching → Configuration → Purge Everything
2. Wait 1-2 minutes for global deployment
3. Hard refresh browser (Ctrl+Shift+R)

## ✅ Post-Deployment

After confirming everything works:

1. **Remove exposed keys from .env:**
   ```bash
   # Comment out or remove these lines:
   # VITE_OPENROUTER_API_KEY=...
   # VITE_GEMINI_API_KEY=...
   # VITE_GITHUB_API_TOKEN=...
   ```

2. **Rebuild frontend:**
   ```bash
   npm run build
   ```

3. **Deploy updated build:**
   ```bash
   # Your deployment command (Netlify/Vercel/etc)
   ```

## 🎉 Done!

Your API keys are now secured server-side on Cloudflare Workers!

**Benefits:**
- ✅ Zero API keys in frontend bundle
- ✅ Automatic provider fallback
- ✅ Rate limiting protection
- ✅ Free (within Cloudflare limits)
- ✅ Global edge deployment (fast worldwide)
