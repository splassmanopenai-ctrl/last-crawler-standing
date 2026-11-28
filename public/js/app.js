// Start-up: draw the current screen and, if this phone has a seat, reconnect to it.
document.addEventListener('visibilitychange', () => { if (!document.hidden && session && es && es.readyState === 2) connect(); });
addEventListener('hashchange', () => { if (!session && !tv) render(); }); // home, Hall of Fame, How to play, My crawler
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {}); // offline app and turn alerts
render();
if (session || tv) connect();
