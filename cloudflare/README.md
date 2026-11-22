# FolkChat media worker (Cloudflare R2)

Stores pictures in an R2 bucket instead of Firestore and sends push notifications.

**Easiest:** add the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets to the GitHub repo and run
**Actions → Deploy FolkChat media worker**. Then put the worker URL in `config.js` → `MEDIA_URL`.

**By hand:**
```
cd cloudflare
npx wrangler login
npx wrangler r2 bucket create folkchat-media
npx wrangler deploy
npx wrangler secret put SA_CLIENT_EMAIL     # optional, for push (from the Firebase service-account JSON)
npx wrangler secret put SA_PRIVATE_KEY      # optional, paste the whole "private_key" value
```

Notes
* R2's free tier is 10 GB; Cloudflare asks for a payment card when you turn R2 on, but you aren't charged inside the free tier.
* Pictures are public to anyone who has the exact (random, unguessable) link – the same way Discord attachments work.
* Uploads: max 10 MB, only JPEG / PNG / WebP / GIF, 20 per minute per user. Pushes: 30 per minute per user.
