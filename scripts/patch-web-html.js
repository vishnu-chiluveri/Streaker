// ============================================================
// STREAKER — PWA meta injection for `expo export -p web`
// ============================================================
//
// web.output is "single" (client-only SPA), which means expo-router's
// +html.tsx customization is ignored - it only applies to "static" output,
// and switching to "static" would add a per-route SSR pass this app's
// client-only stores (AsyncStorage/Zustand hydration) aren't built for.
// So instead we patch the exported dist/index.html directly, after export.

const fs = require('fs');
const path = require('path');

const indexPath = path.join(__dirname, '..', 'dist', 'index.html');

if (!fs.existsSync(indexPath)) {
  console.error(`patch-web-html: ${indexPath} not found - run "expo export -p web" first`);
  process.exit(1);
}

let html = fs.readFileSync(indexPath, 'utf8');

const injected = `
    <meta name="description" content="Build and track streaks with friends." />

    <!-- PWA manifest + theme -->
    <link rel="manifest" href="/manifest.json" />
    <meta name="theme-color" content="#0F0F1A" />
    <meta name="background-color" content="#0F0F1A" />

    <!-- iOS "Add to Home Screen" behavior - opens standalone, no Safari chrome -->
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="apple-mobile-web-app-title" content="Streaker" />
  </head>`;

if (html.includes('rel="manifest"')) {
  console.log('patch-web-html: manifest link already present, skipping');
} else {
  html = html.replace('</head>', injected);
  fs.writeFileSync(indexPath, html);
  console.log('patch-web-html: injected PWA meta tags into dist/index.html');
}

// Copy .htaccess to dist/ for Apache SPA rewrite support on HostGator
const htaccessSrc = path.join(__dirname, '..', 'public', '.htaccess');
const htaccessDest = path.join(__dirname, '..', 'dist', '.htaccess');
if (fs.existsSync(htaccessSrc)) {
  fs.copyFileSync(htaccessSrc, htaccessDest);
  console.log('patch-web-html: copied .htaccess into dist/');
}
