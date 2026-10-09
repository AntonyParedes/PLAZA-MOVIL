import {defineConfig} from '@playwright/test';
export default defineConfig({
 testDir:'./e2e',fullyParallel:false,workers:1,
 use:{baseURL:'http://127.0.0.1:3100',headless:true,launchOptions:{executablePath:process.env.CHROMIUM_PATH??'/usr/bin/chromium',args:['--no-sandbox']}},
 webServer:{command:'NEXT_PUBLIC_SUPABASE_URL=https://pm-e2e.supabase.co NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=e2e-public-placeholder npm run dev -- --hostname 127.0.0.1 --port 3100',url:'http://127.0.0.1:3100',reuseExistingServer:false,timeout:60000},
});
